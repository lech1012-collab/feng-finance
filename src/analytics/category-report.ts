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
import { formatUkDate } from "../domain/dates";
import { safeSum } from "../domain/money";
import { categoryMatches, categoryOverview } from "./category";
import { effectiveTransactions } from "./effective-transactions";
import { projectedReportingTransactions } from "./fx";
import { reportingCoverage } from "./reporting";
import { verifiedStatements } from "./coverage";

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
  // A linked refund can reduce a purchase in an earlier month, including a
  // split line, even when its credit is on another account. Its source must be
  // verified too; checking only the purchase month's statements is insufficient.
  const categoryTargets = new Map<string, typeof categoryRows>();
  for (const row of categoryRows)
    for (const id of [row.id, row.parentId]) {
      if (!id) continue;
      const targets = categoryTargets.get(id) ?? [];
      targets.push(row);
      categoryTargets.set(id, targets);
    }
  const linkedRefunds = transactions.flatMap((refund) => {
    if (
      refund.kind !== "refund" &&
      !(refund.categoryId === "refund" && refund.amount > 0)
    )
      return [];
    const allocations = refund.refundAllocations ?? [];
    const targets = allocations.flatMap(
      (allocation) => categoryTargets.get(allocation.transactionId) ?? [],
    );
    const dates = [...new Set(targets.map((row) => row.date))];
    const validAllocation =
      Number.isSafeInteger(refund.amount) &&
      refund.amount > 0 &&
      allocations.every(
        (allocation) =>
          Number.isSafeInteger(allocation.amount) && allocation.amount > 0,
      ) &&
      safeSum(allocations.map((allocation) => allocation.amount)) <=
        refund.amount &&
      targets.every((row) => row.currency === refund.currency);
    return dates.length ? [{ refund, dates, validAllocation }] : [];
  });
  const verifiedSourceIds = linkedRefunds.length
    ? new Set(
        verifiedStatements(statements, transactions, today).map(
          (statement) => statement.id,
        ),
      )
    : new Set<string>();
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
    const unverifiedRefunds = linkedRefunds.filter(
      ({ refund, dates, validAllocation }) =>
        dates.some((date) => date >= start && date < end) &&
        (!validAllocation ||
          !verifiedSourceIds.has(refund.statementId) ||
          !accounts.some(
            (account) =>
              account.id === refund.accountId &&
              account.currency === refund.currency &&
              account.tracking !== "manual",
          )),
    );
    for (const { refund } of unverifiedRefunds)
      reasons.push(
        `Linked refund dated ${formatUkDate(refund.date)}: source amounts or dates need verification.`,
      );
    const complete =
      coverage.complete &&
      !unknownAccounts &&
      !manualAccounts.length &&
      !unverifiedRefunds.length &&
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
        unverifiedRefunds.length > 0 ||
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
    (period) => {
      const [start, end] = reportingPeriod(period, settings, transactions);
      return projection.missing.some(
        (row) =>
          categoryMatches(row, categoryId) &&
          financialType(row) !== "transfer" &&
          row.amount !== 0 &&
          row.date >= start &&
          row.date < end,
      );
    },
  );
  // Keep every baseline month visible alongside the selected month. Previously
  // the chart dropped the oldest month even though it contributed to the mean.
  const series = stats.series.map((point) => {
    const coverage = coverageFor(point.month);
    return {
      ...point,
      amount: point.available ? point.amount : null,
      unavailableReason: coverage.missingRates
        ? "Exchange rates needed"
        : incomeCategory && !coverage.hasIncomeSource
          ? "No income source imported"
          : "No category transactions or verified zero",
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
