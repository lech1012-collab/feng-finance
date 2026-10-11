import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Statement } from "../domain/models";
import { accounts, transaction } from "../tests/helpers";
import { db, initializeDatabase } from "./database";
import {
  authorizeMonthEdit,
  closeMonth,
  ClosedMonthError,
  ensureMonthsOpen,
} from "./month-review";
import { editTransaction } from "./transactions";
import { linkRefund } from "./accuracy";
import { undoChange } from "./audit";
const purchase = transaction({
  id: "purchase",
  date: "2026-08-14",
  statementId: "august",
  categoryId: "shopping",
  amount: -4000,
  isReviewed: true,
});
const refund = transaction({
  id: "refund",
  date: "2026-09-04",
  statementId: "september",
  amount: 4000,
  type: "income",
  merchant: purchase.merchant,
  categoryId: "refund",
  kind: "refund",
  isReviewed: false,
});
function statement(
  month: string,
  id: string,
  opening: number,
  closing: number,
): Statement {
  return {
    id,
    institution: "Barclays",
    accountId: "a1",
    statementPeriodStart: `${month}-01`,
    statementPeriodEnd: `${month}-${month === "2026-08" ? "31" : "30"}`,
    openingBalance: opening,
    closingBalance: closing,
    currency: "GBP",
    sourceFilename: "Fictitious statement",
    sourceFileHash: id,
    importedAt: "2026-10-08T00:00:00.000Z",
    parserVersion: "synthetic",
    extractionMethod: "embedded-text",
    validationStatus: "reconciled",
    transactionCount: 1,
    warnings: [],
  };
}
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-08T12:00:00Z"));
  await db.transaction("rw", db.tables, async () => {
    for (const table of db.tables) await table.clear();
  });
  await initializeDatabase();
  await db.accounts.add(accounts[0]);
  await db.statements.bulkAdd([
    statement("2026-08", "august", 10000, 6000),
    statement("2026-09", "september", 6000, 10000),
  ]);
  await db.transactions.bulkAdd([purchase, refund]);
});
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await db.transaction("rw", db.tables, async () => {
    for (const table of db.tables) await table.clear();
  });
});
describe("closed monthly review integrity", () => {
  it("refuses financial edits until the closed month is explicitly reopened", async () => {
    await closeMonth("2026-08", "GBP");
    const before = await db.monthCloses.get("2026-08");
    await expect(ensureMonthsOpen([purchase])).rejects.toBeInstanceOf(
      ClosedMonthError,
    );
    await expect(
      editTransaction(purchase.id, {
        merchant: purchase.merchant,
        categoryId: "groceries",
        subcategoryId: undefined,
        type: "expense",
        tags: [],
      }),
    ).rejects.toBeInstanceOf(ClosedMonthError);
    expect((await db.transactions.get(purchase.id))?.categoryId).toBe(
      "shopping",
    );
    const confirmation = vi.spyOn(window, "confirm").mockReturnValue(false);
    expect(await authorizeMonthEdit([purchase])).toBe(false);
    expect(await db.monthCloses.get("2026-08")).toEqual(before);
    expect(confirmation).toHaveBeenCalledWith(
      "This changes a closed month. Reopen?",
    );
    confirmation.mockReturnValue(true);
    expect(await authorizeMonthEdit([purchase])).toBe(true);
    expect(await db.monthCloses.get("2026-08")).toBeUndefined();
    await editTransaction(purchase.id, {
      merchant: purchase.merchant,
      categoryId: "groceries",
      subcategoryId: undefined,
      type: "expense",
      tags: [],
    });
    expect((await db.transactions.get(purchase.id))?.categoryId).toBe(
      "groceries",
    );
  });
  it("updates a closed original purchase month automatically for a later refund, with atomic Undo", async () => {
    await closeMonth("2026-08", "GBP");
    const closed = (await db.monthCloses.get("2026-08"))!;
    expect(closed.snapshot.expenses).toBe(4000);
    const confirmation = vi.spyOn(window, "confirm").mockReturnValue(false);
    const linked = await linkRefund(refund.id, [
      { transactionId: purchase.id, amount: 4000 },
    ]);
    const after = (await db.monthCloses.get("2026-08"))!;
    expect(after.closedAt).toBe(closed.closedAt);
    expect(after.snapshot.expenses).toBe(0);
    expect(after.snapshot.income).toBe(0);
    expect(after.snapshot.net).toBe(0);
    expect(confirmation).not.toHaveBeenCalled();
    expect((await db.transactions.get(refund.id))?.date).toBe("2026-09-04");
    await undoChange(linked.changeId);
    expect((await db.monthCloses.get("2026-08"))?.snapshot).toEqual(
      closed.snapshot,
    );
    expect(
      (await db.transactions.get(refund.id))?.refundAllocations,
    ).toBeUndefined();
  });
  it("refuses to close a period without complete verified statement coverage", async () => {
    await db.statements.delete("august");
    await expect(closeMonth("2026-08", "GBP")).rejects.toThrow(
      "Complete and verified",
    );
    expect(await db.monthCloses.get("2026-08")).toBeUndefined();
  });
});
