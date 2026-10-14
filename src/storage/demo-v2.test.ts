import { beforeEach, afterAll, expect, it, vi } from "vitest";
import { db } from "./database";
import { loadDemo, deleteDemo } from "./demo";
import { clearLocalData, createBackup, validateBackup } from "./backup";
import { undoChange } from "./audit";
import { transaction, accounts } from "../tests/helpers";
import { cashFlow } from "../analytics/calculations";
import { monthOffset } from "../domain/dates";

it("generates completed statements, valuations and cached rates without any future records", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-01-13T12:00:00Z"));
  try {
    await loadDemo();
    const backup = await createBackup();
    expect(
      backup.statements.every((row) => row.statementPeriodEnd <= "2025-12-31"),
    ).toBe(true);
    expect(backup.transactions.every((row) => row.date <= "2025-12-31")).toBe(
      true,
    );
    expect(backup.valuations?.every((row) => row.date <= "2026-01-13")).toBe(
      true,
    );
    expect(backup.fxRates?.every((row) => row.date <= "2026-01-13")).toBe(true);
    expect(backup.fxRates?.some((row) => row.date === "2026-01-13")).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});

beforeEach(async () => {
  await clearLocalData();
});
afterAll(async () => {
  await db.delete();
});
it("provides a financially valid and traceable example for every v2 core journey", async () => {
  const loaded = await loadDemo();
  const backup = validateBackup(await createBackup());
  expect(backup.accounts).toHaveLength(8);
  expect(
    backup.valuations?.map((row) => row.valueMinor).sort((a, b) => a - b),
  ).toEqual([28000000, 45000000]);
  const salary = backup.transactions.filter(
    (row) => row.categoryId === "salary",
  );
  expect(salary).toHaveLength(7);
  expect(salary.every((row) => row.date.endsWith("-25"))).toBe(true);
  expect(
    backup.transferProposals?.some((row) => row.status === "pending"),
  ).toBe(true);
  const refund = backup.transactions.find((row) => row.kind === "refund")!;
  const purchase = backup.transactions.find(
    (row) => row.id === refund.refundAllocations?.[0].transactionId,
  )!;
  expect(purchase.date.slice(0, 7)).not.toBe(refund.date.slice(0, 7));
  expect(refund.refundAllocations?.[0].amount).toBe(5000);
  const parent = backup.transactions.find(
    (row) => row.kind === "split_parent",
  )!;
  expect(
    backup.transactions
      .filter((row) => row.parentId === parent.id)
      .map((row) => row.amount)
      .sort((a, b) => a - b),
  ).toEqual([-4500, -1500]);
  expect(backup.recurringSeries?.[0].amountHistory.at(-1)?.amountMinor).toBe(
    -1499,
  );
  expect(backup.pots?.[0].targetMinor).toBe(54000);
  expect(
    backup.fxRates?.some((row) => row.base === "EUR" && row.quote === "GBP"),
  ).toBe(true);
  expect(
    backup.statements.filter((row) => row.accountId === "demo-revolut"),
  ).toHaveLength(5);
  await undoChange(loaded.changeId);
  expect(await db.accounts.count()).toBe(0);
  expect(await db.transactions.count()).toBe(0);
  expect(await db.fxRates.count()).toBe(0);
});
it("deletes demo entities without erasing real data and supports one Undo", async () => {
  await loadDemo();
  await db.accounts.put(accounts[0]);
  await db.transactions.put(
    transaction({
      id: "real-entry",
      source: "manual",
      statementId: "",
      tags: ["real-tag"],
    }),
  );
  await db.tags.put({
    id: "real-tag",
    name: "Family",
    colour: "#6EA8FF",
    archived: false,
  });
  await db.valuations.put({
    id: "real-value",
    accountId: accounts[0].id,
    date: "2026-10-01",
    valueMinor: 50000,
  });
  await db.pots.put({
    id: "real-pot",
    type: "goal",
    name: "Holiday",
    targetMinor: 100000,
    currency: "GBP",
    linkedAccountId: "demo-savings",
    contributions: [],
    createdAt: new Date().toISOString(),
  });
  await db.fxRates.put({
    id: "real-fx",
    date: "2026-10-01",
    base: "EUR",
    quote: "GBP",
    rate: "0.85",
    source: "manual",
  });
  const removed = await deleteDemo();
  expect(await db.accounts.count()).toBe(1);
  expect(await db.transactions.count()).toBe(1);
  expect((await db.tags.toArray()).map((row) => row.id)).toEqual(["real-tag"]);
  expect((await db.valuations.toArray()).map((row) => row.id)).toEqual([
    "real-value",
  ]);
  expect((await db.pots.get("real-pot"))?.linkedAccountId).toBeUndefined();
  expect((await db.fxRates.toArray()).map((row) => row.id)).toEqual([
    "real-fx",
  ]);
  validateBackup(await createBackup());
  await undoChange(removed.changeId);
  expect(await db.accounts.count()).toBe(9);
  expect((await db.pots.get("real-pot"))?.linkedAccountId).toBe("demo-savings");
  validateBackup(await createBackup());
});

