import type { Account, Statement, Transaction } from "../domain/models";
import { shiftDate } from "./analysis-period";
import type { MonthCoverage } from "./coverage";
import { ledgerTransactions } from "./effective-transactions";

type Gap = { start: string; end: string };
export interface AccountCoverageIssue {
  account: Account;
  gaps: Gap[];
  checks: Statement[];
  unsupportedRowCount: number;
}

// Report absence of a document, not a missing transaction or an assumed billing cycle.
function statementGaps(
  documents: Statement[],
  start: string,
  end: string,
  today: string,
): Gap[] {
  if (
    documents.some(
      (s) =>
        s.periodSource === "transaction-coverage" ||
        s.statementPeriodEnd < s.statementPeriodStart,
    )
  )
    return []; // Check the dates before recommending another file.
  const gaps: Gap[] = [];
  let cursor = start;
  for (const s of documents) {
    if (s.statementPeriodStart > today) continue;
    if (s.statementPeriodStart > cursor)
      gaps.push({ start: cursor, end: shiftDate(s.statementPeriodStart, -1) });
    if (s.statementPeriodEnd >= cursor)
      cursor = shiftDate(s.statementPeriodEnd, 1);
  }
  // While a period is open, a trailing gap may be on the next normal statement.
  if (end <= today && cursor < end)
    gaps.push({ start: cursor, end: shiftDate(end, -1) });
  return gaps;
}

export function periodCoverageIssues(
  coverage: MonthCoverage,
  accounts: Account[],
  statements: Statement[],
  transactions: Transaction[],
  start: string,
  end: string,
  today: string,
): AccountCoverageIssue[] {
  const incomplete = new Set(coverage.incompleteAccountIds);
  if (!incomplete.size) return [];
  const verified = new Set(coverage.verifiedStatements.map((s) => s.id));
  const inPeriod = ledgerTransactions(transactions).filter(
    (t) => incomplete.has(t.accountId) && t.date >= start && t.date < end,
  );
  const issues: AccountCoverageIssue[] = [];
  for (const account of accounts.filter((a) => incomplete.has(a.id))) {
    const accountRows = inPeriod.filter((row) => row.accountId === account.id);
    const sourceIds = new Set(accountRows.map((row) => row.statementId));
    const sources = statements.filter((s) => s.accountId === account.id);
    const knownIds = new Set(sources.map((s) => s.id));
    const documents = sources
      .filter(
        (s) => s.statementPeriodStart < end && s.statementPeriodEnd >= start,
      )
      .sort((a, b) =>
        a.statementPeriodStart.localeCompare(b.statementPeriodStart),
      );
    const documentIds = new Set(documents.map((s) => s.id));
    const checks = sources.filter(
      (s) =>
        !verified.has(s.id) && (documentIds.has(s.id) || sourceIds.has(s.id)),
    );
    const unsupportedRowCount = accountRows.filter(
      (row) => !knownIds.has(row.statementId),
    ).length;
    // A source can contain payments outside its recorded billing dates.
    // Resolve that discrepancy before suggesting a second statement.
    const gaps = checks.some((s) => !documentIds.has(s.id))
      ? []
      : statementGaps(documents, start, end, today);
    if (gaps.length || checks.length || unsupportedRowCount)
      issues.push({ account, gaps, checks, unsupportedRowCount });
  }
  return issues;
}
