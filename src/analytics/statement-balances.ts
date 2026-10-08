import type { Statement, Transaction } from "../domain/models";
import { parseDate } from "../domain/dates";
import { safeSum } from "../domain/money";

/** An issue-date-only card still has a dated closing balance. Its inferred
 * transaction coverage must never be mistaken for a printed billing period. */
export function statementBalanceDate(statement: Statement) {
  return statement.periodSource === "transaction-coverage"
    ? (statement.statementDate ?? statement.statementPeriodEnd)
    : statement.statementPeriodEnd;
}

const validDate = (value: string) => {
  try {
    return parseDate(value) === value;
  } catch {
    return false;
  }
};

export interface StatementBalanceEvidence {
  status: "reconciled" | "unverified" | "unavailable";
  asOfDate: string;
  reason?: string;
}

/** Verify a BALANCE independently from calendar coverage. Older card purchase
 * dates and an unknown period start do not invalidate the printed closing sum.
 * They still prevent verified monthly coverage and daily reconstruction. */
export function statementBalanceEvidence(
  statement: Statement,
  transactions: Transaction[],
  today = new Date().toISOString().slice(0, 10),
): StatementBalanceEvidence {
  const asOfDate = statementBalanceDate(statement);
  const result = (reason: string): StatementBalanceEvidence => ({
    status: "unverified",
    asOfDate,
    reason,
  });
  if (!Number.isSafeInteger(statement.closingBalance))
    return {
      status: "unavailable",
      asOfDate,
      reason: "No readable closing balance was imported.",
    };
  if (!validDate(asOfDate) || asOfDate > today)
    return result("The closing balance date needs review.");
  if (
    statement.validationStatus !== "reconciled" ||
    statement.validationOverride
  )
    return result("The statement has not reconciled.");
  if (!Number.isSafeInteger(statement.openingBalance))
    return result("No opening balance is available to check the closing sum.");
  const rows = transactions.filter((row) => row.statementId === statement.id);
  if (
    rows.length !== statement.transactionCount ||
    new Set(rows.map((row) => row.id)).size !== rows.length
  )
    return result("Stored transactions do not match the statement row count.");
  if (
    rows.some(
      (row) =>
        row.accountId !== statement.accountId ||
        row.currency !== statement.currency ||
        !validDate(row.date) ||
        row.date > asOfDate ||
        (row.bookingDate !== undefined &&
          (!validDate(row.bookingDate) || row.bookingDate > asOfDate)),
    )
  )
    return result(
      "A stored transaction account, currency or date needs review.",
    );
  try {
    if (
      Math.abs(
        safeSum([statement.openingBalance!, ...rows.map((row) => row.amount)]) -
          statement.closingBalance!,
      ) > 1
    )
      return result(
        "Stored amounts do not reconcile with the closing balance.",
      );
  } catch {
    return result("A stored amount exceeds safe financial precision.");
  }
  return { status: "reconciled", asOfDate };
}

export function reconciledStatementBalances(
  statements: Statement[],
  transactions: Transaction[],
  today = new Date().toISOString().slice(0, 10),
) {
  const grouped = new Map<string, Transaction[]>();
  for (const row of transactions) {
    const rows = grouped.get(row.statementId) ?? [];
    rows.push(row);
    grouped.set(row.statementId, rows);
  }
  return statements.filter(
    (statement) =>
      statementBalanceEvidence(
        statement,
        grouped.get(statement.id) ?? [],
        today,
      ).status === "reconciled",
  );
}