it("refreshes a closed mixed month in the same demo deletion and Undo", async () => {
  await loadDemo();
  const month = monthOffset(new Date().toISOString().slice(0, 7), -1);
  await db.accounts.put(accounts[0]);
  await db.transactions.put(
    transaction({
      id: "real-expense",
      source: "manual",
      statementId: "",
      date: `${month}-02`,
      categoryId: "shopping",
      amount: -1000,
    }),
  );
  const prior = {
    month,
    currency: "GBP",
    closedAt: new Date().toISOString(),
    snapshot: {
      income: 99999,
      expenses: 77777,
      net: 22222,
      transactionCount: 99,
    },
  };
  await db.monthCloses.put(prior);
  const removed = await deleteDemo();
  expect((await db.monthCloses.get(month))?.snapshot).toMatchObject({
    income: 0,
    expenses: 1000,
    net: -1000,
    transactionCount: 1,
    categoryTotals: { shopping: 1000 },
  });
  expect(
    (await db.changeLog.get(removed.changeId))?.changes.some(
      (change) => change.table === "monthCloses",
    ),
  ).toBe(true);
  await undoChange(removed.changeId);
  expect(await db.monthCloses.get(month)).toEqual(prior);
});

it("keeps a mixed manual refund valid when a demo purchase is deleted", async () => {
  await loadDemo();
  const demoPurchase = (await db.transactions.toArray()).find(
    (row) => row.description === "WAITROSE FULHAM",
  )!;
  await db.accounts.put(accounts[0]);
  const realPurchase = transaction({
    id: "real-purchase",
    accountId: accounts[0].id,
    date: demoPurchase.date,
    amount: -1000,
    source: "manual",
    sourcePage: 0,
    statementId: "",
  });
  const refund = transaction({
    id: "mixed-refund",
    accountId: accounts[0].id,
    date: new Date().toISOString().slice(0, 10),
    amount: 6000,
    type: "income",
    kind: "refund",
    source: "manual",
    sourcePage: 0,
    statementId: "",
    isReviewed: true,
    refundAllocations: [
      { transactionId: demoPurchase.id, amount: 5000 },
      { transactionId: realPurchase.id, amount: 1000 },
    ],
  });
  await db.transactions.bulkPut([realPurchase, refund]);
  validateBackup(await createBackup());
  const removed = await deleteDemo();
  expect(await db.transactions.count()).toBe(2);
  expect(await db.transactions.get(refund.id)).toMatchObject({
    kind: "refund",
    amount: 6000,
    isReviewed: false,
  });
  expect(
    (await db.transactions.get(refund.id))?.refundAllocations,
  ).toBeUndefined();
  expect(cashFlow(await db.transactions.toArray(), "GBP")).toMatchObject({
    income: 0,
    expenses: 1000,
    net: -1000,
  });
  validateBackup(await createBackup());
  await undoChange(removed.changeId);
  expect((await db.transactions.get(refund.id))?.refundAllocations).toEqual(
    refund.refundAllocations,
  );
  expect((await db.transactions.get(refund.id))?.isReviewed).toBe(true);
  validateBackup(await createBackup());
});
