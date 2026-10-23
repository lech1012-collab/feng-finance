import type {
  Account,
  Category,
  FxRate,
  Setting,
  Statement,
  Transaction,
  TransferProposal,
} from "../domain/models";
import { reportingPeriod } from "../domain/period";
import { financialType } from "../domain/transaction-type";
import { categoryMatches, categoryOverview } from "./category";
import { effectiveTransactions } from "./effective-transactions";
import { projectedReportingTransactions } from "./fx";
import { reportingCoverage } from "./reporting";

interface CategoryReportInput {
  accounts: Account[];
  statements: Statement[];
  transactions: Transaction[];
  categories: Category[];
  categoryId: string;
  month: string;
  currency: string;
  window: number;
  today: string;
  settings?: Setting[];
  rates?: FxRate[];
  proposals?: TransferProposal[];
}

/** Use one stable set of known category accounts for every comparison month.
 * Select it from native history BEFORE currency projection or date filtering:
 * a missing rate or a fully refunded purchase must not make an account
 * disappear. Unrelated accounts still govern whole-finance totals.
 * With no category history, all statement accounts must support any true zero.
 */
export function categoryReport({
  accounts,
  statements,
  transactions,
  categories,
  categoryId,
  month,
  currency,
  window,
  today,
  settings = [],
  rates = [],
  proposals = [],
}: CategoryReportInput) {
  const effective = effectiveTransactions(transactions);
  const categoryRows = effective.filter(
    (row) =>
      categoryMatches(row, categoryId) && financialType(row) !== "transfer",
  );
  const knownIds = new Set(categoryRows.map((row) => row.accountId));
  const scopedAccounts = knownIds.size
    ? accounts.filter((account) => knownIds.has(account.id))
    : accounts.filter((account) => account.tracking !== "manual");
  const presentIds = new Set(scopedAccounts.map((account) => account.id));
  const unknownAccounts = [...knownIds].some((id) => !presentIds.has(id));
  const scopeIds = new Set([...presentIds, ...knownIds]);
  const manualAccounts = scopedAccounts.filter(
    (account) => account.tracking === "manual",
  );
  const scopedStatements = statements.filter((s) => scopeIds.has(s.accountId));
  const scopedRows = transactions.filter((row) => scopeIds.has(row.accountId));
  const scopedRowIds = new Set(scopedRows.map((row) => row.id));
  const scopedProposals = proposals.filter(
    (proposal) =>
      scopedRowIds.has(proposal.debitTxId) ||
      scopedRowIds.has(proposal.creditTxId),
  );
  // Apply refunds and splits using the complete ledger, including cross-account
  // allocations, then restrict the prepared display projection to this scope.
  const projection = projectedReportingTransactions(effective, currency, rates);
  const scopedProjection = {
    ...projection,
    transactions: projection.transactions.filter((row) =>
      scopeIds.has(row.accountId),
    ),
    missing: projection.missing.filter((row) => scopeIds.has(row.accountId)),
  };
  const incomeCategory =
    categories.find((c) => c.id === categoryId)?.kind === "income";
  const coverageByMonth = new Map<
    string,
    ReturnType<typeof reportingCoverage> & {
      reasons: string[];
      start: string;
      end: string;
    }
  >();
  const coverageFor = (period: string) => {
    const cached = coverageByMonth.get(period);
    if (cached) return cached;
    const coverage = reportingCoverage(
      scopedAccounts,
      scopedStatements,
      transactions,
      period,
      currency,
      rates,
      settings,
      scopedProposals,
      today,
      scopedProjection,
    );
    const [start, end] = reportingPeriod(period, settings, transactions);
    const documents = scopedStatements.filter(
      (s) => s.statementPeriodStart < end && s.statementPeriodEnd >= start,
    );
    const verifiedIds = new Set(coverage.verifiedStatements.map((s) => s.id));
    const reasons: string[] = [];
    if (end > today) reasons.push("This period has not finished yet.");
    if (!scopedAccounts.length)
      reasons.push("No statement accounts available.");
    if (unknownAccounts)
      reasons.push("Some category transactions have missing account details.");
    for (const account of scopedAccounts) {
      if (account.tracking === "manual") {
        reasons.push(
          `${account.displayName}: manual activity cannot verify a full period.`,
        );
        continue;
      }
      if (!coverage.incompleteAccountIds.includes(account.id)) continue;
      const source = documents.filter((s) => s.accountId === account.id);
      const label = `${account.displayName} (${account.maskedAccountIdentifier})`;
      if (source.some((s) => s.periodSource === "transaction-coverage"))
        reasons.push(`${label}: statement dates need verification.`);
      else if (source.some((s) => !verifiedIds.has(s.id)))
        reasons.push(
          `${label}: statement amounts or source rows need verification.`,
        );
      else if (!source.length)
        reasons.push(`${label}: no statement covers this period.`);
      else if (end <= today)
        reasons.push(
          `${label}: verified statements do not cover the full period.`,
        );
      // A source-less row also prevents a nominally complete statement range
      // from qualifying. Keep this distinct from an ordinary date-coverage gap.
      if (
        scopedRows.some(
          (row) =>
            row.accountId === account.id &&
            row.date >= start &&
            row.date < end &&
            !documents.some((s) => s.id === row.statementId),
        )
      )
        reasons.push(
          `${label}: a transaction has no verified source statement.`,
        );
    }
    if (coverage.missingRates)
      reasons.push("Exchange rates are missing for this period.");
    if (coverage.staleRates)
      reasons.push("Exchange rates need updating for this period.");
    if (coverage.pendingTransfers)
      reasons.push("Transfer matches need review for this period.");
    if (incomeCategory && !coverage.hasIncomeSource)
      reasons.push("No verified income-source statement for this period.");
    const complete =
      coverage.complete &&
      !unknownAccounts &&
      !manualAccounts.length &&
      (!incomeCategory || coverage.hasIncomeSource);
    const observedCategoryData = categoryRows.some(
      (row) => row.date >= start && row.date < end,
    );
    const result = {
      ...coverage,
      complete,
      hasData: coverage.hasData || observedCategoryData,
      hasUnverifiedStatements:
        coverage.hasUnverifiedStatements ||
        (observedCategoryData &&
          (unknownAccounts || manualAccounts.length > 0)),
      reasons,
      start,
      end,
      status:
        coverage.complete && !complete
          ? ("Partial" as const)
          : coverage.status === "No data" && observedCategoryData
            ? ("Unverified" as const)
            : coverage.status,
    };
    coverageByMonth.set(period, result);
    return result;
  };
  const overallCoverageByMonth = new Map<
    string,
    ReturnType<typeof reportingCoverage>
  >();
  const overallCoverageFor = (period: string) => {
    const cached = overallCoverageByMonth.get(period);
    if (cached) return cached;
    const result = reportingCoverage(
      accounts,
      statements,
      transactions,
      period,
      currency,
      rates,
      settings,
      proposals,
      today,
      projection,
    );
    overallCoverageByMonth.set(period, result);
    return result;
  };
  const stats = categoryOverview(
    projection.transactions,
    scopedAccounts,
    scopedStatements,
    categories,
    categoryId,
    month,
    currency,
    window,
    today,
    (period) => coverageFor(period).complete,
    settings,
    transactions,
  );
  // Keep every baseline month visible alongside the selected month. Previously
  // the chart dropped the oldest month even though it contributed to the mean.
  const series = stats.series.map((point) => {
    const coverage = coverageFor(point.month);
    return {
      ...point,
      amount: point.amount === 0 && !coverage.complete ? null : point.amount,
      unavailableReason:
        incomeCategory && !coverage.hasIncomeSource
          ? "No income source imported"
          : "No verified statements",
      coverage,
      incomeCoverage: overallCoverageFor(point.month),
    };
  });
  return {
    stats,
    series,
    coverage: coverageFor(month),
    financialCoverage: overallCoverageFor(month),
    scopedAccounts,
    inferredScope: knownIds.size > 0,
    approximate: scopedProjection.transactions.some((row) => !!row.conversion),
  };
}
