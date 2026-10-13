import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db, initializeDatabase } from "../storage/database";
import { clearLocalData } from "../storage/backup";
import type { ImportDraft } from "../domain/models";
import { genericFixture } from "./generic/fixtures";
import { groupedBarclaysItems } from "../tests/barclays-grouped";
import { reconstructRows } from "./layout";
import {
  commitDraft,
  draftReconciliation,
  prepareDraft,
  validateDraft,
  type ExtractedFile,
} from "./pipeline";

function statement(hash = "bank-source-original"): ExtractedFile {
  const fixture = genericFixture("T1");
  return {
    rows: reconstructRows(
      fixture.items.map((item) => ({ ...item, y: item.y + item.height })),
    ),
    hash,
    filename: "fictional-bank.pdf",
    method: "embedded-text",
    warnings: [],
    extraction: {
      ...fixture,
      quality: [],
      pageCount: fixture.pages.length,
      completedPages: fixture.pages.map((page) => page.page),
      unreadPages: [],
      cancelled: false,
      method: "text",
    },
  };
}
async function provedDraft() {
  const draft = await prepareDraft(statement());
  expect(draft.parserFallback).toBe(true);
  expect(draftReconciliation(draft)).toMatchObject({
    status: "reconciled",
    difference: 0,
  });
  return draft;
}

beforeEach(async () => {
  await clearLocalData();
  await initializeDatabase();
});
afterAll(async () => {
  await db.delete();
});

