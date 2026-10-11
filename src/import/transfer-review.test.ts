import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db, initializeDatabase } from "../storage/database";
import { clearLocalData } from "../storage/backup";
import { undoChange } from "../storage/audit";
import { parseOfx } from "./formats";
import { commitDraft, prepareDraft, type ExtractedFile } from "./pipeline";
import { commitReviewedBatch } from "./batch";
import {
  previewImportTransfers,
  unambiguousImportTransfers,
} from "./transfer-review";
import { cashFlow } from "../analytics/calculations";

beforeEach(async () => {
  await clearLocalData();
  await initializeDatabase();
});
afterAll(async () => {
  await db.delete();
});
function exported(
  bank: string,
  identifier: string,
  amount: number,
  date: string,
  hash: string,
): ExtractedFile {
  const credit = bank === "AMEX";
  const block = credit ? "CCSTMTRS" : "STMTTRS";
  const text = `<OFX><FI><ORG>${bank}</ORG></FI><${block}><CURDEF>GBP<ACCTID>${identifier}<BANKTRANLIST><DTSTART>20260901<DTEND>20260930<STMTTRN><DTPOSTED>${date.replaceAll("-", "")}<TRNAMT>${amount}<FITID>${hash}<NAME>${credit ? "BARCLAYS PAYMENT THANK YOU" : "PAYMENT TO AMEX"}</STMTTRN></BANKTRANLIST><LEDGERBAL><BALAMT>50.00<DTASOF>20260930</LEDGERBAL></${block}></OFX>`;
  return {
    rows: [],
    hash,
    filename: `${hash}.ofx`,
    method: "OFX",
    warnings: [],
    format: "ofx",
    parsed: parseOfx(text),
  };
}
async function pair(creditDate = "2026-09-12") {
  const debit = await prepareDraft(
    exported("BARCLAYS", "12344321", -950, "2026-09-10", "current"),
  );
  const credit = await prepareDraft(
    exported("AMEX", "99991008", 950, creditDate, "card"),
    undefined,
    undefined,
    undefined,
    [debit],
  );
  return [debit, credit];
}
describe("transfer confirmation before import", () => {
  it("previews both sides while nothing has been saved, leaving Manual pairs normal until confirmed", async () => {
    const drafts = await pair();
    const preview = await previewImportTransfers(drafts);
    expect(preview.proposals).toHaveLength(1);
    expect(preview.proposals[0].pairKind).toBe("card_repayment");
    expect(await db.transactions.count()).toBe(0);
    await commitReviewedBatch(
      drafts.map((draft, index) => ({
        id: String(index),
        draft,
        overrideValidation: false,
      })),
      () => undefined,
    );
    const transactions = await db.transactions.toArray();
    expect(transactions.every((row) => !row.isTransfer)).toBe(true);
    expect(cashFlow(transactions, "GBP")).toEqual({
      income: 95000,
      expenses: 95000,
      net: 0,
    });
    expect(
      await db.transferProposals.where("status").equals("pending").count(),
    ).toBe(1);
  });
  it("applies selected confirmation atomically when the last counterpart is saved and restores both sides with one Undo", async () => {
    const drafts = await pair();
    const preview = await previewImportTransfers(drafts);
    for (const draft of drafts)
      draft.confirmedTransferProposalIds = [preview.proposals[0].id];
    await commitReviewedBatch(
      drafts.map((draft, index) => ({
        id: String(index),
        draft,
        overrideValidation: false,
      })),
      () => undefined,
    );
    const transactions = await db.transactions.toArray();
    expect(
      transactions.every(
        (row) => row.isTransfer && row.kind === "card_repayment",
      ),
    ).toBe(true);
    expect(cashFlow(transactions, "GBP")).toEqual({
      income: 0,
      expenses: 0,
      net: 0,
    });
    expect(await db.transferLinks.count()).toBe(1);
    const entry = (await db.changeLog.toArray()).find(
      (change) => change.label === "Import card.ofx",
    )!;
    expect(
      entry.changes.filter((change) => change.table === "transactions"),
    ).toHaveLength(2);
    await undoChange(entry.id);
    const restored = await db.transactions.toArray();
    expect(restored).toHaveLength(1);
    expect(restored[0]).toMatchObject({ type: "expense", isTransfer: false });
    expect(await db.transferLinks.count()).toBe(0);
  });
  it("automatically links a unique two-day match only when the user enabled Automatic", async () => {
    await db.settings.put({ key: "transferMatching", value: "automatic" });
    const drafts = await pair();
    const preview = await previewImportTransfers(drafts);
    expect(preview.mode).toBe("automatic");
    expect(preview.automaticProposalIds).toEqual([preview.proposals[0].id]);
    expect(await db.transferLinks.count()).toBe(0);
    await commitReviewedBatch(
      drafts.map((draft, index) => ({
        id: String(index),
        draft,
        overrideValidation: false,
      })),
      () => undefined,
    );
    expect(
      (await db.transactions.toArray()).every((row) => row.isTransfer),
    ).toBe(true);
    expect((await db.transferLinks.toArray())[0].manual).toBe(false);
  });
  it("leaves a unique three-day match pending even in Automatic", async () => {
    await db.settings.put({ key: "transferMatching", value: "automatic" });
    const drafts = await pair("2026-09-13");
    expect((await previewImportTransfers(drafts)).automaticProposalIds).toEqual(
      [],
    );
    await commitReviewedBatch(
      drafts.map((draft, index) => ({
        id: String(index),
        draft,
        overrideValidation: false,
      })),
      () => undefined,
    );
    expect(
      (await db.transactions.toArray()).every((row) => !row.isTransfer),
    ).toBe(true);
    expect(await db.transferLinks.count()).toBe(0);
  });
  it("remembers an Automatic review rejection before the final counterpart is imported", async () => {
    await db.settings.put({ key: "transferMatching", value: "automatic" });
    const drafts = await pair();
    const preview = await previewImportTransfers(drafts);
    for (const draft of drafts)
      draft.rejectedTransferProposalIds = [preview.proposals[0].id];
    await commitReviewedBatch(
      drafts.map((draft, index) => ({
        id: String(index),
        draft,
        overrideValidation: false,
      })),
      () => undefined,
    );
    expect(await db.transferLinks.count()).toBe(0);
    expect(
      (await db.transactions.toArray()).every((row) => !row.isTransfer),
    ).toBe(true);
    expect(
      (await db.transferProposals.get(preview.proposals[0].id))?.status,
    ).toBe("rejected");
    const { refreshTransferProposals } = await import("../storage/accuracy");
    await refreshTransferProposals();
    expect(await db.transferLinks.count()).toBe(0);
  });
  it("does not link prematurely when a later file adds a competing credit", async () => {
    await db.settings.put({ key: "transferMatching", value: "automatic" });
    const drafts = await pair();
    const otherCredit = await prepareDraft(
      exported("AMEX", "99992009", 950, "2026-09-11", "other-card"),
      undefined,
      undefined,
      undefined,
      drafts,
    );
    drafts.push(otherCredit);
    const preview = await previewImportTransfers(drafts);
    expect(preview.proposals).toHaveLength(2);
    expect(preview.automaticProposalIds).toEqual([]);
    await commitReviewedBatch(
      drafts.map((draft, index) => ({
        id: String(index),
        draft,
        overrideValidation: false,
      })),
      () => undefined,
    );
    expect(await db.transferLinks.count()).toBe(0);
    expect(
      await db.transferProposals.where("status").equals("pending").count(),
    ).toBe(2);
  });
  it("does not auto-link unrelated older pending pairs when importing another transaction", async () => {
    const drafts = await pair();
    await commitReviewedBatch(
      drafts.map((draft, index) => ({
        id: String(index),
        draft,
        overrideValidation: false,
      })),
      () => undefined,
    );
    await db.settings.put({ key: "transferMatching", value: "automatic" });
    const unrelated = await prepareDraft(
      exported("BARCLAYS", "12344321", -30, "2026-09-11", "other-purchase"),
    );
    await commitDraft(unrelated);
    expect(await db.transferLinks.count()).toBe(0);
    expect(
      await db.transferProposals.where("status").equals("pending").count(),
    ).toBe(1);
  });
  it("uses the configured date window and never bulk-confirms ambiguous matches", async () => {
    await db.settings.put({ key: "transferDateWindowDays", value: "1" });
    expect((await previewImportTransfers(await pair())).proposals).toHaveLength(
      0,
    );
    const proposals = [
      {
        id: "one",
        debitTxId: "debit",
        creditTxId: "credit-a",
        score: 1,
        status: "pending" as const,
        createdAt: "",
      },
      {
        id: "two",
        debitTxId: "debit",
        creditTxId: "credit-b",
        score: 1,
        status: "pending" as const,
        createdAt: "",
      },
    ];
    expect(unambiguousImportTransfers(proposals)).toHaveLength(0);
  });
  it("does not propose a transfer against a transaction awaiting a split rule", async () => {
    const drafts = await pair();
    drafts[0].transactions[0].ruleSplit = [
      { categoryId: "groceries", amount: -50000 },
      { categoryId: "shopping", amount: -45000 },
    ];
    expect((await previewImportTransfers(drafts)).proposals).toHaveLength(0);
  });
  it("rolls back an import when a selected transfer is invalidated by a split", async () => {
    const drafts = await pair();
    const preview = await previewImportTransfers(drafts);
    await commitDraft(drafts[1]);
    drafts[0].confirmedTransferProposalIds = [preview.proposals[0].id];
    drafts[0].transactions[0].ruleSplit = [
      { categoryId: "groceries", amount: -50000 },
      { categoryId: "shopping", amount: -45000 },
    ];
    await expect(commitDraft(drafts[0])).rejects.toThrow(
      "confirmed transfer no longer matches",
    );
    expect(await db.transactions.count()).toBe(1);
    expect(await db.statements.count()).toBe(1);
    expect(await db.transferLinks.count()).toBe(0);
    expect((await db.settings.get("backup:importsSinceExport"))?.value).toBe(
      "1",
    );
  });
  it("does not offer an existing purchase linked to a refund outside the nearby transfer window", async () => {
    const drafts = await pair();
    await commitDraft(drafts[0]);
    const purchase = drafts[0].transactions[0];
    await db.transactions.add({
      ...purchase,
      id: "later-refund",
      date: "2026-11-15",
      amount: 1000,
      type: "income",
      kind: "refund",
      categoryId: undefined,
      refundAllocations: [{ transactionId: purchase.id, amount: 1000 }],
    });
    expect((await previewImportTransfers([drafts[1]])).proposals).toHaveLength(
      0,
    );
  });
});
