import type { Account, Statement, Transaction } from "../domain/models";
import { monthBounds } from "../domain/dates";
import { safeSum } from "../domain/money";
import { completeMonth } from "./category";
import { monthlySeries } from "./calculations";

export type CoverageStatus = "Complete" | "Partial" | "Unverified" | "No data";
export interface MonthCoverage {
  status: CoverageStatus;
  complete: boolean;
  covered: number;
  total: number;
  hasIncomeSource: boolean;
  hasData: boolean;
  hasUnverifiedStatements: boolean;
  verifiedStatements: Statement[];
  missingAccountIds: string[];
  incompleteAccountIds: string[];
}

/** A saved reconciliation flag is insufficient: verify the rows that still
 * exist before using a statement as evidence of complete financial history. */
export function verifiedStatements(
  statements: Statement[],
  transactions: Transaction[],
  today = new Date().toISOString().slice(0, 10),
) {
  const grouped = new Map<string, Transaction[]>();
  for (const transaction of transactions) {
    const rows = grouped.get(transaction.statementId) ?? [];
    rows.push(transaction);
    grouped.set(transaction.statementId, rows);
  }
  return statements.filter((statement) => {
    const rows = grouped.get(statement.id) ?? [];
    return (
      statement.validationStatus === "reconciled" &&
      statement.periodSource !== "transaction-coverage" &&
      statement.statementPeriodStart <= statement.statementPeriodEnd &&
      statement.statementPeriodEnd <= today &&
      statement.openingBalance !== undefined &&
      statement.closingBalance !== undefined &&
      rows.length === statement.transactionCount &&
      rows.every(
        (transaction) =>
          transaction.accountId === statement.accountId &&
          transaction.currency === statement.currency &&
          transaction.date >= statement.statementPeriodStart &&
          transaction.date <= statement.statementPeriodEnd,
      ) &&
      Math.abs(
        safeSum([statement.openingBalance, ...rows.map((row) => row.amount)]) -
          statement.closingBalance,
      ) <= 1
    );
  });
}

export function monthCoverage(
  accounts: Account[],
  statements: Statement[],
  transactions: Transaction[],
  month: string,
  currency: string,
  today = new Date().toISOString().slice(0, 10),
): MonthCoverage {
  const scoped = accounts.filter((account) => account.currency === currency);
  const accountIds = new Set(scoped.map((account) => account.id));
  const [start, end] = monthBounds(month);
  const intersects = (statement: Statement) =>
    accountIds.has(statement.accountId) &&
    statement.currency === currency &&
    statement.statementPeriodStart < end &&
    statement.statementPeriodEnd >= start;
  const documents = statements.filter(intersects);
  const verified = verifiedStatements(documents, transactions, today);
  const verifiedIds = new Set(verified.map((statement) => statement.id));
  const unverifiedAccountIds = new Set(
    documents
      .filter((statement) => !verifiedIds.has(statement.id))
      .map((statement) => statement.accountId),
  );
  for (const transaction of transactions)
    if (
      accountIds.has(transaction.accountId) &&
      transaction.currency === currency &&
      transaction.date >= start &&
      transaction.date < end &&
      !verifiedIds.has(transaction.statementId)
    )
      unverifiedAccountIds.add(transaction.accountId);
  const hasUnverifiedStatements = unverifiedAccountIds.size > 0;
  const usable = new Set(verified.map((statement) => statement.accountId));
  const incompleteAccountIds = scoped
    .filter(
      (account) =>
        unverifiedAccountIds.has(account.id) ||
        !completeMonth(month, [account], verified, today),
    )
    .map((account) => account.id);
  const complete = scoped.length > 0 && incompleteAccountIds.length === 0;
  const hasData =
    documents.length > 0 ||
    transactions.some(
      (transaction) =>
        accountIds.has(transaction.accountId) &&
        transaction.currency === currency &&
        transaction.date >= start &&
        transaction.date < end,
    );
  return {
    status: complete
      ? "Complete"
      : verified.length
        ? "Partial"
        : hasData
          ? "Unverified"
          : "No data",
    complete,
    covered: usable.size,
    total: scoped.length,
    hasIncomeSource: scoped.some(
      (account) => account.accountType !== "credit" && usable.has(account.id),
    ),
    hasData,
    hasUnverifiedStatements,
    verifiedStatements: verified,
    missingAccountIds: scoped
      .filter((account) => !usable.has(account.id))
      .map((account) => account.id),
    incompleteAccountIds,
  };
}

/** Display-only series: zero is a recorded value, never a missing-data marker.
 * Signed cash-flow calculations remain unchanged and partial observations are
 * explicitly tagged so charts cannot imply a verified historical comparison. */
export function coverageMonthlySeries(
  transactions: Transaction[],
  accounts: Account[],
  statements: Statement[],
  end: string,
  count: number,
  currency: string,
  today = new Date().toISOString().slice(0, 10),
) {
  // Partial months use the same observed rows as the headline metrics. Their
  // incomplete/unverified coverage is explicit; silently plotting only the
  // verified subset would make chart spending disagree with the dashboard.
  return monthlySeries(transactions, end, count, currency).map((point) => {
    const coverage = monthCoverage(
      accounts,
      statements,
      transactions,
      point.month,
      currency,
      today,
    );
    const usable =
      coverage.status === "Complete" || coverage.status === "Partial";
    return {
      ...point,
      income: usable && coverage.hasIncomeSource ? point.income : null,
      expenses: usable ? point.expenses : null,
      net: usable && coverage.hasIncomeSource ? point.net : null,
      property: usable ? point.property : null,
      coverage,
    };
  });
}
