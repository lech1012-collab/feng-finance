import { describe, expect, it } from "vitest";
import type { Statement, Transaction } from "../domain/models";
import { accounts, transaction } from "../tests/helpers";
import { monthCoverage } from "./coverage";
import { periodCoverageIssues } from "./period-coverage-issues";

const bank = accounts[0];
const wallet = { ...accounts[1], tracking: "manual" as const };
const scope = [bank, wallet];
const period: [string, string] = ["2026-08-25", "2026-09-25"];

function statement(
  start: string,
  end: string,
  patch: Partial<Statement> = {},
): Statement {
  return {
    id: start + end,
    accountId: bank.id,
    institution: bank.institution,
    currency: bank.currency,
    statementPeriodStart: start,
    statementPeriodEnd: end,
    periodSource: "printed",
    openingBalance: 10000,
    closingBalance: 10000,
    transactionCount: 0,
    sourceFilename: "fictional.pdf",
    sourceFileHash: "synthetic",
    importedAt: "2026-10-01T00:00:00Z",
    parserVersion: "test",
    extractionMethod: "embedded-text",
    validationStatus: "reconciled",
    warnings: [],
    ...patch,
  };
}

function issues(
  docs: Statement[],
  today = "2026-10-01",
  rows: Transaction[] = [],
) {
  const coverage = monthCoverage(
    scope,
    docs,
    rows,
    "2026-09",
    "*",
    today,
    period,
  );
  return periodCoverageIssues(coverage, scope, docs, rows, ...period, today);
}

describe("actions for the selected reporting period", () => {
  it("finds exact uncovered days across overlapping and out-of-order documents", () => {
    expect(
      issues([
        statement("2026-09-04", "2026-09-10"),
        statement("2026-09-09", "2026-09-22"),
        statement("2026-08-01", "2026-08-31"),
      ]),
    ).toEqual([
      {
        account: bank,
        gaps: [
          { start: "2026-09-01", end: "2026-09-03" },
          { start: "2026-09-23", end: "2026-09-24" },
        ],
        checks: [],
        unsupportedRowCount: 0,
      },
    ]);
  });

  it("does not ask for trailing days in an unfinished or future cycle", () => {
    const covered = statement("2026-08-25", "2026-09-02");
    expect(issues([covered], "2026-09-10")).toEqual([]);
    expect(issues([], "2026-08-20")).toEqual([]);
    expect(issues([], "2026-09-25")[0].gaps).toEqual([
      { start: "2026-08-25", end: "2026-09-24" },
    ]);
    expect(
      issues([covered, statement("2026-09-05", "2026-09-10")], "2026-09-10")[0]
        .gaps,
    ).toEqual([{ start: "2026-09-03", end: "2026-09-04" }]);
  });

  it("directs unverified, inferred and out-of-period source rows back to their uploaded file", () => {
    const warning = statement("2026-08-24", "2026-09-28", {
      validationStatus: "warning",
    });
    const inferred = statement("2026-09-02", "2026-09-18", {
      periodSource: "transaction-coverage",
    });
    for (const doc of [warning, inferred]) {
      expect(issues([doc])).toEqual([
        { account: bank, gaps: [], checks: [doc], unsupportedRowCount: 0 },
      ]);
    }
    const previous = statement("2026-08-01", "2026-08-20");
    const payment = transaction({
      statementId: previous.id,
      date: "2026-08-26",
    });
    expect(issues([previous], undefined, [payment])).toEqual([
      { account: bank, gaps: [], checks: [previous], unsupportedRowCount: 0 },
    ]);
  });

  it("retains a separate activity action when an observed payment has no source file", () => {
    const complete = statement("2026-08-25", "2026-09-24");
    expect(issues([complete])).toEqual([]);
    expect(
      issues([complete], undefined, [transaction({ statementId: "missing" })]),
    ).toEqual([
      { account: bank, gaps: [], checks: [], unsupportedRowCount: 1 },
    ]);
  });
});
