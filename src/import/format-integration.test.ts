import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db, initializeDatabase } from "../storage/database";
import { clearLocalData, exportBackupFile } from "../storage/backup";
import { accounts, bankRows, transaction } from "../tests/helpers";
import { readCsv, type CsvMapping } from "./formats";
import {
  commitDraft,
  extractFile,
  prepareDraft,
  validateDraft,
  type ExtractedFile,
} from "./pipeline";
import { commitReviewedBatch, type BatchOutcome } from "./batch";
import { undoChange } from "../storage/audit";
import { importMonthGuardDates } from "./month-guards";

const csv = (
  text: string,
  hash = "demo-csv",
  mapping?: CsvMapping,
): ExtractedFile => ({
  rows: [],
  hash,
  filename: "fictional.csv",
  method: "CSV",
  warnings: [],
  format: "csv",
  csv: readCsv(text),
  preset: mapping,
});
const pdf: ExtractedFile = {
  rows: bankRows(),
  hash: "demo-pdf",
  filename: "fictional.pdf",
  method: "embedded-text",
  warnings: [],
};
beforeEach(async () => {
  await clearLocalData();
  await initializeDatabase();
});
afterAll(async () => {
  await db.delete();
});

describe("cross-format import integrity", () => {
  it("counts two confirmed statement imports, skips exact reimports, and resets the count after backup handoff", async () => {
    await db.accounts.add(accounts[0]);
    const mapping = {
      date: 0,
      description: 1,
      amount: 2,
      institution: "Barclays" as const,
    };
    const first = await prepareDraft(
      csv(
        "Date,Description,Amount\n01/09/2026,FICTITIOUS ONE,-10.00",
        "count-one",
        mapping,
      ),
    );
    await commitDraft(first);
    const second = await prepareDraft(
      csv(
        "Date,Description,Amount\n02/09/2026,FICTITIOUS TWO,-15.00",
        "count-two",
        mapping,
      ),
    );
    await commitDraft(second);
    expect((await db.settings.get("backup:importsSinceExport"))?.value).toBe(
      "2",
    );
    const duplicate = await prepareDraft(
      csv(
        "Date,Description,Amount\n02/09/2026,FICTITIOUS TWO,-15.00",
        "count-two",
        mapping,
      ),
    );
    await commitReviewedBatch(
      [{ id: "duplicate", draft: duplicate, overrideValidation: false }],
      () => undefined,
    );
    expect((await db.settings.get("backup:importsSinceExport"))?.value).toBe(
      "2",
    );
    vi.spyOn(URL, "createObjectURL").mockReturnValue(
      "blob:synthetic-count-backup",
    );
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      () => undefined,
    );
    try {
      await exportBackupFile();
      expect((await db.settings.get("backup:importsSinceExport"))?.value).toBe(
        "0",
      );
    } finally {
      vi.restoreAllMocks();
    }
  });
  it("imports a synthetic PDF then skips the same transactions in a CSV without erasing the verified statement", async () => {
    const first = await prepareDraft(pdf);
    await commitDraft(first);
    const second = await prepareDraft(
      csv(
        "Date,Description,Amount,Balance\n01/09/2026,JOHN LEWIS LONDON STORE,-120.50,879.50\n02/09/2026,SIEMENS SALARY,5000.00,5879.50\n03/09/2026,WAITROSE,-10.00,5869.50\n03/09/2026,WAITROSE,-10.00,5859.50",
        "different-file-hash",
        {
          date: 0,
          description: 1,
          amount: 2,
          balance: 3,
          institution: "Barclays",
        },
      ),
    );
    expect(second.account.id).toBe(first.account.id);
    expect(
      second.transactions.every((t) => !t.include && t.duplicate === "certain"),
    ).toBe(true);
    const outcomes: BatchOutcome[] = [];
    await commitReviewedBatch(
      [{ id: "csv", draft: second, overrideValidation: false }],
      (outcome) => outcomes.push(outcome),
    );
    expect(outcomes[0]).toMatchObject({
      imported: 0,
      duplicatesSkipped: 4,
      statementSkipped: true,
    });
    expect(await db.transactions.count()).toBe(4);
    expect(await db.statements.count()).toBe(1);
  });
  it("preserves the third legitimate identical purchase when the first two were already imported", async () => {
    const first = await prepareDraft(pdf);
    await commitDraft(first);
    const second = await prepareDraft(
      csv(
        "Date,Description,Amount\n03/09/2026,WAITROSE,-10.00\n03/09/2026,WAITROSE,-10.00\n03/09/2026,WAITROSE,-10.00",
        "identical-purchases",
        { date: 0, description: 1, amount: 2, institution: "Barclays" },
      ),
    );
    expect(second.transactions.map((t) => t.include)).toEqual([
      false,
      false,
      true,
    ]);
    expect(await commitDraft(second)).toBe(1);
    expect(await db.transactions.count()).toBe(5);
  });
  it("requires an account when a bank export has no identifier and multiple matching accounts", async () => {
    await db.accounts.bulkAdd([
      accounts[0],
      { ...accounts[0], id: "another", maskedAccountIdentifier: "•••• 7777" },
    ]);
    const exportFile = csv(
      "Date,Description,Money out,Money in,Balance\n01/09/2026,SHOP,10.00,,90.00",
      "ambiguous",
      {
        date: 0,
        description: 1,
        debit: 2,
        credit: 3,
        balance: 4,
        institution: "Barclays",
      },
    );
    await expect(prepareDraft(exportFile)).rejects.toThrow("Select");
    expect(
      (await prepareDraft(exportFile, undefined, accounts[0])).account.id,
    ).toBe("a1");
  });
  it("persists a custom column mapping only on confirmed import and permits Undo", async () => {
    await db.accounts.add(accounts[0]);
    const exportFile = csv(
      "When,What,Value\n01/09/2026,FICTITIOUS SHOP,-10.00",
    );
    const mapping = {
      date: 0,
      description: 1,
      amount: 2,
      institution: "Barclays" as const,
    };
    const draft = await prepareDraft(
      exportFile,
      undefined,
      accounts[0],
      undefined,
      [],
      mapping,
    );
    expect(await db.settings.get("csv-mapping:a1")).toBeUndefined();
    await commitDraft(draft);
    expect(
      JSON.parse((await db.settings.get("csv-mapping:a1"))!.value).headers,
    ).toEqual(["When", "What", "Value"]);
    const next = await prepareDraft(
      { ...exportFile, hash: "next-export" },
      undefined,
      accounts[0],
    );
    expect(next.transactions[0].amount).toBe(-1000);
    const changes = await db.changeLog.toArray();
    const imported = changes.find((change) =>
      change.label.startsWith("Import "),
    )!;
    await undoChange(imported.id);
    expect(await db.transactions.count()).toBe(0);
    expect(await db.settings.get("csv-mapping:a1")).toBeUndefined();
  });
  it("keeps CSV without balances unverified and never invents reconciliation", async () => {
    await db.accounts.add(accounts[0]);
    const draft = await prepareDraft(
      csv(
        "Date,Description,Amount\n01/09/2026,FICTITIOUS SHOP,-10.00",
        "no-balances",
        { date: 0, description: 1, amount: 2, institution: "Barclays" },
      ),
    );
    expect(validateDraft(draft, false).status).toBe("unavailable");
    await commitDraft(draft);
    expect((await db.statements.toArray())[0].validationStatus).toBe(
      "unavailable",
    );
  });
  it("requires a decision before replacing a matching manual record and merges its categorization", async () => {
    await db.accounts.add(accounts[0]);
    const manual = transaction({
      id: "manual",
      source: "manual",
      statementId: "",
      amount: -1000,
      description: "FICTITIOUS SHOP",
      merchant: "FICTITIOUS SHOP",
      categoryId: "shopping",
      tags: ["Trip"],
      note: "Already entered by hand",
    });
    await db.transactions.add(manual);
    const draft = await prepareDraft(
      csv(
        "Date,Description,Amount\n02/09/2026,FICTITIOUS SHOP,-10.00",
        "manual-match",
        { date: 0, description: 1, amount: 2, institution: "Barclays" },
      ),
    );
    expect(draft.transactions[0].manualReplacementId).toBe("manual");
    expect(() => validateDraft(draft, false)).toThrow(
      "matching manual transaction",
    );
    draft.transactions[0].replaceManual = true;
    await commitDraft(draft);
    expect(await db.transactions.count()).toBe(1);
    const stored = (await db.transactions.toArray())[0];
    expect(stored).toMatchObject({
      source: "csv",
      categoryId: "shopping",
      tags: ["Trip"],
      note: "Already entered by hand",
    });
    expect(await db.transactions.get("manual")).toBeUndefined();
  });
  it("requires reopening a closed period before adding imported or replacing manual actuals", async () => {
    await db.accounts.add(accounts[0]);
    await db.monthCloses.put({
      month: "2026-09",
      closedAt: new Date().toISOString(),
      snapshot: {
        income: 0,
        expenses: 0,
        net: 0,
        transactionCount: 0,
        categoryTotals: {},
      },
    });
    const draft = await prepareDraft(
      csv(
        "Date,Description,Amount\n01/09/2026,FICTITIOUS SHOP,-10.00",
        "closed-month",
        { date: 0, description: 1, amount: 2, institution: "Barclays" },
      ),
    );
    await expect(commitDraft(draft)).rejects.toThrow("closed month");
    expect(await db.transactions.count()).toBe(0);
    expect(await db.statements.count()).toBe(0);
  });
  it("preserves cross-account refund links by refusing replacement until they are unlinked", async () => {
    await db.accounts.bulkAdd([accounts[0], accounts[1]]);
    await db.transactions.bulkAdd([
      transaction({
        id: "linked-manual",
        source: "manual",
        statementId: "",
        amount: -1000,
        description: "FICTITIOUS SHOP",
        categoryId: "shopping",
      }),
      transaction({
        id: "refund-other-account",
        accountId: accounts[1].id,
        source: "manual",
        statementId: "",
        amount: 1000,
        type: "income",
        kind: "refund",
        refundAllocations: [{ transactionId: "linked-manual", amount: 1000 }],
      }),
    ]);
    const draft = await prepareDraft(
      csv(
        "Date,Description,Amount\n02/09/2026,FICTITIOUS SHOP,-10.00",
        "refund-linked-manual-match",
        { date: 0, description: 1, amount: 2, institution: "Barclays" },
      ),
    );
    draft.transactions[0].replaceManual = true;
    await expect(commitDraft(draft)).rejects.toThrow("Unlink or unsplit");
    expect(await db.transactions.count()).toBe(2);
    expect(await db.statements.count()).toBe(0);
    expect(
      (await db.transactions.get("refund-other-account"))?.refundAllocations,
    ).toEqual([{ transactionId: "linked-manual", amount: 1000 }]);
  });
  it("protects a closed month inside a balance-only statement period before any ledger rows exist", async () => {
    await db.monthCloses.put({
      month: "2026-09",
      closedAt: new Date().toISOString(),
      snapshot: {
        income: 0,
        expenses: 0,
        net: 0,
        transactionCount: 0,
        categoryTotals: {},
      },
    });
    const draft = await prepareDraft(pdf);
    draft.transactions = [];
    draft.statement.statementPeriodStart = "2026-08-01";
    draft.statement.statementPeriodEnd = "2026-10-31";
    draft.statement.openingBalance = 10000;
    draft.statement.closingBalance = 10000;
    expect(await importMonthGuardDates([draft])).toContainEqual({
      date: "2026-09-01",
    });
    await expect(commitDraft(draft)).rejects.toThrow("closed month");
    expect(await db.transactions.count()).toBe(0);
    expect(await db.statements.count()).toBe(0);
    expect(await db.accounts.count()).toBe(0);
  });
  it("processes CSV, QFX and QIF locally with zero fetches", async () => {
    const network = vi.spyOn(globalThis, "fetch");
    const file = (name: string, content: string) => {
      const result = new File([content], name, { type: "text/plain" });
      const bytes = new TextEncoder().encode(content);
      Object.defineProperty(result, "arrayBuffer", {
        value: async () => bytes.buffer,
      });
      return result;
    };
    const csvFile = await extractFile(
      file("demo.csv", "Date,Description,Amount\n01/09/2026,DEMO SHOP,-10.00"),
      () => undefined,
    );
    const qfx = await extractFile(
      file(
        "demo.qfx",
        "<OFX><STMTTRS><CURDEF>GBP<ACCTID>12344321<BANKTRANLIST><STMTTRN><DTPOSTED>20260901<TRNAMT>-10.00<NAME>DEMO SHOP<FITID>demo-qfx</STMTTRN></BANKTRANLIST></STMTTRS></OFX>",
      ),
      () => undefined,
    );
    const qif = await extractFile(
      file("demo.qif", "!Type:Bank\nD09/01/2026\nT-10.00\nPDEMO SHOP\n^\n"),
      () => undefined,
    );
    expect([csvFile.method, qfx.method, qif.method]).toEqual([
      "CSV",
      "OFX",
      "QIF",
    ]);
    expect(network).not.toHaveBeenCalled();
    network.mockRestore();
  });
});