describe("proved bank source integrity after review edits", () => {
  it("blocks offsetting credit and debit changes even when the net still reconciles", async () => {
    const draft = await provedDraft();
    draft.transactions[0].amount += 1;
    draft.transactions[1].amount -= 1;
    expect(draftReconciliation(draft)).toMatchObject({
      status: "warning",
      difference: 0,
    });
    expect(() => validateDraft(draft, false)).toThrow("Recheck");
    expect(() => validateDraft(draft, true)).toThrow("Recheck");
    await expect(commitDraft(draft, true)).rejects.toThrow("Recheck");
    expect(await db.transactions.count()).toBe(0);
    expect(await db.statements.count()).toBe(0);
  });
  it("also blocks redistribution between two expenses that leaves both net and gross totals unchanged", async () => {
    const draft = await provedDraft();
    draft.transactions[1].amount += 100;
    draft.transactions[2].amount -= 100;
    expect(draftReconciliation(draft)).toMatchObject({
      status: "warning",
      difference: 0,
    });
    await expect(commitDraft(draft, true)).rejects.toThrow("Source readings");
    expect(await db.transactions.count()).toBe(0);
  });
  it("does not let an override silently accept a wrong debit sign", async () => {
    const draft = await provedDraft();
    draft.transactions[1].amount *= -1;
    expect(draftReconciliation(draft)).toMatchObject({
      status: "warning",
      difference: -20000,
    });
    await expect(commitDraft(draft, true)).rejects.toThrow("Source readings");
    expect(await db.transactions.count()).toBe(0);
  });
  it.each([
    "date",
    "bookingDate",
    "currency",
    "balanceAfterTransaction",
    "sourcePage",
    "duplicate-source-id",
  ] as const)("requires source recheck for a changed %s", async (field) => {
    const draft = await provedDraft();
    const row = draft.transactions[1];
    if (field === "date") row.date = "2026-09-03";
    else if (field === "bookingDate") row.bookingDate = "2026-09-03";
    else if (field === "currency") row.currency = "EUR";
    else if (field === "balanceAfterTransaction")
      row.balanceAfterTransaction = undefined;
    else if (field === "sourcePage") row.sourcePage++;
    else row.parseRowId = draft.transactions[0].parseRowId;
    expect(draftReconciliation(draft).status).toBe("warning");
    await expect(commitDraft(draft, true)).rejects.toThrow("Source readings");
    expect(await db.transactions.count()).toBe(0);
  });
  it("allows categorization, merchant, tags and transfer decisions without rereading unchanged financial facts", async () => {
    const draft = await provedDraft();
    const category = (await db.categories.toArray()).find(
      (entry) => entry.name === "Groceries" && !entry.parentId,
    )!;
    const row = draft.transactions[1];
    row.categoryId = category.id;
    row.manualCategory = true;
    row.merchant = "FICTIONAL GROCER";
    row.tags = ["Household"];
    draft.transactions[2].type = "transfer";
    draft.transactions[2].isTransfer = true;
    draft.transactions.reverse();
    expect(draftReconciliation(draft).status).toBe("reconciled");
    expect(validateDraft(draft, false).status).toBe("reconciled");
    await commitDraft(draft);
    expect(await db.transactions.get(row.id)).toMatchObject({
      categoryId: category.id,
      merchant: "FICTIONAL GROCER",
      tags: ["Household"],
      amount: -10000,
    });
    expect(await db.transactions.count()).toBe(3);
  });
  it("continues checking all source occurrences when previously imported duplicates are excluded from addition", async () => {
    const initial = await provedDraft();
    await commitDraft(initial);
    const repeated = await prepareDraft(statement("regenerated-bank-source"));
    expect(repeated.parserFallback).toBe(true);
    expect(repeated.transactions).toHaveLength(3);
    expect(repeated.transactions.every((row) => !row.include)).toBe(true);
    expect(draftReconciliation(repeated).status).toBe("reconciled");
    await commitDraft(repeated);
    expect(await db.transactions.count()).toBe(3);
    expect(await db.statements.count()).toBe(2);
  });
  it("does not count a single source occurrence twice or omit a row from source arithmetic", async () => {
    const draft = await provedDraft();
    draft.transactions.splice(1, 1);
    expect(draftReconciliation(draft).status).toBe("warning");
    await expect(commitDraft(draft, true)).rejects.toThrow("Source readings");
    expect(await db.transactions.count()).toBe(0);
  });
  it("checks independently printed gross figures even when source balances still match", async () => {
    const draft = await provedDraft();
    const checks = draft.parserReview!.checks;
    checks.printedMoneyIn = checks.calculatedMoneyIn + 1;
    checks.printedMoneyOut = checks.calculatedMoneyOut + 1;
    expect(draftReconciliation(draft)).toMatchObject({
      status: "warning",
      difference: 0,
    });
    expect(() => validateDraft(draft, false)).toThrow("reconciliation");
  });
  it("preserves a corrected purchase and booking date without changing the next blank-date salary", async () => {
    const items = groupedBarclaysItems().map((item) => ({
      ...item,
      fontSize: item.height,
      parseSource: "text" as const,
    }));
    const purchaseNotice = items.find(
      (item) => item.page === 1 && item.y === 214 && item.x === 100,
    )!;
    purchaseNotice.text = "On 01 Sep";
    purchaseNotice.width = purchaseNotice.text.length * 4;
    const file = statement("bank-corrected-purchase-booking");
    file.rows = reconstructRows(items);
    file.extraction = {
      ...file.extraction!,
      items,
      pages: file.extraction!.pages.slice(0, 2),
      pageCount: 2,
      completedPages: [1, 2],
    };
    const original = await prepareDraft(file);
    expect(original.parserFallback).toBe(true);
    const purchase = original.transactions[0];
    expect(purchase.date).toBe("2026-09-03");
    expect(purchase.description).toContain("ON 01 SEP");
    const corrected = await prepareDraft(
      file,
      undefined,
      undefined,
      undefined,
      [],
      undefined,
      {
        skipCellOcr: true,
        actions: {
          [purchase.parseRowId!]: {
            kind: "correct",
            date: "2026-09-01",
            bookingDate: "2026-09-03",
            description: purchase.description,
            amount: purchase.amount + 1,
          },
        },
      },
    );
    expect(corrected.parserFallback).toBe(false);
    expect(corrected.transactions[0]).toMatchObject({
      date: "2026-09-01",
      bookingDate: "2026-09-03",
      amount: -999,
      parseSource: "user",
    });
    expect(corrected.transactions[1]).toMatchObject({
      date: "2026-09-03",
      amount: 20000,
    });
    expect(draftReconciliation(corrected).status).toBe("warning");
    await commitDraft({ ...corrected, reviewedWarnings: true }, true);
    expect(
      await db.transactions.get(corrected.transactions[0].id),
    ).toMatchObject({
      date: "2026-09-01",
      bookingDate: "2026-09-03",
      amount: -999,
    });
    expect(
      await db.transactions.get(corrected.transactions[1].id),
    ).toMatchObject({
      date: "2026-09-03",
      amount: 20000,
    });
  });
  it("routes a real source correction through generic row actions and retains explicit Unverified validation", async () => {
    const file = statement();
    const original = await prepareDraft(file);
    expect(original.parserFallback).toBe(true);
    const row = original.transactions[1];
    const corrected = await prepareDraft(
      file,
      undefined,
      undefined,
      undefined,
      [],
      undefined,
      {
        skipCellOcr: true,
        actions: {
          [row.parseRowId!]: {
            kind: "correct",
            date: row.date,
            description: row.description,
            amount: row.amount + 1,
          },
        },
      },
    );
    expect(corrected.parserFallback).toBe(false);
    expect(corrected.transactions[1].parseSource).toBe("user");
    expect(draftReconciliation(corrected).status).toBe("warning");
    const reviewed: ImportDraft = { ...corrected, reviewedWarnings: true };
    expect(() => validateDraft(reviewed, false)).toThrow(
      /review|reconciliation/i,
    );
    await commitDraft(reviewed, true);
    expect(
      await db.transactions.get(corrected.transactions[1].id),
    ).toMatchObject({
      amount: -9999,
      parseSource: "user",
    });
    expect(await db.statements.get(corrected.statement.id)).toMatchObject({
      validationStatus: "warning",
      validationOverride: true,
    });
  });
});
