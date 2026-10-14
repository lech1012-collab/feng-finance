import { displayAccountName } from "../domain/presentation";
import { localToday } from "../analytics/reminders";
import { Link } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  Account,
  Statement,
  Transaction,
  ManualValuation,
  FxRate,
  Pot,
} from "../domain/models";
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
import { SegmentedControl } from "./UIPrimitives";
export function PositionSummary({
  accounts,
  statements,
  transactions,
  valuations,
  rates,
  pots,
  month,
  currency,
  period,
  onPeriodChange,
  historyOnly = false,
}: {
  accounts: Account[];
  statements: Statement[];
  transactions: Transaction[];
  valuations: ManualValuation[];
  rates: FxRate[];
  pots: Pot[];
  month: string;
  currency: string;
  period: number;
  onPeriodChange: (n: number) => void;
  historyOnly?: boolean;
}) {
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
  const [breakdown, setBreakdown] = useState(false);
  const rangeHistory = useMemo(
    () =>
      historyOnly && period !== 12
        ? reportingBalanceHistory(
            accounts,
            statements,
            transactions,
            valuations,
            rates,
            month,
            currency,
            12,
            today,
          )
        : chart,
    [
      historyOnly,
      period,
      accounts,
      statements,
      transactions,
      valuations,
      rates,
      month,
      currency,
      today,
      chart,
    ],
  );
  const rangeOptions = [1, 3, 6, 12].map((n) => {
    const targetMonth = monthOffset(rangeHistory.end.slice(0, 7), -n);
    const lastDay = new Date(
      Date.parse(`${monthBounds(targetMonth)[1]}T12:00:00Z`) - 86400000,
    ).getUTCDate();
    const threshold = `${targetMonth}-${String(Math.min(Number(rangeHistory.end.slice(8)), lastDay)).padStart(2, "0")}`;
    const points = rangeHistory.data.filter((point) => point.date >= threshold);
    const available =
      points.filter((point) => point.complete && point.total !== null).length >
        1 ||
      (breakdown &&
        rangeHistory.accounts.some(
          (account) =>
            points.filter(
              (point) =>
                point.verified[account.id] && point.values[account.id] !== null,
            ).length > 1,
        ));
    return { value: n, label: `${n}M`, disabled: !available };
  });
  const meaningfulHistory = rangeOptions.some((option) => !option.disabled);
  const [plotWidth, setPlotWidth] = useState(690);
  const tickCount = plotWidth >= 480 ? 4 : 3;
  const plot = useRef<SVGSVGElement>(null);
  const palette = ["#6EA8FF", "#A99BD6", "#F08A7E", "#E7C46A", "#A6B3C6"];
  const plotted = chart.data.flatMap((p) =>
    (breakdown
      ? [...Object.values(p.values), p.total]
      : [p.complete ? p.total : null]
    ).filter((value): value is number => value !== null),
  );
  useEffect(() => {
    const element = plot.current;
    if (!element) return;
    const measure = () => {
      const width = element.getBoundingClientRect().width;
      if (width > 0) setPlotWidth(width);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [historyOnly, plotted.length > 0]);
  const low = Math.min(0, ...plotted),
    high = Math.max(1, ...plotted);
  const x = (date: string) =>
    35 +
    ((Date.parse(date) - Date.parse(chart.start)) /
      Math.max(1, Date.parse(chart.end) - Date.parse(chart.start))) *
      Math.max(1, plotWidth - 70);
  const y = (value: number) =>
    150 - ((value - low) / Math.max(1, high - low)) * 125;
  const paths = (key: string) => {
    const segments: { path: string; verified: boolean }[] = [];
    let path = "",
      previousKnown = false,
      verified = true;
    for (const point of chart.data) {
      const value =
        key === "total"
          ? point.complete
            ? point.total
            : null
          : point.values[key];
      const reliable = key === "total" ? point.complete : point.verified[key];
      if (value === null) {
        if (path) segments.push({ path, verified });
        path = "";
        previousKnown = false;
        continue;
      }
      if (!previousKnown || reliable !== verified) {
        if (path) segments.push({ path, verified });
        path = `M ${x(point.date)} ${y(value)}`;
        verified = reliable;
      } else path += ` H ${x(point.date)} V ${y(value)}`;
      previousKnown = true;
    }
    if (path) segments.push({ path, verified });
    return segments;
  };
  const markers = (key: string) =>
    chart.data.filter((point, index) => {
      const value = point.values[key];
      if (value === null) return false;
      return (
        index === 0 ||
        index === chart.data.length - 1 ||
        chart.data[index - 1]?.values[key] !== value ||
        chart.data[index + 1]?.values[key] === null ||
        chart.data[index - 1]?.values[key] === null
      );
    });
  return (
    <>
      {!historyOnly && (
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
              <strong>
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
              <strong>
                {cardDebt === undefined
                  ? "Unknown"
                  : `${converted ? "≈ " : ""}${money(cardDebt, currency)}${cards.every((i) => i.reliable) ? "" : "*"}`}
              </strong>
            </Link>
            <Link to={"/accounts"}>
              <span>Net worth</span>
              <strong>
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
            {items.length} accounts ›
          </Link>
        </section>
      )}
      {historyOnly && (
        <section className="card">
          <div className="section-heading">
            <h2>Balance history</h2>
            <span className="muted">
              {period} month{period === 1 ? "" : "s"}
            </span>
          </div>
          {meaningfulHistory && (
            <>
              <SegmentedControl
                className="balance-periods"
                label="Balance comparison period"
                value={period}
                options={rangeOptions}
                onChange={onPeriodChange}
              />
              {rangeOptions.some((option) => option.disabled) && (
                <p className="muted">
                  Unavailable ranges need two verified balance points.
                </p>
              )}
            </>
          )}
          <button
            className="balance-breakdown"
            aria-pressed={breakdown}
            onClick={() => setBreakdown(!breakdown)}
          >
            Account breakdown
          </button>
          {plotted.length > 0 ? (
            <>
              <svg
                ref={plot}
                className="position-history"
                style={{ width: "100%", height: 190 }}
                viewBox={`0 0 ${plotWidth} 190`}
                role="img"
                aria-label="Verified daily account balances with gaps for missing bank coverage and stepped manual valuations"
              >
                <line
                  x1="35"
                  x2={plotWidth - 35}
                  y1={y(0)}
                  y2={y(0)}
                  stroke="var(--border)"
                />
                <defs>
                  <pattern
                    id="missing-balance-hatch"
                    width="8"
                    height="8"
                    patternUnits="userSpaceOnUse"
                  >
                    <path
                      d="M -2 2 L 2 -2 M 0 8 L 8 0 M 6 10 L 10 6"
                      stroke="var(--muted)"
                      strokeOpacity=".2"
                      strokeWidth="1"
                    />
                  </pattern>
                </defs>
                {chart.data
                  .filter(
                    (point, index) =>
                      !point.complete && index < chart.data.length - 1,
                  )
                  .map((point) => (
                    <rect
                      key={`gap:${point.date}`}
                      x={x(point.date)}
                      y="20"
                      width={Math.max(
                        0,
                        x(
                          new Date(
                            Date.parse(`${point.date}T12:00:00Z`) + 86400000,
                          )
                            .toISOString()
                            .slice(0, 10),
                        ) - x(point.date),
                      )}
                      height="130"
                      fill="url(#missing-balance-hatch)"
                    >
                      <title>
                        Some account balances are unavailable on{" "}
                        {formatUkDate(point.date)}. No total is inferred.
                      </title>
                    </rect>
                  ))}
                {breakdown &&
                  chart.accounts.map((account, index) => (
                    <g key={account.id} data-account-id={account.id}>
                      {paths(account.id).map((segment, i) => (
                        <path
                          key={i}
                          d={segment.path}
                          fill="none"
                          stroke={palette[index % palette.length]}
                          strokeWidth="2"
                          strokeDasharray={segment.verified ? undefined : "4 4"}
                        />
                      ))}
                      {markers(account.id).map((point) => (
                        <circle
                          key={point.date}
                          data-verified={point.verified[account.id]}
                          cx={x(point.date)}
                          cy={y(point.values[account.id]!)}
                          r="3"
                          fill={palette[index % palette.length]}
                        >
                          <title>
                            {displayAccountName(account)} ({account.institution}
                            ) ·{" "}
                            {new Date(
                              `${point.date}T12:00:00Z`,
                            ).toLocaleDateString("en-GB", {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                              timeZone: "UTC",
                            })}
                            :{" "}
                            {money(
                              liabilityTypes.has(account.accountType)
                                ? Math.abs(point.values[account.id]!)
                                : point.values[account.id]!,
                              currency,
                            )}
                            {liabilityTypes.has(account.accountType)
                              ? " debt owed"
                              : ""}
                            {point.verified[account.id] ? "" : " · unverified"}
                            {account.currency !== currency
                              ? ` · original ${money(point.nativeValues[account.id]!, account.currency)}, rate as of ${formatUkDate(point.rateDates[account.id]!)}`
                              : ""}
                          </title>
                        </circle>
                      ))}
                    </g>
                  ))}
                {paths("total").map((segment, index) => (
                  <path
                    key={`total:${index}`}
                    data-total-position
                    data-verified={segment.verified}
                    d={segment.path}
                    fill="none"
                    stroke="var(--net-color)"
                    strokeWidth="3"
                    strokeDasharray="6 4"
                  />
                ))}
                {Array.from({ length: tickCount }, (_, index) => {
                  const fraction = index / (tickCount - 1);
                  const date = new Date(
                    Date.parse(`${chart.start}T12:00:00Z`) +
                      (Date.parse(`${chart.end}T12:00:00Z`) -
                        Date.parse(`${chart.start}T12:00:00Z`)) *
                        fraction,
                  );
                  return (
                    <text
                      key={index}
                      x={plotWidth * fraction}
                      y="178"
                      textAnchor={
                        index === 0
                          ? "start"
                          : index === tickCount - 1
                            ? "end"
                            : "middle"
                      }
                      fill="var(--muted)"
                      className="balance-axis-date"
                    >
                      {date
                        .toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                          timeZone: "UTC",
                        })
                        .replace(/\bSept\b/g, "Sep")}
                    </text>
                  );
                })}
              </svg>
              <div className="chart-legend">
                {breakdown &&
                  chart.accounts.map((account, index) => (
                    <span key={account.id}>
                      <i
                        style={{ background: palette[index % palette.length] }}
                        aria-hidden="true"
                      />
                      {displayAccountName(account)}
                      {liabilityTypes.has(account.accountType) ? " debt" : ""}
                    </span>
                  ))}
                {chart.data.some((p) => p.complete && p.total !== null) && (
                  <span>Dashed: net worth</span>
                )}
              </div>
            </>
          ) : (
            <p className="muted">
              Import more dated balances to see a trend. Missing history is
              never shown as zero.
            </p>
          )}
          <details>
            <summary>How balances work</summary>
            <p className="muted">
              Bank balances use reconciled daily transactions, including the
              opening balance. Gaps indicate missing or unverified coverage.
              Issue-date-only cards show their dated balance; manual valuations
              step between dates.
            </p>
          </details>
        </section>
      )}
    </>
  );
}
