import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db, initializeDatabase } from "../storage/database";
import { clearLocalData } from "../storage/backup";
import { bankRows } from "../tests/helpers";
import { verifiedStatements } from "../analytics/coverage";
import { commitDraft, prepareDraft, refreshReviewedDraft } from "./pipeline";
import {
  commitReviewedBatch,
  statementPeriodNotices,
  type BatchOutcome,
} from "./batch";
import { importBlockers, type FileReview } from "./review-model";

const extracted = (hash = "one") => ({
  rows: bankRows(),
  hash,
  filename: "fictional.pdf",
  method: "embedded-text" as const,
  warnings: [],
});
beforeEach(async () => {
  await clearLocalData();
  await initializeDatabase();
});
afterAll(async () => {
  await db.delete();
});

describe("multi-file review and financial integrity", () => {
  it("detects repeated selected files before saving anything", async () => {
    const first = await prepareDraft(extracted());
    const repeated = await prepareDraft(
      extracted(),
      undefined,
      undefined,
      undefined,
      [first],
    );
    expect(repeated.account.id).toBe(first.account.id);
    expect(repeated.exactDuplicate).toBe(true);
    expect(
      repeated.transactions.every(
        (t) => !t.include && t.duplicate === "certain",
      ),
    ).toBe(true);
    expect(await db.transactions.count()).toBe(0);
  });
  it("rebases new account identities and skips a repeated PDF in one confirmation", async () => {
    const first = await prepareDraft(extracted());
    const second = await prepareDraft(extracted());
    expect(first.account.id).not.toBe(second.account.id);
    const outcomes: BatchOutcome[] = [];
    await commitReviewedBatch(
      [
        { id: "a", draft: first, overrideValidation: false },
        { id: "b", draft: second, overrideValidation: false },
      ],
      (outcome) => outcomes.push(outcome),
    );
    expect(outcomes.map((o) => o.imported)).toEqual([4, 0]);
    expect(outcomes[1].statementSkipped).toBe(true);
    expect(await db.accounts.count()).toBe(1);
    expect(await db.transactions.count()).toBe(4);
    expect(await db.statements.count()).toBe(1);
  });
  it("skips a regenerated all-duplicate document without invalidating the verified account balance", async () => {
    const first = await prepareDraft(extracted());
    const regenerated = await prepareDraft(
      extracted("regenerated"),
      undefined,
      undefined,
      undefined,
      [first],
    );
    const outcomes: BatchOutcome[] = [];
    await commitReviewedBatch(
      [
        { id: "a", draft: first, overrideValidation: false },
        { id: "b", draft: regenerated, overrideValidation: false },
      ],
      (outcome) => outcomes.push(outcome),
    );
    expect(outcomes[1]).toMatchObject({
      imported: 0,
      duplicatesSkipped: 4,
      excludedUnique: 0,
      statementSkipped: true,
    });
    const statements = await db.statements.toArray();
    expect(statements).toHaveLength(1);
    expect(
      verifiedStatements(
        statements,
        await db.transactions.toArray(),
        "2026-10-07",
      ).map((statement) => statement.id),
    ).toEqual([first.statement.id]);
    expect(statements[0].closingBalance).toBe(585950);
  });
  it("reports manually excluded unique rows separately from duplicates", async () => {
    const draft = await prepareDraft(extracted());
    draft.transactions[0].include = false;
    const outcomes: BatchOutcome[] = [];
    await commitReviewedBatch(
      [{ id: "a", draft, overrideValidation: false }],
      (outcome) => outcomes.push(outcome),
    );
    expect(outcomes[0]).toMatchObject({
      imported: 3,
      skipped: 1,
      duplicatesSkipped: 0,
      excludedUnique: 1,
    });
    expect(await db.transactions.count()).toBe(3);
  });
  it("retains support for a genuine printed zero-activity balance statement", async () => {
    const draft = await prepareDraft(extracted());
    draft.transactions = [];
    draft.statement.closingBalance = draft.statement.openingBalance;
    draft.statement.transactionCount = 0;
    const outcomes: BatchOutcome[] = [];
    await commitReviewedBatch(
      [{ id: "a", draft, overrideValidation: false }],
      (outcome) => outcomes.push(outcome),
    );
    expect(outcomes[0]).toMatchObject({ imported: 0, statementSkipped: false });
    const documents = await db.statements.toArray();
    expect(documents).toHaveLength(1);
    expect(verifiedStatements(documents, [], "2026-10-07")).toHaveLength(1);
  });
  it("preserves reviewed financial corrections and category assignments while refreshing", async () => {
    const first = await prepareDraft(extracted());
    const later = await prepareDraft(extracted("later"));
    later.transactions[0].amount = -12150;
    later.transactions[0].categoryId = "childcare";
    later.transactions[0].manualCategory = true;
    later.transactions[0].acknowledged = true;
    await commitDraft(first);
    const refreshed = await refreshReviewedDraft(later);
    expect(refreshed.account.id).toBe(first.account.id);
    expect(refreshed.transactions[0].amount).toBe(-12150);
    expect(refreshed.transactions[0].categoryId).toBe("childcare");
    expect(refreshed.transactions.slice(1).every((t) => !t.include)).toBe(true);
    expect(refreshed.transactions[0].include).toBe(true);
  });
  it("preserves two legitimate identical purchases after date and amount corrections", async () => {
    const draft = await prepareDraft(extracted());
    draft.transactions = draft.transactions.slice(0, 2).map((row) => ({
      ...row,
      date: "2026-09-03",
      description: "FICTIONAL SHOP",
      merchant: "FICTIONAL SHOP",
      amount: -1000,
      balanceAfterTransaction: undefined,
      occurrence: 0,
      manualCategory: true,
      categoryId: "shopping",
    }));
    const refreshed = await refreshReviewedDraft(draft);
    expect(refreshed.transactions.map((row) => row.occurrence)).toEqual([0, 1]);
    expect(refreshed.transactions[0].transactionFingerprint).not.toBe(
      refreshed.transactions[1].transactionFingerprint,
    );
    expect(
      refreshed.transactions.every(
        (row) => row.include && row.duplicate === "none",
      ),
    ).toBe(true);
  });
  it("preflights all known reconciliation errors before saving the first file", async () => {
    const first = await prepareDraft(extracted());
    const wrong = await prepareDraft(extracted("wrong"));
    wrong.transactions[0].amount -= 500;
    await expect(
      commitReviewedBatch(
        [
          { id: "a", draft: first, overrideValidation: false },
          { id: "b", draft: wrong, overrideValidation: false },
        ],
        () => undefined,
      ),
    ).rejects.toThrow("reconciliation");
    expect(await db.transactions.count()).toBe(0);
  });
  it("reports successful files and keeps a later failed statement atomic", async () => {
    const first = await prepareDraft(extracted());
    const second = await prepareDraft(extracted("second"));
    const outcomes: BatchOutcome[] = [];
    await expect(
      commitReviewedBatch(
        [
          { id: "a", draft: first, overrideValidation: false },
          { id: "b", draft: second, overrideValidation: false },
        ],
        (outcome) => outcomes.push(outcome),
        (current) => {
          if (current === "b") {
            // A category was removed in another tab after the preflight.
            second.transactions[0].categoryId = "missing-category";
            second.transactions[0].manualCategory = true;
            second.transactions[0].duplicate = "certain";
            second.transactions[0].acknowledged = true;
          }
        },
      ),
    ).rejects.toThrow("Categories changed");
    expect(outcomes).toHaveLength(1);
    expect(await db.transactions.count()).toBe(4);
    expect(await db.statements.count()).toBe(1);
  });
  it("keeps uncertain money blocking even when categorization can wait", async () => {
    const draft = await prepareDraft(extracted());
    draft.transactions[0].categoryId = undefined;
    const entry: FileReview = {
      id: "a",
      file: new File([], "fictional.pdf"),
      draft,
      state: "review",
      progress: "",
      error: "",
      bank: "",
      accountId: "",
      manualPeriod: false,
      periodStart: "",
      periodEnd: "",
      optionsChanged: false,
      override: false,
      skip: false,
      open: true,
      showAll: false,
      invalidAmounts: [],
    };
    expect(importBlockers(entry)).toEqual([]);
    draft.transactions[0].extractionConfidence = 0.6;
    draft.transactions[0].acknowledged = false;
    expect(importBlockers(entry)).toContain(
      "Verify the highlighted amounts or kept duplicates.",
    );
    entry.skip = true;
    expect(importBlockers(entry)).toEqual([]);
  });
  it("reports period overlaps and only genuine gaps between known statements", async () => {
    const draft = await prepareDraft(extracted());
    const history = [
      {
        accountId: draft.account.id,
        statementPeriodStart: "2026-07-01",
        statementPeriodEnd: "2026-08-28",
      },
      {
        accountId: draft.account.id,
        statementPeriodStart: "2026-09-20",
        statementPeriodEnd: "2026-10-02",
      },
    ];
    expect(statementPeriodNotices(draft, history)).toEqual([
      { kind: "overlap", start: "2026-09-20", end: "2026-09-30" },
      { kind: "gap", start: "2026-08-29", end: "2026-08-31" },
    ]);
    expect(statementPeriodNotices(draft, [])).toEqual([]);
  });
});
