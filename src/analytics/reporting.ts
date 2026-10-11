import type {
  Account,
  Statement,
  Transaction,
  FxRate,
  Setting,
  TransferProposal,
} from "../domain/models";
import { monthCoverage } from "./coverage";
import { cashFlow, propertyFlow } from "./calculations";
import { effectiveTransactions } from "./effective-transactions";
import { projectedReportingTransactions, workingDayAge } from "./fx";
import { reportingPeriod } from "../domain/period";
import { monthOffset } from "../domain/dates";
export function reportingCoverage(
  accounts: Account[],
  statements: Statement[],
  rows: Transaction[],
  month: string,
  currency: string,
  rates: FxRate[],
  settings: Setting[],
  proposals: TransferProposal[] = [],
  today = new Date().toISOString().slice(0, 10),
  preparedProjection?: ReturnType<typeof projectedReportingTransactions>,
) {
  const range = reportingPeriod(month, settings, rows);
  const coverage = monthCoverage(
    accounts,
    statements,
    rows,
    month,
    "*",
    today,
    range,
  );
  const ids = new Set(
    rows
      .filter((t) => t.date >= range[0] && t.date < range[1])
      .map((t) => t.id),
  );
  const pendingTransfers = proposals.filter(
    (p) =>
      p.status === "pending" && (ids.has(p.debitTxId) || ids.has(p.creditTxId)),
  ).length;
  const projection =
    preparedProjection ??
    projectedReportingTransactions(
      effectiveTransactions(rows),
      currency,
      rates,
    );
  const missingRates = projection.missing.filter(
    (t) => t.date >= range[0] && t.date < range[1],
  ).length;
  const staleRates = projection.transactions.some(
    (t) =>
      t.date >= range[0] &&
      t.date < range[1] &&
      t.conversion &&
      workingDayAge(t.conversion.date, t.date) > 3,
  );
  const complete =
    coverage.complete &&
    pendingTransfers === 0 &&
    missingRates === 0 &&
    !staleRates;
  return {
    ...coverage,
    complete,
    status:
      missingRates || staleRates
        ? ("Unverified" as const)
        : pendingTransfers
          ? ("Partial" as const)
          : coverage.status,
    pendingTransfers,
    missingRates,
    staleRates,
  };
}
export function reportingMonthlySeries(
  rows: Transaction[],
  accounts: Account[],
  statements: Statement[],
  end: string,
  count: number,
  currency: string,
  rates: FxRate[],
  settings: Setting[],
  proposals: TransferProposal[] = [],
  today?: string,
) {
  const projection = projectedReportingTransactions(
    effectiveTransactions(rows),
    currency,
    rates,
  );
  const projected = projection.transactions;
  return Array.from({ length: count }, (_, i) => {
    const month = monthOffset(end, i - count + 1);
    const [from, to] = reportingPeriod(month, settings, rows);
    const selected = projected.filter((t) => t.date >= from && t.date < to);
    const coverage = reportingCoverage(
      accounts,
      statements,
      rows,
      month,
      currency,
      rates,
      settings,
      proposals,
      today,
      projection,
    );
    const usable =
      coverage.status === "Complete" || coverage.status === "Partial";
    const flow = cashFlow(selected, currency);
    return {
      month,
      label: new Date(`${month}-01T12:00:00Z`).toLocaleDateString("en-GB", {
        month: "short",
        timeZone: "UTC",
      }),
      income: usable && coverage.hasIncomeSource ? flow.income : null,
      expenses: usable ? flow.expenses : null,
      net: usable && coverage.hasIncomeSource ? flow.net : null,
      property: usable ? propertyFlow(selected, currency).net : null,
      coverage,
    };
  });
}
