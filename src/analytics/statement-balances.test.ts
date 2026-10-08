import { describe, expect, it } from "vitest";
import type { ParsedStatement, Statement, Transaction } from "../domain/models";
import { AmexStatementParser } from "../parsers/amex";
import { BarclaycardStatementParser } from "../parsers/barclaycard";
import { reconstructRows } from "../import/layout";
import { layoutItems } from "../tests/statement-layouts";
import { rows, transaction } from "../tests/helpers";
import { verifiedStatements } from "./coverage";
import {
  reconciledStatementBalances,
  statementBalanceEvidence,
} from "./statement-balances";

const today = "2026-10-08";
function saved(parsed: ParsedStatement) {
  const statement: Statement = {
    id: "synthetic-card-statement",
    accountId: "synthetic-card-account",
    institution: parsed.institution,
    currency: parsed.currency,
    statementPeriodStart: parsed.periodStart,
    statementPeriodEnd: parsed.periodEnd,
    periodSource: parsed.periodSource,
    statementDate: parsed.statementDate,
    openingBalance: parsed.openingBalance,
    closingBalance: parsed.closingBalance,
    validationStatus: "reconciled",
    transactionCount: parsed.transactions.length,
    parserVersion: "synthetic",
    extractionMethod: "embedded-text",
    sourceFilename: "synthetic-card.pdf",
    sourceFileHash: "synthetic-card-hash",
    importedAt: "2026-10-08T12:00:00Z",
    warnings: parsed.warnings,
  };
  const transactions = parsed.transactions.map((row, index) =>
    transaction({
      ...row,
      id: `synthetic-card-row-${index}`,
      statementId: statement.id,
      accountId: statement.accountId,
      isTransfer: row.type === "transfer",
    }),
  );
  return { statement, transactions };
}
function barclaycard() {
  const header = rows([
    [[48, "Your Barclaycard statement"]],
    [[48, "Number 4111 1111 1111 4444"]],
    [
      [48, "Your previous balance:"],
      [240, "£900.00"],
    ],
    [
      [48, "Your new balance:"],
      [240, "£75.00"],
    ],
    [[450, "Page 1 of 2 // issued on 04 October 2026"]],
  ]);
  const table = rows([
    [[48, "Your transactions"]],
    [[48, "Payments towards your account"]],
    [
      [52, "28 Sep"],
      [85, "Direct Debit - Payment"],
      [260, "£900.00"],
    ],
    [[48, "Transactions, interest and charges"]],
    [
      [52, "29 Sep"],
      [85, "FICTIONAL SHOP"],
      [260, "£75.00"],
    ],
  ]).map((row) => ({
    ...row,
    page: 2,
    items: row.items.map((item) => ({ ...item, page: 2 })),
  }));
  return saved(new BarclaycardStatementParser().parse([...header, ...table]));
}
function amex() {
  return saved(
    new AmexStatementParser().parse(reconstructRows(layoutItems("amex"))),
  );
}

