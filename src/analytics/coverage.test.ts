import { describe, expect, it } from "vitest";
import { cashFlow, statementIsCurrent } from "./calculations";
import {
  coverageMonthlySeries,
  monthCoverage,
  verifiedStatements,
} from "./coverage";
import type { Statement } from "../domain/models";
import { accounts, transaction } from "../tests/helpers";
it("flags early-month snapshots and accepts month-end or later coverage", () => {
  expect(statementIsCurrent("2026-09-05", "2026-09", "2026-10-03")).toBe(false);
  expect(statementIsCurrent("2026-09-30", "2026-09", "2026-10-03")).toBe(true);
  expect(statementIsCurrent("2026-10-02", "2026-09", "2026-10-03")).toBe(true);
  expect(statementIsCurrent("2026-10-03", "2026-10", "2026-10-03")).toBe(true);
  expect(statementIsCurrent(undefined, "2026-09", "2026-10-03")).toBe(false);
});

const cash = accounts[0];
const card = accounts[2];
const statement = (patch: Partial<Statement> = {}): Statement => ({
  id: "coverage-cash",
  accountId: cash.id,
  institution: cash.institution,
  currency: "GBP",
  statementPeriodStart: "2026-09-01",
  statementPeriodEnd: "2026-09-30",
  periodSource: "printed",
  openingBalance: 10000,
  closingBalance: 10000,
  transactionCount: 0,
  sourceFilename: "synthetic.pdf",
  sourceFileHash: "synthetic",
  importedAt: "2026-10-01T00:00:00Z",
  parserVersion: "test",
  extractionMethod: "embedded-text",
  validationStatus: "reconciled",
  warnings: [],
  ...patch,
});
const today = "2026-10-07";

