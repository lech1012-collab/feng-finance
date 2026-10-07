import { expect, it } from "vitest";
import {
  budgetOverview,
  paymentPatterns,
  planningForecast,
  readBudget,
  shiftPlannedDate,
} from "./planning";
import { accounts, transaction } from "../tests/helpers";
import { defaultCategories } from "../storage/database";
import type { Statement, Transaction } from "../domain/models";
const docs: Statement[] = [];
const rows: Transaction[] = [];
let balance = 100000;
for (const [month, end] of [
  ["07", "31"],
  ["08", "31"],
  ["09", "30"],
]) {
  const id = `s-${month}`;
  const items = [
    transaction({
      id: `salary-${month}`,
      statementId: id,
      date: `2026-${month}-25`,
      amount: 300000,
      type: "income",
      merchant: "SIEMENS",
      categoryId: "salary",
    }),
    transaction({
      id: `bill-${month}`,
      statementId: id,
      date: `2026-${month}-10`,
      amount: -1200,
      merchant: "NETFLIX",
      categoryId: "subscriptions",
    }),
    transaction({
      id: `shop-${month}`,
      statementId: id,
      date: `2026-${month}-15`,
      amount: -10000,
      merchant: "WAITROSE",
      categoryId: "groceries",
    }),
  ];
  docs.push({
    id,
    accountId: "a1",
    institution: "Barclays",
    currency: "GBP",
    statementPeriodStart: `2026-${month}-01`,
    statementPeriodEnd: `2026-${month}-${end}`,
    openingBalance: balance,
    closingBalance: balance + 288800,
    importedAt: "2026-10-01",
    sourceFilename: "synthetic.pdf",
    sourceFileHash: id,
    parserVersion: "1",
    extractionMethod: "embedded-text",
    validationStatus: "reconciled",
    transactionCount: 3,
    warnings: [],
  });
  rows.push(...items);
  balance += 288800;
}
const plan = (
  tx = rows,
  statements = docs,
  accts = [accounts[0]],
  today = "2026-10-07",
  horizon: 30 | 60 | 90 = 30,
  settings: { key: string; value: string }[] = [],
) => planningForecast(tx, accts, statements, settings, "GBP", today, horizon);
it("validates minor-unit budget settings without accepting malformed values", () => {
  expect(readBudget("0")).toBe(0);
  expect(readBudget("10000")).toBe(10000);
  for (const value of ["bad", "-1", "1.2", '"100"', "{}", "9007199254740992"])
    expect(readBudget(value)).toBeUndefined();
});
it("calculates budget limits, overspending and spending outside configured categories", () => {
  const result = budgetOverview(
    [
      ...rows,
      transaction({
        id: "own",
        date: "2026-09-04",
        amount: -900000,
        categoryId: "groceries",
        isTransfer: true,
      }),
      transaction({
        id: "unknown",
        date: "2026-09-04",
        amount: -2000,
        categoryId: undefined,
      }),
    ],
    [accounts[0]],
    docs,
    defaultCategories,
    [{ key: "budget:GBP:groceries", value: "8000" }],
    "2026-09",
    "GBP",
    "2026-10-07",
  );
  const grocery = result.items.find((i) => i.category.id === "groceries")!;
  expect(grocery.spent).toBe(10000);
  expect(grocery.remaining).toBe(-2000);
  expect(result.totalLimit).toBe(8000);
  expect(result.budgetedSpending).toBe(10000);
  expect(result.unbudgetedSpending).toBe(3200);
});
it("suggests limits only from three complete prior months and keeps currencies separate", () => {
  const result = budgetOverview(
    [...rows, transaction({ currency: "EUR", amount: -999999 })],
    [accounts[0]],
    docs,
    defaultCategories,
    [{ key: "budget:EUR:groceries", value: "123" }],
    "2026-10",
    "GBP",
    "2026-10-07",
  );
  expect(result.items.find((i) => i.category.id === "groceries")!.average).toBe(
    10000,
  );
  expect(result.totalLimit).toBe(0);
  expect(
    budgetOverview(
      rows,
      [accounts[0]],
      docs.slice(1),
      defaultCategories,
      [],
      "2026-10",
      "GBP",
      "2026-10-07",
    ).items[0].average,
  ).toBeUndefined();
});
it("clamps calendar dates without accumulating short-month drift", () => {
  expect(shiftPlannedDate("2026-01-31", 1)).toBe("2026-02-28");
  expect(shiftPlannedDate("2026-01-31", 2)).toBe("2026-03-31");
  expect(shiftPlannedDate("2027-02-28", 12)).toBe("2028-02-28");
});
it("detects recurring income and bills while excluding monthly shopping", () => {
  const patterns = paymentPatterns(rows, [], "GBP", "2026-10-07");
  expect(patterns.map((p) => p.rows[0].merchant).sort()).toEqual([
    "NETFLIX",
    "SIEMENS",
  ]);
  expect(patterns.every((p) => p.cadence === "monthly")).toBe(true);
});
it("recognizes weekly, fortnightly, quarterly and annual bills only with interval evidence", () => {
  for (const [cadence, dates, today] of [
    [
      "weekly",
      ["2026-09-09", "2026-09-16", "2026-09-23", "2026-09-30"],
      "2026-10-01",
    ],
    [
      "fortnightly",
      ["2026-08-19", "2026-09-02", "2026-09-16", "2026-09-30"],
      "2026-10-01",
    ],
    ["quarterly", ["2026-03-10", "2026-06-10", "2026-09-10"], "2026-10-01"],
    ["yearly", ["2025-09-10", "2026-09-10"], "2026-10-01"],
  ] as const) {
    const bills = dates.map((date, i) =>
      transaction({
        id: `${i}`,
        date,
        amount: -1000,
        merchant: "INSURANCE",
        categoryId: "insurance",
      }),
    );
    expect(paymentPatterns(bills, [], "GBP", today)[0].cadence).toBe(cadence);
    expect(paymentPatterns(bills.slice(1), [], "GBP", today)).toEqual([]);
  }
});
it("requires evidence and excludes transfers, refunds, future dates, other accounts and currencies", () => {
  for (const patch of [
    { isTransfer: true },
    { type: "transfer" as const },
    { transferPairId: "pair" },
    { currency: "EUR" },
    { date: "2027-01-01" },
  ])
    expect(
      paymentPatterns(
        rows.map((t) => ({ ...t, ...patch })),
        [],
        "GBP",
        "2026-10-07",
      ),
    ).toEqual([]);
  expect(paymentPatterns(rows.slice(3), [], "GBP", "2026-10-07")).toEqual([]);
  expect(
    paymentPatterns(
      rows.map((t) => ({ ...t, accountId: t.id })),
      [],
      "GBP",
      "2026-10-07",
    ),
  ).toEqual([]);
  expect(
    paymentPatterns(
      rows
        .filter((t) => t.amount > 0)
        .map((t) => ({ ...t, categoryId: "refund" })),
      [],
      "GBP",
      "2026-10-07",
    ),
  ).toEqual([]);
});
it("does not resurrect stale bills or unusually variable income", () => {
  expect(paymentPatterns(rows, [], "GBP", "2027-01-07")).toEqual([]);
  expect(
    paymentPatterns(
      rows
        .filter((t) => t.amount > 0)
        .map((t, i) => ({ ...t, amount: i === 2 ? 10000 : t.amount })),
      [],
      "GBP",
      "2026-10-07",
    ),
  ).toEqual([]);
});
it("uses conservative income and latest bill amounts and honours recorded cancellation", () => {
  const changed = rows.map((t) => ({
    ...t,
    amount:
      t.id === "salary-09" ? 290000 : t.id === "bill-09" ? -1400 : t.amount,
  }));
  const patterns = paymentPatterns(changed, [], "GBP", "2026-10-07");
  expect(patterns.find((p) => p.rows[0].merchant === "SIEMENS")!.amount).toBe(
    290000,
  );
  expect(patterns.find((p) => p.rows[0].merchant === "NETFLIX")!.amount).toBe(
    -1400,
  );
  const settings = [
    {
      key: "subscription:hash",
      value: JSON.stringify({
        status: "cancelled",
        groupKey: JSON.stringify(["a1", "GBP", "NETFLIX", false]),
        date: "2026-09-20",
        amount: 1200,
      }),
    },
  ];
  expect(
    plan(rows, docs, [accounts[0]], "2026-10-07", 30, settings).bills,
  ).toBe(0);
});
it("projects from a shared reconciled snapshot and changes the horizon", () => {
  const result = plan();
  expect(result.reason).toBeUndefined();
  expect(result.anchor!.date).toBe("2026-09-30");
  expect(result.baselineMonths).toBe(3);
  expect(result.income).toBe(300000);
  expect(result.bills).toBe(1200);
  expect(result.points.at(-1)!.date).toBe("2026-11-06");
  expect(result.points.at(-1)!.balance).toBe(
    balance + 300000 - 1200 - Math.round((30000 / 92) * 37),
  );
  expect(
    result.points.every(
      (p) =>
        Number.isSafeInteger(p.balance) &&
        p.lower <= p.balance &&
        p.upper >= p.balance,
    ),
  ).toBe(true);
  expect(plan(rows, docs, [accounts[0]], "2026-10-07", 90).income).toBe(900000);
});
it("withholds forecasts for incomplete, stale, failed or missing-row financial data", () => {
  expect(plan(rows, docs, [accounts[0], accounts[1]]).points).toEqual([]);
  expect(plan(rows, docs.slice(1)).reason).toContain("three complete");
  expect(plan(rows, docs, [accounts[0]], "2026-11-07").reason).toContain(
    "35 days",
  );
  expect(
    plan(
      rows,
      docs.map((s) => ({ ...s, validationStatus: "warning" })),
    ).points,
  ).toEqual([]);
  expect(plan(rows.filter((t) => t.id !== "shop-09")).points).toEqual([]);
  expect(
    plan(
      rows,
      docs.map((s) => ({ ...s, closingBalance: s.closingBalance! + 5000 })),
    ).points,
  ).toEqual([]);
});
it("includes negative card debt in the shared starting position", () => {
  const card = {
    ...docs[2],
    id: "card",
    accountId: "a3",
    openingBalance: -50000,
    closingBalance: -50000,
    transactionCount: 0,
  };
  const result = plan(rows, [...docs, card], [accounts[0], accounts[2]]);
  expect(result.anchor!.total).toBe(balance - 50000);
  expect(result.points).toEqual([]); // Card lacks the three-month baseline.
});
it("does not double-count recurring payments or observed discretionary spending after the anchor", () => {
  const paid = transaction({
    id: "paid",
    date: "2026-10-10",
    merchant: "NETFLIX",
    categoryId: "subscriptions",
    amount: -1200,
  });
  const purchase = transaction({
    id: "extra",
    date: "2026-10-11",
    merchant: "WAITROSE",
    categoryId: "groceries",
    amount: -50000,
  });
  const result = plan(
    [...rows, paid, purchase],
    docs,
    [accounts[0]],
    "2026-10-12",
  );
  const now = result.points.find((p) => p.date === "2026-10-12")!;
  expect(now.balance).toBe(balance - 1200 - 50000);
  expect(result.bills).toBe(1200); // Next Netflix date falls within the 30 days.
  expect(result.upcoming.filter((p) => p.merchant === "NETFLIX")).toHaveLength(
    1,
  );
});
