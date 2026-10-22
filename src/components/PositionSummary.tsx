import { localToday } from "../analytics/reminders";
import { Link } from "react-router-dom";
import { useMemo } from "react";
import type { Pot, Transaction } from "../domain/models";
import {
  statementBalanceEvidence,
  statementBalanceDate,
} from "../analytics/statement-balances";
import {
  latestValuation,
  liabilityTypes,
  valuationStale,
} from "../analytics/net-worth";
import { convertMinor, workingDayAge } from "../analytics/fx";
import { monthBounds, monthOffset, formatUkDate } from "../domain/dates";
import { money, safeSum } from "../domain/money";
import { potsOverview } from "../analytics/planning-v2";
import { manualCashBalance } from "../analytics/manual-cash";
import { reportingBalanceHistory } from "../analytics/reporting-balance-history";
import { BalanceTrend, type BalanceTrendProps } from "./BalanceTrend";

type PositionSummaryProps = BalanceTrendProps & {
  pots: Pot[];
  historyOnly?: boolean;
};
export function PositionSummary(props: PositionSummaryProps) {
  return props.historyOnly ? (
    <BalanceTrend {...props} />
  ) : (
    <PositionSnapshot {...props} />
  );
}

function PositionSnapshot({
  accounts,
  statements,
  transactions,
  valuations,
  rates,
  pots,
  month,
  currency,
  period,
}: PositionSummaryProps) {
  const today = localToday();
  const end = new Date(
    Date.parse(`${monthBounds(month)[1]}T12:00:00Z`) - 86400000,
  )
    .toISOString()
    .slice(0, 10);
  const asOf = end < today ? end : today;
  const statementRows = new Map<string, Transaction[]>();
  for (const row of transactions) {
    const rows = statementRows.get(row.statementId) ?? [];
    rows.push(row);
    statementRows.set(row.statementId, rows);
  }
  const snapshot = (date: string) =>
    accounts
      .filter((a) => a.includeInNetWorth !== false)
      .map((account) => {
        let native: number | undefined;
        let observed: string | undefined;
        let reliable = false;
        let balanceVerified = false;
        let evidenceReason: string | undefined;
        let source = "Statement";
        if (account.tracking === "manual") {
          const valuation = latestValuation(account, valuations, date);
          const cashWallet =
            account.accountType === "current" ||
            account.accountType === "savings";
          const cashBalance = cashWallet
            ? manualCashBalance(account, valuations, transactions, date)
            : undefined;
          native = valuation
            ? liabilityTypes.has(account.accountType)
              ? -Math.abs(valuation.valueMinor)
              : valuation.valueMinor
            : undefined;
          if (cashWallet) native = cashBalance?.valueMinor;
          observed = cashWallet ? cashBalance?.date : valuation?.date;
          reliable =
            native !== undefined &&
            !!observed &&
            (cashWallet || !valuationStale(account, observed, date)) &&
            !valuation?.note?.startsWith("Estimated");
          source = valuation?.note?.startsWith("Estimated")
            ? "Estimated"
            : "Manual";
          balanceVerified = native !== undefined;
        } else {
          const statement = statements
            .filter(
              (s) =>
                s.accountId === account.id && statementBalanceDate(s) <= date,
            )
            .sort(
              (a, b) =>
                statementBalanceDate(b).localeCompare(
                  statementBalanceDate(a),
                ) || b.importedAt.localeCompare(a.importedAt),
            )[0];
          const evidence =
            statement &&
            statementBalanceEvidence(
              statement,
              statementRows.get(statement.id) ?? [],
              today,
            );
          native = statement?.closingBalance;
          observed = statement && statementBalanceDate(statement);
          balanceVerified = evidence?.status === "reconciled";
          evidenceReason = evidence?.reason;
          reliable =
            evidence?.status === "reconciled" &&
            observed?.slice(0, 7) === date.slice(0, 7);
        }
        const converted =
          native === undefined
            ? undefined
            : convertMinor(native, account.currency, currency, date, rates);
        const staleRate =
          !!converted &&
          account.currency !== currency &&
          workingDayAge(converted.date, date) > 3;
        return {
          account,
          native,
          observed,
          source,
          value: converted?.amount,
          conversion: converted,
          reliable: reliable && !staleRate,
          balanceVerified,
          evidenceReason,
        };
      });
  const items = snapshot(asOf);
  const statementItems = items.filter((i) => i.account.tracking !== "manual");
  const cashItems = items.filter(
    (i) =>
      !liabilityTypes.has(i.account.accountType) &&
      (i.account.tracking !== "manual" ||
        ["current", "savings"].includes(i.account.accountType)),
  );
  const cards = statementItems.filter((i) =>
    liabilityTypes.has(i.account.accountType),
  );
  const knownSum = (subset: typeof items) =>
    subset.length && subset.every((i) => i.value !== undefined)
      ? safeSum(subset.map((i) => i.value!))
      : undefined;
  const cash = knownSum(cashItems);
  const cardDebt = cards.every(
    (i) => i.value !== undefined && i.balanceVerified,
  )
    ? safeSum(cards.map((i) => Math.max(0, -i.value!)))
    : undefined;
  const hasManual = items.some((i) => i.account.tracking === "manual");
  const total =
    (cash === undefined && !hasManual) ||
    items.some((i) => i.account.tracking !== "manual" && !i.balanceVerified)
      ? undefined
      : knownSum(items);
  const complete =
    cash !== undefined && items.length > 0 && items.every((i) => i.reliable);
  const converted = items.some((i) => i.account.currency !== currency);
  const potSummary = potsOverview(
    pots,
    accounts,
    statements,
    transactions,
    currency,
    asOf,
    rates,
    valuations,
  );
  const setAside = potSummary.setAsideMinor;
  const priorDate = new Date(
    Date.parse(`${monthBounds(monthOffset(month, -period))[1]}T12:00:00Z`) -
      86400000,
  )
    .toISOString()
    .slice(0, 10);
  const prior = snapshot(priorDate);
  const chart = useMemo(
    () =>
      reportingBalanceHistory(
        accounts,
        statements,
        transactions,
        valuations,
        rates,
        month,
        currency,
        period,
        today,
      ),
    [
      accounts,
      statements,
      transactions,
      valuations,
      rates,
      month,
      currency,
      period,
      today,
    ],
  );
  const priorPoint = chart.data.find((point) => point.date === priorDate);
  const priorSum =
    prior.length > 0 && prior.every((item) => item.reliable)
      ? knownSum(prior)
      : priorPoint?.complete
        ? (priorPoint.total ?? undefined)
        : undefined;
  const comparable =
    complete && total !== undefined && priorSum !== undefined && priorSum !== 0;
  return (
    <section className="card position-summary">
      <div className="section-heading">
        <h2>Where you stand</h2>
        <Link to="/accounts">Accounts</Link>
      </div>
      <span
        className={`coverage-chip ${complete ? "coverage-complete" : "coverage-partial"}`}
      >
        {complete ? "Verified balances" : "Partial or unverified"}
      </span>
      <div className="position-metrics">
        <Link to="/transactions?allDates=1&accountScope=cash">
          <span>Cash</span>
          <strong
            className={cash === undefined ? "metric-unavailable" : undefined}
          >
            {cash === undefined
              ? "Not imported"
              : `${converted ? "≈ " : ""}${money(cash, currency)}${cashItems.every((i) => i.reliable) ? "" : "*"}`}
          </strong>
          {setAside !== undefined && setAside > 0 && (
            <small>
              Set aside {potSummary.converted ? "≈ " : ""}
              {money(setAside, currency)}
              {potSummary.partial ? "*" : ""} · included in cash
            </small>
          )}
        </Link>
        <Link to="/transactions?allDates=1&accountScope=debt">
          <span>Card debt</span>
          <strong
            className={
              cardDebt === undefined ? "metric-unavailable" : undefined
            }
          >
            {cardDebt === undefined
              ? "Unknown"
              : `${converted ? "≈ " : ""}${money(cardDebt, currency)}${cards.every((i) => i.reliable) ? "" : "*"}`}
          </strong>
        </Link>
        <Link to={"/accounts"}>
          <span>Net worth</span>
          <strong
            className={
              total === undefined || !complete
                ? "metric-unavailable"
                : undefined
            }
          >
            {total === undefined || !complete
              ? "Unavailable"
              : `${converted ? "≈ " : ""}${money(total, currency)}${complete ? "" : "*"}`}
          </strong>
        </Link>
      </div>
      {!complete && (
        <p className="coverage-note">
          * Missing or stale balances. Net worth is withheld.
        </p>
      )}

      {comparable && (
        <p className="balance-change">
          {comparable
            ? `${(((total! - priorSum!) / Math.abs(priorSum!)) * 100).toFixed(1)}% vs ${period === 1 ? "last month" : `${period} months ago`} · ${new Date(`${priorDate}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}`
            : "No comparable verified balances for this range"}
        </p>
      )}
      {items.some((i) => i.observed) && (
        <p className="coverage-note">
          Dated balances ·{" "}
          {formatUkDate(
            items
              .flatMap((i) => (i.observed ? [i.observed] : []))
              .sort()
              .at(-1)!,
          )}
        </p>
      )}
      <Link className="accounts-overview-link" to="/accounts">
        {items.length} {items.length === 1 ? "account" : "accounts"} ›
      </Link>
    </section>
  );
}