describe("financial display coverage", () => {
  it("keeps missing months null and a fully verified zero-income month zero", () => {
    const series = coverageMonthlySeries(
      [],
      [cash],
      [statement()],
      "2026-09",
      2,
      "GBP",
      today,
    );
    expect(series[0]).toMatchObject({
      month: "2026-08",
      income: null,
      expenses: null,
      net: null,
      coverage: { status: "No data" },
    });
    expect(series[1]).toMatchObject({
      income: 0,
      expenses: 0,
      net: 0,
      coverage: {
        status: "Complete",
        complete: true,
        covered: 1,
        total: 1,
        hasIncomeSource: true,
      },
    });
  });

  it("shows card-only spending without claiming zero income or a complete net cash flow", () => {
    const document = statement({
      id: "card",
      accountId: card.id,
      institution: card.institution,
      statementPeriodEnd: "2026-09-05",
      openingBalance: 0,
      closingBalance: -135790,
      transactionCount: 1,
    });
    const rows = [
      transaction({
        accountId: card.id,
        statementId: document.id,
        date: "2026-09-05",
        amount: -135790,
      }),
    ];
    const coverage = monthCoverage(
      [cash, card],
      [document],
      rows,
      "2026-09",
      "GBP",
      today,
    );
    expect(coverage).toMatchObject({
      status: "Partial",
      complete: false,
      covered: 1,
      total: 2,
      hasIncomeSource: false,
      missingAccountIds: [cash.id],
    });
    expect(
      coverageMonthlySeries(
        rows,
        [cash, card],
        [document],
        "2026-09",
        1,
        "GBP",
        today,
      )[0],
    ).toMatchObject({ income: null, expenses: 135790, net: null });
  });

  it("does not trust an old reconciled flag after a row is deleted or corrupted", () => {
    const document = statement({ closingBalance: 9000, transactionCount: 1 });
    const row = transaction({ statementId: document.id, amount: -1000 });
    expect(
      monthCoverage([cash], [document], [row], "2026-09", "GBP", today)
        .complete,
    ).toBe(true);
    for (const rows of [
      [],
      [{ ...row, amount: 1000 }],
      [{ ...row, currency: "EUR" }],
      [{ ...row, date: "2026-08-31" }],
      [{ ...row, accountId: card.id }],
    ]) {
      expect(
        monthCoverage([cash], [document], rows, "2026-09", "GBP", today),
      ).toMatchObject({
        status: "Unverified",
        complete: false,
        covered: 0,
        hasIncomeSource: false,
      });
      expect(
        coverageMonthlySeries(
          rows,
          [cash],
          [document],
          "2026-09",
          1,
          "GBP",
          today,
        )[0].expenses,
      ).toBeNull();
    }
  });

  it("excludes failed, unavailable, inferred and future statement evidence", () => {
    for (const patch of [
      { validationStatus: "warning" as const },
      { validationStatus: "cannot-reconcile" as const },
      { validationStatus: "unavailable" as const },
      { periodSource: "transaction-coverage" as const },
      { statementPeriodEnd: "2026-10-10" },
      { openingBalance: undefined },
    ]) {
      const document = statement(patch);
      expect(verifiedStatements([document], [], today)).toEqual([]);
      expect(
        monthCoverage([cash], [document], [], "2026-09", "GBP", today).complete,
      ).toBe(false);
    }
  });

  it("merges adjacent verified statements without concealing a one-day gap", () => {
    const first = statement({ id: "first", statementPeriodEnd: "2026-09-15" });
    const second = statement({
      id: "second",
      statementPeriodStart: "2026-09-16",
    });
    expect(
      monthCoverage([cash], [first, second], [], "2026-09", "GBP", today)
        .status,
    ).toBe("Complete");
    expect(
      monthCoverage(
        [cash],
        [first, { ...second, statementPeriodStart: "2026-09-17" }],
        [],
        "2026-09",
        "GBP",
        today,
      ).status,
    ).toBe("Partial");
  });

  it("keeps partial chart amounts aligned with imported totals without mixing currencies", () => {
    const other = { ...accounts[1], id: "eur-account", currency: "EUR" };
    const good = statement({ closingBalance: 9000, transactionCount: 1 });
    const bad = statement({
      id: "bad",
      accountId: accounts[1].id,
      validationStatus: "warning",
      closingBalance: 1,
      transactionCount: 1,
    });
    const rows = [
      transaction({ statementId: good.id, amount: -1000 }),
      transaction({
        id: "bad-row",
        statementId: bad.id,
        accountId: accounts[1].id,
        amount: -9999,
      }),
    ];
    const point = coverageMonthlySeries(
      rows,
      [cash, accounts[1], other],
      [good, bad],
      "2026-09",
      1,
      "GBP",
      today,
    )[0];
    expect(point.expenses).toBe(10999);
    expect(point.coverage).toMatchObject({
      status: "Partial",
      covered: 1,
      total: 2,
      hasUnverifiedStatements: true,
    });
  });

  it("withholds complete-month comparisons when an overlapping source is unverified", () => {
    const good = statement({ closingBalance: 9000, transactionCount: 1 });
    const warning = statement({
      id: "warning-overlap",
      statementPeriodStart: "2026-09-03",
      statementPeriodEnd: "2026-09-03",
      openingBalance: 2000,
      closingBalance: 1001,
      transactionCount: 1,
      validationStatus: "warning",
    });
    const rows = [
      transaction({ statementId: good.id, amount: -1000 }),
      transaction({
        id: "warning-row",
        statementId: warning.id,
        date: "2026-09-03",
        amount: -999,
      }),
    ];
    const coverage = monthCoverage(
      [cash],
      [good, warning],
      rows,
      "2026-09",
      "GBP",
      today,
    );
    expect(coverage).toMatchObject({
      status: "Partial",
      complete: false,
      covered: 1,
      total: 1,
      hasUnverifiedStatements: true,
      incompleteAccountIds: [cash.id],
    });
    const point = coverageMonthlySeries(
      rows,
      [cash],
      [good, warning],
      "2026-09",
      1,
      "GBP",
      today,
    )[0];
    expect(point).toMatchObject(cashFlow(rows, "GBP"));
    expect(point.coverage.complete).toBe(false);
  });

  it("treats a monthly row without a verifiable source as incomplete instead of hiding it", () => {
    const document = statement();
    const row = transaction({ statementId: "missing-source", amount: -550 });
    const coverage = monthCoverage(
      [cash],
      [document],
      [row],
      "2026-09",
      "GBP",
      today,
    );
    expect(coverage).toMatchObject({
      status: "Partial",
      complete: false,
      hasUnverifiedStatements: true,
    });
    expect(
      coverageMonthlySeries(
        [row],
        [cash],
        [document],
        "2026-09",
        1,
        "GBP",
        today,
      )[0].expenses,
    ).toBe(550);
  });

  it("verifies a cross-month card statement using every source row", () => {
    const document = statement({
      id: "card",
      accountId: card.id,
      statementPeriodStart: "2026-08-06",
      statementPeriodEnd: "2026-09-05",
      openingBalance: 0,
      closingBalance: -3000,
      transactionCount: 2,
    });
    const rows = [
      transaction({
        id: "aug",
        statementId: document.id,
        accountId: card.id,
        date: "2026-08-10",
        amount: -1000,
      }),
      transaction({
        id: "sep",
        statementId: document.id,
        accountId: card.id,
        date: "2026-09-03",
        amount: -2000,
      }),
    ];
    expect(
      monthCoverage([card], [document], rows, "2026-09", "GBP", today),
    ).toMatchObject({ status: "Partial", covered: 1 });
    expect(
      coverageMonthlySeries(
        rows,
        [card],
        [document],
        "2026-09",
        1,
        "GBP",
        today,
      )[0].expenses,
    ).toBe(2000);
    expect(
      monthCoverage([card], [document], rows.slice(1), "2026-09", "GBP", today)
        .status,
    ).toBe("Unverified");
  });

  it("accepts the one-minor-unit reconciliation tolerance", () => {
    expect(
      monthCoverage(
        [cash],
        [statement({ closingBalance: 10001 })],
        [],
        "2026-09",
        "GBP",
        today,
      ).complete,
    ).toBe(true);
    expect(
      monthCoverage(
        [cash],
        [statement({ closingBalance: 10002 })],
        [],
        "2026-09",
        "GBP",
        today,
      ).complete,
    ).toBe(false);
  });
});
