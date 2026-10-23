import { describe, expect, it } from "vitest";
import type { Setting, TransferProposal } from "../domain/models";
import { defaultCategories } from "../storage/database";
import { categoryHistoryFixture } from "../tests/category-history";
import { transaction } from "../tests/helpers";
import { categoryReport } from "./category-report";

const input = () => ({
  ...categoryHistoryFixture(),
  categories: defaultCategories,
  categoryId: "property",
  month: "2026-10",
  currency: "GBP",
  window: 6,
  today: "2026-11-08",
});

describe("category-specific verified comparisons", () => {
  it("uses complete category accounts despite unrelated missing/card history, retaining global coverage", () => {
    const source = input();
    const before = structuredClone(source);
    const report = categoryReport(source);
    expect(report.scopedAccounts.map((account) => account.id)).toEqual(["a1"]);
    expect(report.stats.baseline).toHaveLength(6);
    expect(report.stats.mean).toBe(130000);
    expect(report.stats.std).toBeCloseTo(37416.5738677394);
    expect(report.stats.current.amount).toBe(200000);
    expect(report.stats.aboveUsual).toBe(true);
    expect(report.coverage.complete).toBe(true);
    expect(report.financialCoverage.complete).toBe(false);
    expect(report.series.map((point) => point.month)).toEqual([
      "2026-04",
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
      "2026-10",
    ]);
    expect(
      report.series.slice(0, -1).every((point) => point.coverage.complete),
    ).toBe(true);
    expect(source).toEqual(before);
  });
  it("supports Salary with a genuine zero standard deviation and excludes the selected month", () => {
    const source = input();
    source.transactions.find(
      (row) => row.id === "bank-2026-10-salary",
    )!.amount = 900000;
    const currentStatement = source.statements.find(
      (s) => s.id === "bank-2026-10",
    )!;
    currentStatement.closingBalance = currentStatement.closingBalance! + 600000;
    const report = categoryReport({ ...source, categoryId: "salary" });
    expect(report.stats.current.amount).toBe(900000);
    expect(report.stats.baseline).toHaveLength(6);
    expect(report.stats.mean).toBe(300000);
    expect(report.stats.std).toBe(0);
  });
  it("does not switch account sets from month to month to create a convenient baseline", () => {
    const source = input();
    source.transactions.find((row) => row.id === "card-purchase")!.categoryId =
      "property";
    const report = categoryReport(source);
    expect(report.scopedAccounts.map((account) => account.id)).toEqual([
      "a1",
      "a3",
    ]);
    expect(report.stats.baseline).toHaveLength(0);
    expect(report.stats.mean).toBeUndefined();
    expect(report.stats.std).toBeUndefined();
    expect(
      report.series
        .find((point) => point.month === "2026-09")!
        .coverage.reasons.join(" "),
    ).toContain("statement dates need verification");
    expect(
      report.series
        .find((point) => point.month === "2026-05")!
        .coverage.reasons.join(" "),
    ).toContain("no statement covers this period");
  });
  it("counts verified zero spending while rejecting a missing source instead of inventing zero", () => {
    const source = input();
    source.transactions.find((row) => row.id === "bank-2026-04-cost")!.amount =
      0;
    source.statements.find((s) => s.id === "bank-2026-04")!.closingBalance =
      400000;
    const report = categoryReport(source);
    expect(report.stats.baseline[0].amount).toBe(0);
    expect(report.series[0].amount).toBe(0);
    const missing = categoryReport({
      ...source,
      statements: source.statements.filter((s) => s.id !== "bank-2026-04"),
    });
    expect(missing.stats.baseline).toHaveLength(5);
    expect(missing.series[0].amount).toBeNull();
    expect(missing.series[0].coverage.reasons.join(" ")).toContain(
      "no statement covers this period",
    );
  });
  it.each([
    "deleted row",
    "changed amount",
    "unverified period",
    "one-day gap",
  ])(
    "explains and excludes a %s without trusting a saved reconciliation flag",
    (problem) => {
      const source = input();
      const document = source.statements.find((s) => s.id === "bank-2026-06")!;
      if (problem === "deleted row")
        source.transactions = source.transactions.filter(
          (row) => row.id !== "bank-2026-06-cost",
        );
      if (problem === "changed amount")
        source.transactions.find(
          (row) => row.id === "bank-2026-06-cost",
        )!.amount -= 1000;
      if (problem === "unverified period")
        document.periodSource = "transaction-coverage";
      if (problem === "one-day gap")
        document.statementPeriodStart = "2026-06-02";
      const report = categoryReport(source);
      expect(report.stats.baseline).toHaveLength(5);
      expect(
        report.series.find((point) => point.month === "2026-06")!.coverage
          .complete,
      ).toBe(false);
      expect(
        report.series.find((point) => point.month === "2026-06")!.coverage
          .reasons.length,
      ).toBeGreaterThan(0);
    },
  );
  it("needs three verified months for sample deviation, but can show a labelled one-month average", () => {
    const report = categoryReport({ ...input(), window: 1 });
    expect(report.stats.mean).toBe(180000);
    expect(report.stats.std).toBeUndefined();
    expect(report.series.map((point) => point.month)).toEqual([
      "2026-09",
      "2026-10",
    ]);
    const three = categoryReport({ ...input(), window: 3 });
    expect(three.stats.mean).toBe(160000);
    expect(three.stats.std).toBe(20000);
  });
  it("retains a category account before FX projection and withholds unavailable converted comparisons", () => {
    const source = input();
    source.accounts[0].currency = "EUR";
    source.statements
      .filter((s) => s.accountId === "a1")
      .forEach((s) => {
        s.currency = "EUR";
      });
    source.transactions
      .filter((row) => row.accountId === "a1")
      .forEach((row) => {
        row.currency = "EUR";
      });
    const report = categoryReport(source);
    expect(report.scopedAccounts.map((account) => account.id)).toEqual(["a1"]);
    expect(report.stats.baseline).toHaveLength(0);
    expect(report.coverage.reasons).toContain(
      "Exchange rates are missing for this period.",
    );
    expect(report.series.every((point) => point.amount === null)).toBe(true);
  });
  it("supports converted EUR history and rejects stale conversion rates without changing native records", () => {
    const source = input();
    source.accounts[0].currency = "EUR";
    source.statements
      .filter((s) => s.accountId === "a1")
      .forEach((s) => {
        s.currency = "EUR";
      });
    source.transactions
      .filter((row) => row.accountId === "a1")
      .forEach((row) => {
        row.currency = "EUR";
      });
    const rates = source.transactions
      .filter((row) => row.accountId === "a1")
      .map((row) => ({
        id: row.id,
        base: "EUR",
        quote: "GBP",
        date: row.date,
        rate: "0.85",
        source: "manual" as const,
      }));
    const before = structuredClone(source);
    const report = categoryReport({ ...source, rates });
    expect(report.stats.baseline).toHaveLength(6);
    expect(report.stats.mean).toBe(110500);
    expect(report.stats.std).toBeCloseTo(31804.0877875785);
    expect(report.approximate).toBe(true);
    expect(source).toEqual(before);
    const stale = categoryReport({
      ...source,
      rates: [{ ...rates[0], date: "2026-03-01" }],
    });
    expect(stale.stats.baseline).toHaveLength(0);
    expect(stale.coverage.reasons).toContain(
      "Exchange rates need updating for this period.",
    );
  });
  it("does not treat manual activity as proof of complete historical coverage", () => {
    const source = input();
    source.accounts[1].tracking = "manual";
    source.transactions.push(
      transaction({
        id: "manual-cost",
        accountId: "a2",
        categoryId: "property",
        date: "2026-09-10",
        amount: -1000,
      }),
    );
    const report = categoryReport(source);
    expect(report.stats.baseline).toHaveLength(0);
    expect(report.coverage.reasons.join(" ")).toContain(
      "manual activity cannot verify a full period",
    );
  });
  it("requires a verified zero with no category history rather than guessing category accounts", () => {
    const source = input();
    const report = categoryReport({ ...source, categoryId: "healthcare" });
    expect(report.inferredScope).toBe(false);
    expect(report.scopedAccounts).toHaveLength(3);
    expect(report.stats.baseline).toHaveLength(0);
    expect(report.series.every((point) => point.amount === null)).toBe(true);
  });
  it("ignores unrelated pending transfers, but never ignores one on a category account", () => {
    const source = input();
    const proposal = {
      id: "pending",
      status: "pending",
      debitTxId: "card-purchase",
      creditTxId: "other-card",
    } as TransferProposal;
    expect(
      categoryReport({ ...source, proposals: [proposal] }).stats.baseline,
    ).toHaveLength(6);
    const relevant = { ...proposal, debitTxId: "bank-2026-09-cost" };
    const report = categoryReport({ ...source, proposals: [relevant] });
    expect(report.stats.baseline).toHaveLength(5);
    expect(
      report.series.find((point) => point.month === "2026-09")!.coverage
        .reasons,
    ).toContain("Transfer matches need review for this period.");
  });
  it("keeps salary-aligned reporting dates based on the full ledger when Salary is on another account", () => {
    const source = input();
    for (const row of source.transactions.filter(
      (row) => row.categoryId === "salary",
    ))
      row.accountId = "a2";
    const settings: Setting[] = [
      {
        key: "period:start",
        value: JSON.stringify({ mode: "payday", day: 25 }),
      },
    ];
    const report = categoryReport({ ...source, settings });
    expect(report.series.at(-1)!.coverage.start).toBe("2026-09-25");
    expect(report.series.at(-1)!.coverage.end).toBe("2026-10-25");
  });
  it("keeps a fully refunded purchase in account scope and excludes legacy transfer kinds from spending", () => {
    const source = input();
    const purchase = source.transactions.find(
      (row) => row.id === "bank-2026-04-cost",
    )!;
    source.transactions.push(
      transaction({
        id: "refund",
        statementId: "refund-proof",
        kind: "refund",
        accountId: "a2",
        amount: 80000,
        refundAllocations: [{ transactionId: purchase.id, amount: 80000 }],
      }),
    );
    source.statements.push({
      ...source.statements.find((document) => document.id === "bank-2026-09")!,
      id: "refund-proof",
      accountId: "a2",
      institution: "Revolut",
      openingBalance: 0,
      closingBalance: 80000,
      transactionCount: 1,
    });
    const report = categoryReport(source);
    expect(report.scopedAccounts.map((account) => account.id)).toEqual(["a1"]);
    expect(report.stats.baseline[0].amount).toBe(0);
    const transfer = categoryReport({
      ...source,
      transactions: [
        ...source.transactions,
        transaction({
          accountId: "a3",
          categoryId: "property",
          kind: "card_repayment",
          amount: -999999,
        }),
      ],
    });
    expect(transfer.stats.mean).toBe(report.stats.mean);
    expect(transfer.scopedAccounts.map((account) => account.id)).toEqual([
      "a1",
    ]);
    const refundAccount = source.accounts.find(
      (account) => account.id === "a2",
    )!;
    refundAccount.currency = "EUR";
    expect(categoryReport(source).series[0].coverage.complete).toBe(false);
    refundAccount.currency = "GBP";
    source.statements.find(
      (document) => document.id === "refund-proof",
    )!.validationStatus = "warning";
    const unverified = categoryReport(source);
    expect(unverified.stats.baseline).toHaveLength(5);
    expect(unverified.series[0].amount).toBeNull();
    expect(unverified.series[0].coverage.reasons.join(" ")).toContain(
      "Linked refund",
    );
    expect(unverified.series[0].coverage.complete).toBe(false);
  });
  it("checks split-parent refund sources in the purchase month without blocking unrelated categories", () => {
    const source = input();
    const parent = source.transactions.find(
      (row) => row.id === "bank-2026-04-cost",
    )!;
    parent.kind = "split_parent";
    source.transactions.push(
      {
        ...parent,
        id: "property-line",
        parentId: parent.id,
        kind: "normal",
        source: "split",
        amount: -60000,
      },
      {
        ...parent,
        id: "shopping-line",
        parentId: parent.id,
        kind: "normal",
        source: "split",
        categoryId: "shopping",
        amount: -20000,
      },
      transaction({
        id: "unverified-refund",
        accountId: "a2",
        statementId: "missing-refund",
        kind: "refund",
        amount: 80000,
        refundAllocations: [{ transactionId: parent.id, amount: 80000 }],
      }),
    );
    const report = categoryReport(source);
    expect(report.stats.baseline).toHaveLength(5);
    expect(report.series[0].coverage.reasons.join(" ")).toContain(
      "Linked refund",
    );
    expect(
      report.series.find((point) => point.month === "2026-05")!.coverage
        .complete,
    ).toBe(true);
    const unrelated = input();
    unrelated.transactions.push(
      transaction({
        id: "unrelated-refund",
        accountId: "a2",
        statementId: "missing-refund",
        kind: "refund",
        amount: 990,
        refundAllocations: [{ transactionId: "card-purchase", amount: 990 }],
      }),
    );
    expect(categoryReport(unrelated).stats.baseline).toHaveLength(6);
  });
});
