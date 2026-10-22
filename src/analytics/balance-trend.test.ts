import { describe, expect, it } from "vitest";
import {
  availableBalanceRanges,
  balanceTrendPoints,
  balanceTrendScopes,
  balanceTrendStart,
  balanceTrendSummary,
  defaultBalanceTrendScope,
  recommendedBalancePeriod,
  trendWindow,
} from "./balance-trend";
import { reportingBalanceHistory } from "./reporting-balance-history";
import { accounts, transaction } from "../tests/helpers";
import type { Statement } from "../domain/models";

const bank: Statement = {
  id: "s1",
  accountId: "a1",
  institution: "Barclays",
  currency: "GBP",
  statementPeriodStart: "2026-09-01",
  statementPeriodEnd: "2026-09-30",
  openingBalance: 100000,
  closingBalance: 90000,
  importedAt: "2026-10-01",
  sourceFilename: "synthetic.pdf",
  sourceFileHash: "fake",
  parserVersion: "2",
  extractionMethod: "embedded-text",
  validationStatus: "reconciled",
  transactionCount: 1,
  warnings: [],
};
const rows = [transaction({ amount: -10000, date: "2026-09-15" })];
const card = {
  ...bank,
  id: "card",
  accountId: "a3",
  institution: "American Express" as const,
  periodSource: "transaction-coverage" as const,
  statementDate: "2026-10-02",
  openingBalance: 0,
  closingBalance: -20000,
};
const cardRow = transaction({
  id: "card-row",
  accountId: "a3",
  statementId: "card",
  date: "2026-09-15",
  amount: -20000,
});
const history = (sourceRows = [...rows, cardRow]) =>
  reportingBalanceHistory(
    [accounts[0], accounts[2]],
    [bank, card],
    sourceRows,
    [],
    [],
    "2026-10",
    "GBP",
    12,
    "2026-10-08",
  );

