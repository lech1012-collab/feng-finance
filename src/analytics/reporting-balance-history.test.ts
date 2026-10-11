import { expect, it } from "vitest";
import { accounts, transaction } from "../tests/helpers";
import type { Account, FxRate, Statement } from "../domain/models";
import { reportingBalanceHistory } from "./reporting-balance-history";
export const bankRows = [
  transaction({
    id: "salary",
    date: "2026-09-01",
    amount: 500000,
    type: "income",
    categoryId: "salary",
  }),
  transaction({
    id: "shop",
    date: "2026-09-15",
    amount: -10000,
    categoryId: "groceries",
  }),
];
export const bankStatement: Statement = {
  id: "s1",
  accountId: "a1",
  institution: "Barclays",
  currency: "GBP",
  statementPeriodStart: "2026-09-01",
  statementPeriodEnd: "2026-09-30",
  openingBalance: 100000,
  closingBalance: 590000,
  importedAt: "2026-10-01",
  sourceFilename: "synthetic.pdf",
  sourceFileHash: "hash",
  parserVersion: "2",
  extractionMethod: "embedded-text",
  validationStatus: "reconciled",
  transactionCount: 2,
  warnings: [],
};
export const card: Account = {
  ...accounts[2],
  displayName: "Barclaycard",
  institution: "Barclays",
};
export const cardRow = transaction({
  id: "cardpurchase",
  accountId: card.id,
  statementId: "card-statement",
  date: "2026-09-05",
  amount: -10968,
});
export const cardStatement: Statement = {
  ...bankStatement,
  id: "card-statement",
  accountId: card.id,
  statementPeriodStart: "2026-09-05",
  statementPeriodEnd: "2026-09-30",
  periodSource: "transaction-coverage",
  statementDate: "2026-10-02",
  openingBalance: 0,
  closingBalance: -10968,
  transactionCount: 1,
};
it("one bank statement gives a real daily trend from opening balance through purchases", () => {
  const history = reportingBalanceHistory(
    [accounts[0]],
    [bankStatement],
    bankRows,
    [],
    [],
    "2026-09",
    "GBP",
    1,
    "2026-10-08",
  );
  expect(history.meaningful).toBe(true);
  expect(history.start).toBe("2026-08-30");
  expect(history.data.find((p) => p.date === "2026-08-31")?.total).toBe(100000);
  expect(history.data.find((p) => p.date === "2026-09-01")?.total).toBe(600000);
  expect(history.data.find((p) => p.date === "2026-09-15")?.total).toBe(590000);
  expect(history.data.at(-1)?.total).toBe(590000);
});
it("split children and manual rows cannot double-move or invalidate bank reconstruction", () => {
  const rows = [
    ...bankRows,
    transaction({
      id: "split",
      parentId: "shop",
      source: "split",
      amount: -10000,
    }),
    transaction({ id: "manual", source: "manual", amount: -300 }),
  ];
  expect(
    reportingBalanceHistory(
      [accounts[0]],
      [bankStatement],
      rows,
      [],
      [],
      "2026-09",
      "GBP",
      1,
      "2026-10-08",
    ).data.at(-1)?.total,
  ).toBe(590000);
});
it("issue-date-only card produces one October observation, no invented September balance and no cash/net position", () => {
  const october = reportingBalanceHistory(
    [card],
    [cardStatement],
    [cardRow],
    [],
    [],
    "2026-10",
    "GBP",
    1,
    "2026-10-08",
  );
  expect(october.data.filter((p) => p.values[card.id] !== null)).toHaveLength(
    1,
  );
  expect(october.data.at(-1)).toMatchObject({
    date: "2026-10-02",
    values: { [card.id]: -10968 },
    cash: null,
    total: null,
  });
  expect(
    reportingBalanceHistory(
      [card],
      [cardStatement],
      [cardRow],
      [],
      [],
      "2026-09",
      "GBP",
      1,
      "2026-10-08",
    ).data.every((p) => p.values[card.id] === null),
  ).toBe(true);
});
it("missing bank coverage stays null and never joins across an imported gap", () => {
  const later = {
    ...bankStatement,
    id: "later",
    statementPeriodStart: "2026-11-01",
    statementPeriodEnd: "2026-11-30",
    openingBalance: 590000,
    closingBalance: 590000,
    transactionCount: 0,
  };
  const history = reportingBalanceHistory(
    [accounts[0]],
    [bankStatement, later],
    bankRows,
    [],
    [],
    "2026-11",
    "GBP",
    3,
    "2026-12-01",
  );
  expect(history.data.find((p) => p.date === "2026-10-15")?.total).toBeNull();
  expect(history.data.find((p) => p.date === "2026-11-15")?.total).toBe(590000);
});
it("editing a stored statement amount removes the daily trend but retains a single explicitly unverified closing observation", () => {
  const changed = bankRows.map((t) =>
    t.id === "shop" ? { ...t, amount: -20000 } : t,
  );
  const history = reportingBalanceHistory(
    [accounts[0]],
    [bankStatement],
    changed,
    [],
    [],
    "2026-09",
    "GBP",
    1,
    "2026-10-08",
  );
  expect(history.data.filter((p) => p.values.a1 !== null)).toHaveLength(1);
  expect(history.data.at(-1)).toMatchObject({
    complete: false,
    values: { a1: 590000 },
    verified: { a1: false },
  });
});
it("converts each native dated balance with prior cached FX and marks absent rates unknown", () => {
  const euro = { ...accounts[0], currency: "EUR" },
    statement = { ...bankStatement, currency: "EUR" };
  const rows = bankRows.map((t) => ({ ...t, currency: "EUR" }));
  const rates: FxRate[] = [
    {
      id: "rate",
      date: "2026-08-28",
      base: "EUR",
      quote: "GBP",
      rate: "0.85",
      source: "manual",
    },
  ];
  const history = reportingBalanceHistory(
    [euro],
    [statement],
    rows,
    [],
    rates,
    "2026-09",
    "GBP",
    1,
    "2026-10-08",
  );
  expect(history.data.find((p) => p.date === "2026-09-01")?.values.a1).toBe(
    510000,
  );
  expect(
    history.data.find((p) => p.date === "2026-09-01")?.nativeValues.a1,
  ).toBe(600000);
  expect(
    reportingBalanceHistory(
      [euro],
      [statement],
      rows,
      [],
      [],
      "2026-09",
      "GBP",
      1,
      "2026-10-08",
    ).data.every((p) => p.values.a1 === null),
  ).toBe(true);
});
it("manual valuations step and manual wallets move once at their real ledger dates", () => {
  const wallet = { ...accounts[0], tracking: "manual" as const },
    house = {
      ...accounts[1],
      tracking: "manual" as const,
      accountType: "property" as const,
    };
  const valuations = [
    {
      id: "cash",
      accountId: wallet.id,
      date: "2026-09-01",
      valueMinor: 20000,
      note: "Cash opening balance",
    },
    {
      id: "home",
      accountId: house.id,
      date: "2026-09-01",
      valueMinor: 45000000,
    },
    {
      id: "home2",
      accountId: house.id,
      date: "2026-09-15",
      valueMinor: 45100000,
    },
  ];
  const rows = [
    transaction({
      id: "cashshop",
      source: "manual",
      date: "2026-09-03",
      amount: -1200,
    }),
  ];
  const history = reportingBalanceHistory(
    [wallet, house],
    [],
    rows,
    valuations,
    [],
    "2026-09",
    "GBP",
    1,
    "2026-10-08",
  );
  expect(history.data.find((p) => p.date === "2026-09-02")?.total).toBe(
    45020000,
  );
  expect(history.data.find((p) => p.date === "2026-09-03")?.total).toBe(
    45018800,
  );
  expect(history.data.find((p) => p.date === "2026-09-15")?.total).toBe(
    45118800,
  );
});