describe("credit statement closing-balance evidence", () => {
  it("uses a reconciled Barclaycard closing balance despite an inferred period start", () => {
    const { statement, transactions } = barclaycard();
    expect(statement.periodSource).toBe("transaction-coverage");
    expect(statement.closingBalance).toBe(-7500);
    expect(statement.warnings.join(" ")).toContain("no period start");
    expect(
      statementBalanceEvidence(statement, transactions, today),
    ).toMatchObject({ status: "reconciled", asOfDate: "2026-10-04" });
    expect(
      reconciledStatementBalances([statement], transactions, today),
    ).toEqual([statement]);
    expect(verifiedStatements([statement], transactions, today)).toEqual([]);
  });
  it("uses a reconciled Amex closing balance without changing an older purchase date or claiming complete period coverage", () => {
    const { statement, transactions } = amex();
    expect(statement.closingBalance).toBe(-16000);
    const older = transactions.find(
      (row) => row.date < statement.statementPeriodStart,
    )!;
    expect(older.date).toBe("2026-09-05");
    expect(
      statementBalanceEvidence(statement, transactions, today),
    ).toMatchObject({ status: "reconciled", asOfDate: "2026-10-05" });
    expect(verifiedStatements([statement], transactions, today)).toEqual([]);
    expect(older.date).toBe("2026-09-05");
  });
  it.each([
    [
      "incorrect closing arithmetic",
      (statement: Statement, rows: Transaction[]) => ({
        statement: {
          ...statement,
          closingBalance: statement.closingBalance! + 100,
        },
        rows,
      }),
    ],
    [
      "missing stored row",
      (statement: Statement, rows: Transaction[]) => ({
        statement,
        rows: rows.slice(1),
      }),
    ],
    [
      "incorrect stored count",
      (statement: Statement, rows: Transaction[]) => ({
        statement: { ...statement, transactionCount: rows.length + 1 },
        rows,
      }),
    ],
    [
      "wrong account identity",
      (statement: Statement, rows: Transaction[]) => ({
        statement,
        rows: rows.map((row, index) =>
          index ? row : { ...row, accountId: "another-account" },
        ),
      }),
    ],
    [
      "wrong row currency",
      (statement: Statement, rows: Transaction[]) => ({
        statement,
        rows: rows.map((row, index) =>
          index ? row : { ...row, currency: "EUR" },
        ),
      }),
    ],
    [
      "invalid transaction date",
      (statement: Statement, rows: Transaction[]) => ({
        statement,
        rows: rows.map((row, index) =>
          index ? row : { ...row, date: "2026-09-99" },
        ),
      }),
    ],
    [
      "transaction later than the closing balance",
      (statement: Statement, rows: Transaction[]) => ({
        statement,
        rows: rows.map((row, index) =>
          index ? row : { ...row, date: "2026-10-06" },
        ),
      }),
    ],
    [
      "future closing date",
      (statement: Statement, rows: Transaction[]) => ({
        statement: { ...statement, statementPeriodEnd: "2026-10-10" },
        rows,
      }),
    ],
    [
      "invalid booking date",
      (statement: Statement, rows: Transaction[]) => ({
        statement,
        rows: rows.map((row, index) =>
          index ? row : { ...row, bookingDate: "2026-09-99" },
        ),
      }),
    ],
    [
      "booking date later than the closing balance",
      (statement: Statement, rows: Transaction[]) => ({
        statement,
        rows: rows.map((row, index) =>
          index ? row : { ...row, bookingDate: "2026-10-06" },
        ),
      }),
    ],
    [
      "overridden failed reconciliation",
      (statement: Statement, rows: Transaction[]) => ({
        statement: {
          ...statement,
          validationStatus: "warning" as const,
          validationOverride: true,
        },
        rows,
      }),
    ],
  ])("withholds proof for %s", (_name, change) => {
    const original = amex();
    const next = change(original.statement, original.transactions);
    expect(
      statementBalanceEvidence(next.statement, next.rows, today).status,
    ).not.toBe("reconciled");
    expect(
      reconciledStatementBalances([next.statement], next.rows, today),
    ).toEqual([]);
  });
  it("allows a one-minor-unit reconciliation tolerance but never invents a missing balance", () => {
    const { statement, transactions } = amex();
    expect(
      statementBalanceEvidence(
        { ...statement, closingBalance: statement.closingBalance! + 1 },
        transactions,
        today,
      ).status,
    ).toBe("reconciled");
    expect(
      statementBalanceEvidence(
        { ...statement, closingBalance: undefined },
        transactions,
        today,
      ).status,
    ).toBe("unavailable");
    expect(
      statementBalanceEvidence(
        { ...statement, openingBalance: undefined },
        transactions,
        today,
      ).status,
    ).not.toBe("reconciled");
  });
});
