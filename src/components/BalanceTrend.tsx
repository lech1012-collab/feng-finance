import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type {
  Account,
  FxRate,
  ManualValuation,
  Statement,
  Transaction,
} from "../domain/models";
import { compactMoney, currencyPrecision, money } from "../domain/money";
import { formatDateRange } from "../domain/dates";
import { displayAccountName } from "../domain/presentation";
import { localToday } from "../analytics/reminders";
import { reportingBalanceHistory } from "../analytics/reporting-balance-history";
import {
  availableBalanceRanges,
  balanceTrendPoints,
  balanceTrendScopes,
  balanceTrendSummary,
  defaultBalanceTrendScope,
  recommendedBalancePeriod,
  trendWindow,
  type BalanceTrendScope,
} from "../analytics/balance-trend";
import { ImportButton } from "./ImportPicker";
import { SegmentedControl } from "./UIPrimitives";
import { useRootFontSize } from "./useRootFontSize";
import "./BalanceTrend.css";

export interface BalanceTrendProps {
  accounts: Account[];
  statements: Statement[];
  transactions: Transaction[];
  valuations: ManualValuation[];
  rates: FxRate[];
  month: string;
  currency: string;
  period: number;
  onPeriodChange: (period: number) => void;
}
const dateLabel = (date: string, year = true) =>
  new Date(`${date}T12:00:00Z`)
    .toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      ...(year ? ({ year: "numeric" } as const) : {}),
      timeZone: "UTC",
    })
    .replace(/\bSept\b/g, "Sep");
const scopeLabel = (scope: BalanceTrendScope) =>
  scope.kind === "cash"
    ? "Cash balances"
    : scope.kind === "net"
      ? "Net worth"
      : displayAccountName(scope.accounts[0]);
const valueLabel = (value: number, currency: string, debt: boolean) =>
  debt
    ? `${money(Math.abs(value), currency)} ${value < 0 ? "credit" : "debt owed"}`
    : money(value, currency);

