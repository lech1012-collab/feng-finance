import { expect, it } from "vitest";
import { reportingPlanningForecast } from "./reporting-forecast";
import { transaction, accounts } from "../tests/helpers";
import type {
  Account,
  FxRate,
  Statement,
  Transaction,
  RecurringSeries,
} from "../domain/models";

function history(account: Account) {
  const rows: Transaction[] = [];
  const statements: Statement[] = [];
  let balance = 100000;
  for (const [month, end] of [
    ["07", "31"],
    ["08", "31"],
    ["09", "30"],
  ]) {
    const id = `${account.id}-${month}`;
    const changes = [
      transaction({
        id: `${id}-salary`,
        accountId: account.id,
        statementId: id,
        currency: account.currency,
        date: `2026-${month}-25`,
        amount: 300000,
        merchant: "Salary",
        categoryId: "salary",
        type: "income",
      }),
      transaction({
        id: `${id}-bill`,
        accountId: account.id,
        statementId: id,
        currency: account.currency,
        date: `2026-${month}-10`,
        amount: -1200,
        merchant: "NETFLIX",
        categoryId: "subscriptions",
      }),
      transaction({
        id: `${id}-shop`,
        accountId: account.id,
        statementId: id,
        currency: account.currency,
        date: `2026-${month}-15`,
        amount: -10000,
        merchant: "WAITROSE",
        categoryId: "groceries",
      }),
    ];
    rows.push(...changes);
    statements.push({
      id,
      accountId: account.id,
      institution: account.institution,
      currency: account.currency,
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
    balance += 288800;
  }
  return { rows, statements };
}
const eur = { ...accounts[1], currency: "EUR" };
const gbp = history(accounts[0]),
  euros = history(eur);
const rates: FxRate[] = [
  {
    id: "rate",
    date: "2026-10-02",
    base: "EUR",
    quote: "GBP",
    rate: "0.5",
    source: "manual",
  },
];
const netflix: RecurringSeries = {
  id: "confirmed",
  matchKey: JSON.stringify([accounts[0].id, "GBP", "NETFLIX", false]),
  name: "Streaming",
  accountId: accounts[0].id,
  currency: "GBP",
  cadence: "monthly",
  expectedAmountMinor: -2000,
  amountHistory: [],
  nextDue: "2026-10-10",
  status: "active",
};
it("confirmed recurring edits replace inferred bills once and use their due date in the baseline", () => {
  const baseline = reportingPlanningForecast(
    gbp.rows,
    [accounts[0]],
    gbp.statements,
    [],
    "GBP",
    "2026-10-07",
    30,
    [],
  );
  const edited = reportingPlanningForecast(
    gbp.rows,
    [accounts[0]],
    gbp.statements,
    [],
    "GBP",
    "2026-10-07",
    30,
    [],
    [netflix],
  );
  expect(edited.reason).toBeUndefined();
  expect(edited.upcoming.filter((p) => p.originalAmount < 0)).toMatchObject([
    { date: "2026-10-10", amount: -2000, merchant: "Streaming" },
  ]);
  expect(edited.dailyVariable).toBe(baseline.dailyVariable);
  expect(edited.points.find((p) => p.date === "2026-10-09")?.balance).toBe(
    baseline.points.find((p) => p.date === "2026-10-09")?.balance,
  );
  expect(edited.points.find((p) => p.date === "2026-10-10")?.balance).toBe(
    baseline.points.find((p) => p.date === "2026-10-10")!.balance - 800,
  );
});
it("a confirmed new annual bill appears once while ignored or ended series do not reappear through inference", () => {
  const ignored = { ...netflix, status: "ignored" as const };
  const annual = {
    ...netflix,
    id: "annual",
    matchKey: "manual",
    name: "Car insurance",
    cadence: "annual" as const,
    expectedAmountMinor: -54000,
    nextDue: "2026-10-15",
  };
  const forecast = reportingPlanningForecast(
    gbp.rows,
    [accounts[0]],
    gbp.statements,
    [],
    "GBP",
    "2026-10-07",
    30,
    [],
    [ignored, annual],
  );
  expect(forecast.upcoming.filter((p) => p.originalAmount < 0)).toMatchObject([
    { merchant: "Car insurance", date: "2026-10-15", amount: -54000 },
  ]);
  const ended = reportingPlanningForecast(
    gbp.rows,
    [accounts[0]],
    gbp.statements,
    [],
    "GBP",
    "2026-10-07",
    30,
    [],
    [{ ...netflix, endDate: "2026-10-01" }],
  );
  expect(ended.upcoming.some((p) => p.originalAmount < 0)).toBe(false);
});
it("reconciles both native ledgers before combining reporting forecasts and does not mutate EUR originals", () => {
  const rows = [...gbp.rows, ...euros.rows];
  const forecast = reportingPlanningForecast(
    rows,
    [accounts[0], eur],
    [...gbp.statements, ...euros.statements],
    [],
    "GBP",
    "2026-10-07",
    30,
    rates,
  );
  expect(forecast.reason).toBeUndefined();
  expect(forecast.converted).toBe(true);
  expect(forecast.anchor?.total).toBe(1449600);
  expect(forecast.income).toBe(450000);
  expect(forecast.bills).toBe(1800);
  expect(forecast.rateDates).toEqual(["2026-10-02"]);
  expect(
    rows
      .filter((t) => t.accountId === eur.id)
      .every((t) => t.currency === "EUR"),
  ).toBe(true);
  expect(euros.statements.at(-1)?.closingBalance).toBe(966400);
});
it("missing cached FX rates prevent a total projection rather than hiding the foreign account", () => {
  const forecast = reportingPlanningForecast(
    [...gbp.rows, ...euros.rows],
    [accounts[0], eur],
    [...gbp.statements, ...euros.statements],
    [],
    "GBP",
    "2026-10-07",
    30,
    [],
  );
  expect(forecast.reason).toContain("every account currency");
  expect(forecast.points).toEqual([]);
  expect(forecast.income).toBeUndefined();
  expect(forecast.bills).toBeUndefined();
  const missing = forecast.upcoming.filter((p) => p.originalCurrency === "EUR");
  expect(missing.length).toBeGreaterThan(0);
  expect(missing.every((p) => p.amount === undefined && p.missingRate)).toBe(
    true,
  );
  expect(missing.some((p) => p.originalAmount === -1200)).toBe(true);
});
it("a broken native EUR reconciliation prevents the combined forecast even when rates exist", () => {
  const statements = euros.statements.map((s) => ({
    ...s,
    closingBalance: s.closingBalance! + 100,
  }));
  const forecast = reportingPlanningForecast(
    [...gbp.rows, ...euros.rows],
    [accounts[0], eur],
    [...gbp.statements, ...statements],
    [],
    "GBP",
    "2026-10-07",
    30,
    rates,
  );
  expect(forecast.reason).toContain("verified balance");
  expect(forecast.points).toEqual([]);
});