describe("balance trend presentation", () => {
  it("defaults to useful cash history without requiring the card's missing daily balance", () => {
    const h = history(),
      scopes = balanceTrendScopes(h.accounts);
    const scope = defaultBalanceTrendScope(h, scopes)!;
    expect(scope.id).toBe("cash");
    const points = balanceTrendPoints(h, scope);
    expect(points.find((p) => p.date === "2026-09-15")).toMatchObject({
      value: 90000,
      verified: true,
      daily: true,
    });
    expect(h.data.find((p) => p.date === "2026-09-15")?.total).toBeNull();
    expect(
      balanceTrendPoints(
        h,
        scopes.find((s) => s.id === "net")!,
      ).every((p) => p.value === null),
    ).toBe(true);
  });
  it("does not include an unverified cash balance in an aggregate", () => {
    const h = history([{ ...rows[0], amount: -20000 }, cardRow]);
    const scopes = balanceTrendScopes(h.accounts);
    expect(
      balanceTrendPoints(
        h,
        scopes.find((s) => s.id === "cash")!,
      ).every((p) => p.value === null),
    ).toBe(true);
    expect(
      balanceTrendSummary(
        balanceTrendPoints(
          h,
          scopes.find((s) => s.id === "account:a1")!,
        ),
      ).latest,
    ).toMatchObject({ value: 90000, verified: false, daily: false });
  });
  it("plots debt as positive but retains a genuine credit as negative, without changing the ledger", () => {
    const h = history(),
      scope = balanceTrendScopes(h.accounts).find(
        (s) => s.id === "account:a3",
      )!;
    expect(
      balanceTrendSummary(balanceTrendPoints(h, scope)).latest?.value,
    ).toBe(20000);
    expect(h.data.at(-1)?.values.a3).toBe(-20000);
    const credit = reportingBalanceHistory(
      [accounts[2]],
      [{ ...card, closingBalance: 5000 }],
      [{ ...cardRow, amount: 5000 }],
      [],
      [],
      "2026-10",
      "GBP",
      1,
      "2026-10-08",
    );
    expect(
      balanceTrendSummary(balanceTrendPoints(credit, scope)).latest?.value,
    ).toBe(-5000);
  });
  it("selects a card account automatically when only card observations exist", () => {
    const h = history();
    const onlyCard = { ...h, accounts: [accounts[2]] };
    expect(
      defaultBalanceTrendScope(onlyCard, balanceTrendScopes(onlyCard.accounts))
        ?.id,
    ).toBe("account:a3");
  });
  it("never joins missing or unverified days, while comparing exact verified endpoints", () => {
    const points = [
      { date: "2026-09-01", value: 10000, verified: true, daily: true },
      { date: "2026-09-02", value: 11000, verified: true, daily: true },
      { date: "2026-09-03", value: null, verified: false, daily: false },
      { date: "2026-09-04", value: 50000, verified: false, daily: false },
      { date: "2026-09-05", value: 12000, verified: true, daily: true },
    ];
    const s = balanceTrendSummary(points);
    expect(s.segments.map((segment) => segment.map((p) => p.date))).toEqual([
      ["2026-09-01", "2026-09-02"],
      ["2026-09-05"],
    ]);
    expect(s.change).toEqual({
      amount: 2000,
      percent: 20,
      start: "2026-09-01",
      end: "2026-09-05",
    });
    expect(s.gaps).toEqual([{ start: "2026-09-03", end: "2026-09-04" }]);
    expect(balanceTrendSummary(points.slice(0, 4)).change).toBeUndefined();
  });
  it("does not invent a percentage from a zero or negative baseline or a change from one observation", () => {
    for (const initial of [0, -10000]) {
      expect(
        balanceTrendSummary([
          { date: "2026-09-01", value: initial, verified: true, daily: true },
          { date: "2026-09-30", value: 5000, verified: true, daily: true },
        ]).change?.percent,
      ).toBeUndefined();
    }
    expect(
      balanceTrendSummary([
        { date: "2026-09-01", value: 0, verified: true, daily: true },
      ]).change,
    ).toBeUndefined();
  });
  it("preserves daily provenance beside a closing-only statement and never joins adjacent snapshots", () => {
    const closing = {
      ...bank,
      id: "closing",
      periodSource: "transaction-coverage" as const,
      statementDate: "2026-10-02",
      statementPeriodStart: "2026-10-01",
      statementPeriodEnd: "2026-10-02",
      openingBalance: 90000,
      closingBalance: 91000,
    };
    const h = reportingBalanceHistory(
      [accounts[0]],
      [bank, closing],
      [
        ...rows,
        transaction({
          id: "closing-row",
          statementId: "closing",
          date: "2026-10-01",
          amount: 1000,
        }),
      ],
      [],
      [],
      "2026-10",
      "GBP",
      3,
      "2026-10-08",
    );
    const points = balanceTrendPoints(h, balanceTrendScopes(h.accounts)[0]);
    expect(points.find((p) => p.date === "2026-09-30")).toMatchObject({
      daily: true,
      value: 90000,
    });
    expect(points.find((p) => p.date === "2026-10-02")).toMatchObject({
      daily: false,
      value: 91000,
    });
    expect(balanceTrendSummary(points).segments.some((s) => s.length > 1)).toBe(
      true,
    );
    const adjacent = [
      { date: "2026-10-01", value: 1000, verified: true, daily: false },
      { date: "2026-10-02", value: 2000, verified: true, daily: false },
    ];
    expect(balanceTrendSummary(adjacent).segments.map((s) => s.length)).toEqual(
      [1, 1],
    );
  });
  it("uses real calendar-month boundaries and recommends the smallest useful range", () => {
    expect(balanceTrendStart("2026-03-31", 1)).toBe("2026-02-28");
    expect(balanceTrendStart("2024-03-31", 1)).toBe("2024-02-29");
    const points = [
      { date: "2026-07-31", value: 20000, verified: true, daily: true },
      { date: "2026-09-30", value: 10000, verified: true, daily: true },
    ];
    expect(recommendedBalancePeriod(points, "2026-09-30")).toBe(3);
    expect(availableBalanceRanges(points, "2026-09-30", 3)).toEqual([1, 3]);
    expect(availableBalanceRanges(points, "2026-09-30", 12)).toEqual([
      1, 3, 12,
    ]);
    expect(trendWindow(points, "2026-09-30", 1)).toHaveLength(1);
  });
  it("withholds cash where FX is missing or stale, but keeps an account's reported converted observation explicit", () => {
    const euro = { ...accounts[0], currency: "EUR" },
      euroRows = rows.map((t) => ({ ...t, currency: "EUR" }));
    const rate = {
      id: "rate",
      date: "2026-08-28",
      base: "EUR",
      quote: "GBP",
      rate: "0.85",
      source: "manual" as const,
    };
    for (const rates of [[], [rate]]) {
      const h = reportingBalanceHistory(
        [euro],
        [{ ...bank, currency: "EUR" }],
        euroRows,
        [],
        rates,
        "2026-09",
        "GBP",
        1,
        "2026-10-08",
      );
      const scopes = balanceTrendScopes(h.accounts);
      expect(
        balanceTrendSummary(balanceTrendPoints(h, scopes[0])).latest?.date,
      ).not.toBe("2026-09-30");
      expect(
        balanceTrendSummary(balanceTrendPoints(h, scopes[1])).change,
      ).toBeUndefined();
    }
  });
});