/** One question, one series. All financial facts come from the existing balance engine. */
export function BalanceTrend(props: BalanceTrendProps) {
  const {
    accounts,
    statements,
    transactions,
    valuations,
    rates,
    month,
    currency,
    period,
    onPeriodChange,
  } = props;
  const today = localToday(),
    id = useId();
  const history = useMemo(
    () =>
      reportingBalanceHistory(
        accounts,
        statements,
        transactions,
        valuations,
        rates,
        month,
        currency,
        12,
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
      today,
    ],
  );
  const scopes = useMemo(
    () => balanceTrendScopes(history.accounts),
    [history.accounts],
  );
  const [selectedScope, setSelectedScope] = useState<string>();
  const scope =
    scopes.find((s) => s.id === selectedScope) ??
    defaultBalanceTrendScope(history, scopes);
  const allPoints = useMemo(
    () => (scope ? balanceTrendPoints(history, scope) : []),
    [history, scope],
  );
  const context = `${month}:${scope?.id ?? "none"}`;
  const [chosenRange, setChosenRange] = useState<string>();
  const recommendation = recommendedBalancePeriod(allPoints, history.end);
  const shownPeriod = chosenRange === context ? period : recommendation;
  useEffect(() => {
    if (chosenRange !== context) {
      onPeriodChange(recommendation);
      setChosenRange(context);
    }
  }, [context, chosenRange, recommendation, onPeriodChange]);
  const points = trendWindow(allPoints, history.end, shownPeriod),
    summary = balanceTrendSummary(points);
  const scopeName = scope ? scopeLabel(scope) : "Cash balances";
  const debt = scope?.debt ?? false;
  const converted = scope?.accounts.some((a) => a.currency !== currency);
  const rangeOptions = availableBalanceRanges(
    allPoints,
    history.end,
    shownPeriod,
  ).map((n) => ({
    value: n,
    label: `${n}M`,
    ariaLabel: `${n} ${n === 1 ? "month" : "months"}`,
  }));
  const showRanges =
    rangeOptions.length > 1 &&
    allPoints.filter((point) => point.verified).length >= 2;
  const hasEarlier =
    showRanges &&
    allPoints.some(
      (point) =>
        point.verified && point.date < (points[0]?.date ?? history.end),
    );
  const [inspection, setInspection] = useState<{
    context: string;
    index: number;
  }>();
  const inspectionContext = `${context}:${shownPeriod}`;
  const selectedIndex =
    inspection?.context === inspectionContext
      ? Math.min(inspection.index, points.length - 1)
      : Math.max(
          0,
          points.findLastIndex((p) => p.value !== null),
        );
  const inspected = points[selectedIndex];
  const plot = useRef<HTMLDivElement>(null),
    dragging = useRef(false);
  const [width, setWidth] = useState(300);
  const font = useRootFontSize(),
    height = Math.max(204, font * 12);
  useEffect(() => {
    if (!plot.current) return;
    const measure = () =>
      setWidth(
        Math.max(180, plot.current?.getBoundingClientRect().width ?? 300),
      );
    measure();
    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(measure)
        : undefined;
    if (observer && plot.current) observer.observe(plot.current);
    return () => observer?.disconnect();
  }, [summary.observations.length >= 2]);
  const gutter = Math.max(48, font * 3.3),
    right = width - 12,
    top = font,
    bottom = height - font * 2.6;
  const knownValues = summary.observations.map((p) => p.value);
  const low = Math.min(0, ...knownValues),
    high = Math.max(0, low + 10 ** currencyPrecision(currency), ...knownValues);
  const x = (date: string) =>
    gutter +
    ((Date.parse(date) - Date.parse(points[0]?.date ?? history.start)) /
      Math.max(
        1,
        Date.parse(points.at(-1)?.date ?? history.end) -
          Date.parse(points[0]?.date ?? history.start),
      )) *
      (right - gutter);
  const y = (value: number) =>
    bottom - ((value - low) / (high - low)) * (bottom - top);
  const ticks = [
    low,
    low < 0 && high > 0 ? 0 : Math.round((high + low) / 2),
    high,
  ];
  const snapshotsOnly =
    summary.observations.length > 0 &&
    summary.observations.every((point) => !point.daily);
  const hasSnapshots = summary.observations.some((point) => !point.daily);
  const missingFx = scope?.accounts.some(
    (a) =>
      a.currency !== currency &&
      history.data.some(
        (p) =>
          p.date >= (points[0]?.date ?? history.end) &&
          p.date <= history.end &&
          p.nativeValues[a.id] != null &&
          p.values[a.id] === null,
      ),
  );
  const change = summary.change;
  const changeText = change
    ? change.amount === 0
      ? "No balance change"
      : debt
        ? summary.observations[0].value >= 0 && summary.latest!.value >= 0
          ? `Debt ${change.amount > 0 ? "increased" : "reduced"} by ${money(Math.abs(change.amount), currency)}`
          : `Card position ${change.amount > 0 ? "worsened" : "improved"} by ${money(Math.abs(change.amount), currency)}`
        : `${money(Math.abs(change.amount), currency)} ${change.amount > 0 ? "higher" : "lower"}`
    : undefined;
  const internalGaps = summary.gaps.filter(
    (gap) =>
      summary.observations[0] &&
      summary.latest &&
      gap.start > summary.observations[0].date &&
      gap.end < summary.latest.date,
  );
  const gap = internalGaps[0];
  const choosePoint = (clientX: number) => {
    const bounds = plot.current?.getBoundingClientRect();
    if (!bounds) return;
    const fraction = Math.max(
      0,
      Math.min(
        1,
        (clientX - bounds.left - gutter) / Math.max(1, right - gutter),
      ),
    );
    setInspection({
      context: inspectionContext,
      index: Math.round(fraction * (points.length - 1)),
    });
  };
  const pointText = inspected
    ? inspected.value === null
      ? "No verified balance"
      : `${valueLabel(inspected.value, currency, debt)}${inspected.verified ? "" : " · Reported, unverified"}`
    : "No verified balance";
  return (
    <section className="card balance-trend" aria-labelledby={`${id}-title`}>
      <div className="section-heading">
        <h2 id={`${id}-title`}>Balance trend</h2>
        {!showRanges && summary.observations.length >= 2 && (
          <span className="muted">
            {shownPeriod} {shownPeriod === 1 ? "month" : "months"}
          </span>
        )}
      </div>
      {scopes.length > 1 ? (
        <label className="balance-trend-scope">
          <span className="sr-only">Balance to show</span>
          <select
            aria-label="Balance to show"
            value={scope?.id ?? ""}
            onChange={(e) => setSelectedScope(e.target.value)}
          >
            {scopes.map((s) => (
              <option key={s.id} value={s.id}>
                {scopeLabel(s)}
                {s.kind === "account"
                  ? ` · ${s.accounts[0].maskedAccountIdentifier}`
                  : ""}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className="balance-trend-name">{scopeName}</p>
      )}
      {summary.latest ? (
        <div
          className="balance-trend-headline"
          data-verified={summary.latest.verified}
        >
          <strong className="financial-value">
            {converted ? "≈ " : ""}
            {money(
              debt ? Math.abs(summary.latest.value) : summary.latest.value,
              currency,
            )}
          </strong>
          {debt && (
            <span>
              {summary.latest.value < 0 ? "Credit balance" : "Debt owed"}
            </span>
          )}
          <span>
            As of{" "}
            <time dateTime={summary.latest.date}>
              {dateLabel(summary.latest.date)}
            </time>
            {!summary.latest.verified && " · Reported, unverified"}
          </span>
          {change && (
            <p className="balance-trend-change">
              <strong>
                {changeText}
                {change.percent !== undefined && change.amount !== 0
                  ? ` (${change.amount > 0 ? "+" : "−"}${Math.abs(change.percent).toFixed(1)}%)`
                  : ""}
              </strong>
              <span>{formatDateRange(change.start, change.end)}</span>
            </p>
          )}
        </div>
      ) : (
        <p className="balance-trend-empty">
          {missingFx
            ? "An exchange rate is needed to show this balance."
            : scope?.kind === "net"
              ? "Net worth needs verified balances for every included account on the same date. Choose cash balances or an account to see its history."
              : scope?.kind === "cash"
                ? "Cash history needs verified balances for each current and savings account. Choose an account to see its available balances."
                : "No balance is recorded in this period."}
        </p>
      )}
      {showRanges && (
        <SegmentedControl
          className="balance-periods balance-trend-periods"
          label="Balance trend range"
          value={shownPeriod}
          options={rangeOptions}
          onChange={(n) => {
            setChosenRange(context);
            onPeriodChange(n);
            setInspection(undefined);
          }}
        />
      )}
      {summary.observations.length >= 2 && (
        <>
          <div
            ref={plot}
            className="balance-trend-plot"
            role="slider"
            tabIndex={0}
            aria-label="Inspect balance history"
            aria-valuemin={0}
            aria-valuemax={Math.max(0, points.length - 1)}
            aria-valuenow={selectedIndex}
            aria-valuetext={`${inspected ? dateLabel(inspected.date) : ""}: ${pointText}`}
            aria-describedby={`${id}-interaction`}
            onKeyDown={(e) => {
              const index =
                e.key === "Home"
                  ? 0
                  : e.key === "End"
                    ? points.length - 1
                    : e.key === "ArrowLeft" || e.key === "ArrowDown"
                      ? Math.max(0, selectedIndex - 1)
                      : e.key === "ArrowRight" || e.key === "ArrowUp"
                        ? Math.min(points.length - 1, selectedIndex + 1)
                        : undefined;
              if (index !== undefined) {
                e.preventDefault();
                setInspection({ context: inspectionContext, index });
              }
            }}
            onPointerDown={(e) => {
              dragging.current = true;
              e.currentTarget.setPointerCapture?.(e.pointerId);
              choosePoint(e.clientX);
            }}
            onPointerMove={(e) => {
              if (dragging.current) choosePoint(e.clientX);
            }}
            onPointerUp={() => {
              dragging.current = false;
            }}
            onPointerCancel={() => {
              dragging.current = false;
            }}
          >
            <svg
              className="position-history"
              viewBox={`0 0 ${width} ${height}`}
              style={{ height }}
              role="img"
              aria-label={`${scopeName} balance trend from ${dateLabel(points[0].date)} to ${dateLabel(points.at(-1)!.date)}. ${snapshotsOnly ? "Dated statement balances; gaps are not joined." : "Lines stop at missing or unverified dates."}`}
            >
              {ticks.map((value, index) => (
                <g key={index}>
                  <line
                    x1={gutter}
                    x2={right}
                    y1={y(value)}
                    y2={y(value)}
                    stroke="var(--line)"
                  />
                  <text
                    x={gutter - 8}
                    y={y(value)}
                    dominantBaseline="middle"
                    textAnchor="end"
                    className="balance-trend-axis"
                  >
                    {compactMoney(value, currency)}
                  </text>
                </g>
              ))}
              <g
                data-account-id={
                  scope?.kind === "account" ? scope.accounts[0].id : undefined
                }
                data-total-position={scope?.kind === "net" ? true : undefined}
              >
                {!snapshotsOnly &&
                  summary.segments
                    .filter((s) => s.length > 1)
                    .map((segment) => (
                      <path
                        key={segment[0].date}
                        data-verified="true"
                        d={segment
                          .map((p, i) =>
                            i
                              ? `H ${x(p.date)} V ${y(p.value!)}`
                              : `M ${x(p.date)} ${y(p.value!)}`,
                          )
                          .join(" ")}
                        fill="none"
                        stroke="var(--accent)"
                        strokeWidth="2.5"
                      />
                    ))}
                {summary.observations
                  .filter(
                    (p) =>
                      snapshotsOnly ||
                      !p.verified ||
                      summary.segments.some(
                        (s) =>
                          s[0].date === p.date || s.at(-1)!.date === p.date,
                      ),
                  )
                  .map((p) => (
                    <circle
                      key={p.date}
                      data-verified={p.verified}
                      cx={x(p.date)}
                      cy={y(p.value)}
                      r="4"
                      fill={p.verified ? "var(--accent)" : "var(--surface)"}
                      stroke="var(--accent)"
                      strokeWidth="2"
                    >
                      <title>
                        {dateLabel(p.date)}:{" "}
                        {valueLabel(p.value, currency, debt)}
                        {p.verified ? "" : " · Reported, unverified"}
                      </title>
                    </circle>
                  ))}
              </g>
              {inspection?.context === inspectionContext && inspected && (
                <g aria-hidden="true">
                  <line
                    x1={x(inspected.date)}
                    x2={x(inspected.date)}
                    y1={top}
                    y2={bottom}
                    stroke="var(--muted)"
                    strokeDasharray="3 4"
                  />
                  {inspected.value !== null && (
                    <circle
                      cx={x(inspected.date)}
                      cy={y(inspected.value)}
                      r="6"
                      className="balance-trend-selected"
                    />
                  )}
                </g>
              )}
              {[points[0], points.at(-1)!].map((p, i) => (
                <text
                  key={i}
                  x={i ? right : gutter}
                  y={height - font * 0.4}
                  textAnchor={i ? "end" : "start"}
                  className="balance-trend-axis"
                >
                  {dateLabel(p.date, false)}
                </text>
              ))}
            </svg>
          </div>
          <div className="balance-trend-readout" aria-live="off">
            <time dateTime={inspected?.date}>
              {inspected && dateLabel(inspected.date)}
            </time>
            <strong>
              {converted && inspected?.value !== null ? "≈ " : ""}
              {pointText}
            </strong>
          </div>
          <p id={`${id}-interaction`} className="balance-trend-hint">
            Drag to inspect a date.
            <span className="sr-only">
              {" "}
              Keyboard: use the arrow keys, Home or End.
            </span>
          </p>
          {snapshotsOnly && (
            <p className="balance-trend-note">
              Statement dates only. No daily balance is assumed between them.
            </p>
          )}
          {hasSnapshots && !snapshotsOnly && !gap && (
            <p className="balance-trend-note">
              Some balances are available only on statement dates.
            </p>
          )}
          {gap && !snapshotsOnly && (
            <p className="balance-trend-note">
              {internalGaps.length === 1
                ? `No verified balance for ${formatDateRange(gap.start, gap.end)}.`
                : `${internalGaps.length} gaps in this history.`}{" "}
              Lines stop at missing dates.
            </p>
          )}
        </>
      )}
      {summary.observations.length === 1 && (
        <p className="balance-trend-note">
          {hasEarlier
            ? "Choose a longer range to see earlier balances."
            : summary.latest?.verified
              ? "Earlier statements will show how this balance changed."
              : "This is the reported balance. Check the statement before using it for comparisons."}
        </p>
      )}
      {!summary.observations.length && missingFx ? (
        <Link className="balance-trend-link" to="/settings?section=currency">
          Check exchange rates
        </Link>
      ) : (summary.observations.length < 2 && !hasEarlier) ||
        (gap && !snapshotsOnly) ? (
        <ImportButton className="balance-trend-link">
          {summary.observations.length === 1
            ? "Import earlier statement"
            : "Import missing statement"}
        </ImportButton>
      ) : null}
      {converted && (
        <p className="balance-trend-note">
          Values are converted to {currency} at each date. Changes can include
          exchange-rate movements.
        </p>
      )}
      <details className="balance-trend-help">
        <summary>How this is calculated</summary>
        <p>
          Cash balances include current and savings accounts. Net worth
          subtracts debts from all included assets. Verified bank transactions
          supply daily balances; missing dates stay empty. Card summaries supply
          balances only on their statement dates. Manual valuations step between
          recorded dates. Transfers change account balances without counting as
          income or spending.
        </p>
      </details>
    </section>
  );
}
