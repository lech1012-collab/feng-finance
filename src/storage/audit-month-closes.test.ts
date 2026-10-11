import { beforeEach, expect, it } from "vitest";
import { db } from "./database";
import { clearLocalData } from "./backup";
import { auditedMutation, undoChange } from "./audit";
import { transaction } from "../tests/helpers";

const close = (month: string) => ({
  month,
  currency: "GBP",
  closedAt: new Date().toISOString(),
  snapshot: { income: 0, expenses: 4000, net: -4000, transactionCount: 1 },
});
beforeEach(async () => {
  await clearLocalData();
});

it("requires reopening a month before Undoing a transaction edit made before its close", async () => {
  await db.transactions.put(
    transaction({ id: "purchase", date: "2026-09-04", categoryId: "shopping" }),
  );
  const edited = await auditedMutation(
    "Categorize purchase",
    ["transactions"],
    () => db.transactions.update("purchase", { categoryId: "groceries" }),
  );
  await db.monthCloses.put(close("2026-09"));
  await expect(undoChange(edited.changeId)).rejects.toThrow(
    "Reopen it before using Undo",
  );
  expect((await db.transactions.get("purchase"))?.categoryId).toBe("groceries");
  expect((await db.changeLog.get(edited.changeId))?.undoneAt).toBeUndefined();
  await db.monthCloses.delete("2026-09");
  await undoChange(edited.changeId);
  expect((await db.transactions.get("purchase"))?.categoryId).toBe("shopping");
});

it("checks a restored transaction date against fixed reporting periods", async () => {
  await db.settings.put({
    key: "period:start",
    value: JSON.stringify({ mode: "fixed", day: 25 }),
  });
  await db.transactions.put(transaction({ id: "moved", date: "2026-08-26" }));
  const edited = await auditedMutation("Correct date", ["transactions"], () =>
    db.transactions.update("moved", { date: "2026-09-26" }),
  );
  await db.monthCloses.put(close("2026-09"));
  await expect(undoChange(edited.changeId)).rejects.toThrow("closed month");
  expect((await db.transactions.get("moved"))?.date).toBe("2026-09-26");
});

it("protects payday boundaries even when the changed salary is outside the frozen period", async () => {
  await db.settings.put({
    key: "period:start",
    value: JSON.stringify({ mode: "payday", day: 25 }),
  });
  await db.transactions.bulkPut([
    transaction({
      id: "august-salary",
      date: "2026-08-25",
      amount: 500000,
      type: "income",
      categoryId: "salary",
    }),
    transaction({
      id: "september-salary",
      date: "2026-09-25",
      amount: 500000,
      type: "income",
      categoryId: "salary",
    }),
    transaction({
      id: "later-credit",
      date: "2026-09-26",
      amount: 10000,
      type: "income",
      categoryId: "salary",
    }),
  ]);
  const edited = await auditedMutation(
    "Correct credit category",
    ["transactions"],
    () =>
      db.transactions.update("later-credit", { categoryId: "other-income" }),
  );
  await db.monthCloses.put(close("2026-09"));
  await expect(undoChange(edited.changeId)).rejects.toThrow("closed month");
  expect((await db.transactions.get("later-credit"))?.categoryId).toBe(
    "other-income",
  );
});

it("protects a closed original purchase month when a refund Undo has no captured snapshot", async () => {
  await db.transactions.bulkPut([
    transaction({ id: "purchase", date: "2026-08-04", amount: -4000 }),
    transaction({
      id: "refund",
      date: "2026-09-04",
      amount: 4000,
      type: "income",
      kind: "refund",
    }),
  ]);
  const edited = await auditedMutation(
    "Link refund before closing",
    ["transactions"],
    () =>
      db.transactions.update("refund", {
        refundAllocations: [{ transactionId: "purchase", amount: 4000 }],
      }),
  );
  await db.monthCloses.put(close("2026-08"));
  await expect(undoChange(edited.changeId)).rejects.toThrow("closed month");
  expect((await db.transactions.get("refund"))?.refundAllocations).toHaveLength(
    1,
  );
});

it("can Undo a transaction and its own newly created close atomically", async () => {
  const edited = await auditedMutation(
    "Add and close purchase",
    ["transactions", "monthCloses"],
    async () => {
      await db.transactions.put(
        transaction({ id: "purchase", date: "2026-09-04", amount: -4000 }),
      );
      await db.monthCloses.put(close("2026-09"));
    },
  );
  await undoChange(edited.changeId);
  expect(await db.transactions.get("purchase")).toBeUndefined();
  expect(await db.monthCloses.get("2026-09")).toBeUndefined();
});
