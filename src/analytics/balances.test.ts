import { describe, it, expect } from "vitest";
import {
  accountSnapshot,
  balanceOverview,
  balanceHistory,
  balancePercent,
} from "./balances";
import { accounts } from "../tests/helpers";
import type { Statement } from "../domain/models";
const a = accounts[0],
  card = { ...accounts[1], currency: "GBP" };
const statement = (
  accountId: string,
  month: string,
  closingBalance: number,
  patch: Partial<Statement> = {},
): Statement => ({
  id: accountId + month,
  institution: "Barclays",
  accountId,
  currency: "GBP",
  statementPeriodStart: month + "-01",
  statementPeriodEnd: month + "-28",
  closingBalance,
  sourceFilename: "fictitious.pdf",
  sourceFileHash: month,
  importedAt: month + "-29T00:00:00Z",
  parserVersion: "1",
  extractionMethod: "embedded-text",
  validationStatus: "reconciled",
  transactionCount: 0,
  warnings: [],
  ...patch,
});
describe("statement-backed account balances", () => {
  it("nets card liabilities against cash without double counting", () => {
    const s = balanceOverview(
      [a, card],
      [
        statement(a.id, "2026-09", 50000),
        statement(card.id, "2026-09", -10000),
      ],
      "2026-09",
      "GBP",
    );
    expect(s.total).toBe(40000);
    expect(s.complete).toBe(true);
  });
  it("never uses a future statement or falls back past a latest missing balance", () => {
    const docs = [
      statement(a.id, "2026-08", 10000),
      statement(a.id, "2026-09", 20000, { closingBalance: undefined }),
      statement(a.id, "2026-10", 90000),
    ];
    expect(accountSnapshot(a, docs, "2026-09").balance).toBeUndefined();
  });
  it("shows dated stale balances but withholds comparisons and chart points", () => {
    const docs = [statement(a.id, "2026-08", 10000)];
    const s = balanceOverview([a], docs, "2026-09", "GBP");
    expect(s.total).toBe(10000);
    expect(s.complete).toBe(false);
    expect(s.comparisons[0].percent).toBeUndefined();
    expect(balanceHistory([a], docs, "2026-09", "GBP", 1)[0].total).toBeNull();
  });
  it("requires all accounts and both periods for total percentages", () => {
    const docs = [
      statement(a.id, "2026-08", 10000),
      statement(a.id, "2026-09", 12000),
    ];
    expect(
      balanceOverview([a], docs, "2026-09", "GBP").comparisons[0].percent,
    ).toBe(20);
    expect(
      balanceOverview([a, card], docs, "2026-09", "GBP").comparisons[0].percent,
    ).toBeUndefined();
  });
  it("excludes other currencies and unavailable balances", () => {
    const eur = { ...card, currency: "EUR" };
    expect(
      balanceOverview(
        [a, eur],
        [
          statement(a.id, "2026-09", 10000),
          statement(eur.id, "2026-09", 99999, { currency: "EUR" }),
        ],
        "2026-09",
        "GBP",
      ).total,
    ).toBe(10000);
    expect(balanceOverview([a], [], "2026-09", "GBP").total).toBeUndefined();
  });
  it("handles zero and negative baselines and suppresses failed validation", () => {
    expect(balancePercent(100, 0)).toBeUndefined();
    expect(balancePercent(-50, -100)).toBe(50);
    const docs = [
      statement(a.id, "2026-08", 10000),
      statement(a.id, "2026-09", 12000, { validationStatus: "warning" }),
    ];
    expect(
      balanceOverview([a], docs, "2026-09", "GBP").comparisons[0].percent,
    ).toBeUndefined();
  });
  it("calculates 3, 6 and 12 month changes from actual statements", () => {
    const docs = [
      statement(a.id, "2025-09", 10000),
      statement(a.id, "2026-03", 20000),
      statement(a.id, "2026-06", 30000),
      statement(a.id, "2026-08", 40000),
      statement(a.id, "2026-09", 50000),
    ];
    const changes = balanceOverview([a], docs, "2026-09", "GBP").comparisons;
    expect(changes[0].percent).toBe(25);
    expect(changes[1].percent).toBeCloseTo(200 / 3);
    expect(changes[2].percent).toBe(150);
    expect(changes[3].percent).toBe(400);
  });
});
