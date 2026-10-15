import { useRootFontSize } from "../components/useRootFontSize";
import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Link, useSearchParams } from "react-router-dom";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from "recharts";
import { db } from "../storage/database";
import { reportingPlanningForecast } from "../analytics/reporting-forecast";
import {
  CalendarPanel,
  DebtPanel,
  MonthlyBudgetsPanel,
  PotsPanel,
  ScenarioPanel,
} from "../components/PlanningExtensions";
import { reportingPeriod, reportingPeriodLabel } from "../domain/period";
import { localToday } from "../analytics/reminders";
import { money, currencyPrecision } from "../domain/money";
import { MonthPicker } from "../components/common";
import { ImportButton } from "../components/ImportPicker";
import { monthOffset, monthLabel, formatUkDate } from "../domain/dates";
import { monthCoverage, verifiedStatements } from "../analytics/coverage";
import { displayMerchant } from "../domain/presentation";

export default function Planning({
  month,
  setMonth,
  currency,
}: {
  month: string;
  setMonth: (month: string) => void;
  currency: string;
}) {
  const chartRem = useRootFontSize();
  const today = localToday();
  const earliest = [
    `${Number(today.slice(0, 4)) - 3}-01-01`,
    `${monthOffset(month, -6)}-01`,
  ].sort()[0];
  const [horizon, setHorizon] = useState<30 | 60 | 90>(30);
  const [params, setParams] = useSearchParams();
  const tabs = ["budgets", "pots", "calendar", "debt", "forecast"] as const;
  const tab = tabs.find((t) => t === params.get("tab")) ?? "budgets";
  const data = useLiveQuery(
    async () => ({
      accounts: await db.accounts.toArray(),
      rates: await db.fxRates.toArray(),
      statements: await db.statements.toArray(),
      categories: await db.categories.toArray(),
      settings: await db.settings.toArray(),
      recurringSeries: await db.recurringSeries.toArray(),
      transactions: await db.transactions
        .where("date")
        .between(earliest, today, true, true)
        .toArray(),
    }),
    [currency, today, earliest],
  );
  if (!data) return <p role="status">Loading your plan…</p>;
  const forecast = reportingPlanningForecast(
    data.transactions,
    data.accounts,
    data.statements,
    data.settings,
    currency,
    today,
    horizon,
    data.rates,
    data.recurringSeries,
  );
  const end = forecast.points.at(-1);
  const factor = 10 ** currencyPrecision(currency);
  const accounts = new Map(data.accounts.map((a) => [a.id, a.displayName]));
  const documents = verifiedStatements(
    data.statements,
    data.transactions,
    today,
  );
  const coverage = monthCoverage(
    data.accounts,
    data.statements,
    data.transactions,
    month,
    "*",
    today,
    reportingPeriod(month, data.settings, data.transactions),
  );
  const recentCutoff = new Date(
    Date.parse(`${today}T00:00:00Z`) - 35 * 86400000,
  )
    .toISOString()
    .slice(0, 10);
  const missingAccounts = data.accounts.filter(
    (account) =>
      account.tracking !== "manual" &&
      !documents.some(
        (statement) =>
          statement.accountId === account.id &&
          statement.statementPeriodEnd >= recentCutoff,
      ),
  );
  const shortage = forecast.points.find(
    (p) => p.date >= today && p.balance < 0,
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Planning</h1>
          <p className="muted">
            Budgets, upcoming payments and your next balance.
          </p>
        </div>
      </div>
      <div className="planning-period-row">
        <MonthPicker month={month} onChange={setMonth} />
        <p className="coverage-note">
          {reportingPeriodLabel(month, data.settings, data.transactions)} ·{" "}
          {coverage.status}
        </p>
      </div>
      <div
        className="planning-v2-tabs"
        role="tablist"
        aria-label="Planning view"
      >
        {tabs.map((value, index) => (
          <button
            id={`planning-tab-${value}`}
            aria-controls={`planning-panel-${value}`}
            role="tab"
            aria-selected={tab === value}
            tabIndex={tab === value ? 0 : -1}
            key={value}
            onClick={() => setParams({ tab: value })}
            onKeyDown={(e) => {
              if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return;
              e.preventDefault();
              const next =
                tabs[
                  (index + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) %
                    tabs.length
                ];
              setParams({ tab: next });
              document.getElementById(`planning-tab-${next}`)?.focus();
            }}
          >
            {value[0].toUpperCase() + value.slice(1)}
          </button>
        ))}
      </div>
      <div className="planning-v2-panels">
        {tab === "budgets" && (
          <div
            id="planning-panel-budgets"
            role="tabpanel"
            aria-labelledby="planning-tab-budgets"
          >
            <MonthlyBudgetsPanel currency={currency} month={month} />
          </div>
        )}
        {tab === "pots" && (
          <div
            id="planning-panel-pots"
            role="tabpanel"
            aria-labelledby="planning-tab-pots"
          >
            <PotsPanel currency={currency} month={month} />
          </div>
        )}
        {tab === "calendar" && (
          <div
            id="planning-panel-calendar"
            role="tabpanel"
            aria-labelledby="planning-tab-calendar"
          >
            <CalendarPanel currency={currency} month={month} />
          </div>
        )}
        {tab === "debt" && (
          <div
            id="planning-panel-debt"
            role="tabpanel"
            aria-labelledby="planning-tab-debt"
          >
            <DebtPanel currency={currency} month={month} />
          </div>
        )}
        {tab === "forecast" && (
          <div
            id="planning-panel-forecast"
            role="tabpanel"
            aria-labelledby="planning-tab-forecast"
          >
            <section className="card forecast-card">
              <div className="section-heading">
                <h2>Projected total balance</h2>
                <select
                  aria-label="Forecast horizon"
                  value={horizon}
                  onChange={(e) =>
                    setHorizon(Number(e.target.value) as 30 | 60 | 90)
                  }
                >
                  {[30, 60, 90].map((d) => (
                    <option key={d} value={d}>
                      {d} days
                    </option>
                  ))}
                </select>
              </div>
              <p className="coverage-note">
                From{" "}
                <time className="date-value" dateTime={today}>
                  {formatUkDate(today)}
                </time>{" "}
                · next {horizon} days.{" "}
                {forecast.converted
                  ? "≈ Converted using cached exchange rates. "
                  : ""}
                Cash and savings minus card debt; this is an estimate of your
                financial position.{" "}
                {forecast.rateDates.length > 0
                  ? `Rates as of ${forecast.rateDates.map((date) => formatUkDate(date)).join(", ")}. Future rates are assumed unchanged.`
                  : ""}
              </p>
              <p className="forecast-inputs">
                Based on {forecast.baselineMonths} complete previous month
                {forecast.baselineMonths === 1 ? "" : "s"} ·{" "}
                {data.accounts.filter((a) => a.tracking !== "manual").length -
                  missingAccounts.length}{" "}
                of {data.accounts.filter((a) => a.tracking !== "manual").length}{" "}
                account
                {data.accounts.filter((a) => a.tracking !== "manual").length ===
                1
                  ? ""
                  : "s"}{" "}
                with recent verified balances.
              </p>
              {missingAccounts.length > 0 && (
                <p className="coverage-note">
                  Missing or stale balances:{" "}
                  {missingAccounts
                    .map((account) => account.displayName)
                    .join(", ")}
                  . No total forecast is shown until all accounts have a shared
                  verified balance.
                </p>
              )}
              {forecast.reason ? (
                <div className="notice">
                  <p>{forecast.reason}</p>
                  <ImportButton>Import recent statements</ImportButton>
                </div>
              ) : (
                end && (
                  <>
                    <div className="planning-kpis">
                      <div>
                        <span>
                          Estimated on{" "}
                          <time className="date-value" dateTime={end.date}>
                            {formatUkDate(end.date)}
                          </time>
                        </span>
                        <strong>{money(end.balance, currency)}</strong>
                      </div>
                      <div>
                        <span>Expected income · next {horizon} days</span>
                        <strong>
                          {forecast.income === undefined
                            ? "Rate needed"
                            : money(forecast.income, currency)}
                        </strong>
                      </div>
                      <div>
                        <span>Expected bills · next {horizon} days</span>
                        <strong>
                          {forecast.bills === undefined
                            ? "Rate needed"
                            : money(forecast.bills, currency)}
                        </strong>
                      </div>
                    </div>
                    <div
                      className="chart"
                      role="img"
                      aria-label="Projected total balance with higher and lower variable-spending scenarios"
                    >
                      <ResponsiveContainer width="100%" height={260}>
                        <LineChart
                          data={forecast.points}
                          margin={{ top: 13, right: 8, left: -15, bottom: 0 }}
                        >
                          <CartesianGrid
                            vertical={false}
                            stroke="var(--line)"
                          />
                          <XAxis
                            dataKey="date"
                            minTickGap={40}
                            tickFormatter={(v) => formatUkDate(String(v))}
                            tick={{ fill: "var(--muted)", fontSize: 13 }}
                          />
                          <YAxis
                            width={Math.max(60, Math.round(chartRem * 3.75))}
                            tickFormatter={(v) =>
                              `${+(Number(v) / factor / 1000).toFixed(1)}k`
                            }
                            tick={{ fill: "var(--muted)", fontSize: 13 }}
                          />
                          <Tooltip
                            labelFormatter={(value) =>
                              formatUkDate(String(value))
                            }
                            formatter={(v) => money(Number(v), currency)}
                            contentStyle={{
                              background: "var(--surface)",
                              border: "1px solid var(--line)",
                              color: "var(--ink)",
                            }}
                          />
                          <ReferenceLine y={0} stroke="var(--chart-expense)" />
                          <Line
                            name="Usual spending"
                            dataKey="balance"
                            stroke="var(--chart-balance)"
                            strokeWidth={3}
                            dot={false}
                            isAnimationActive={false}
                          />
                          <Line
                            name="25% more variable spending"
                            dataKey="lower"
                            stroke="var(--chart-expense)"
                            strokeDasharray="4 4"
                            dot={false}
                            isAnimationActive={false}
                          />
                          <Line
                            name="25% less variable spending"
                            dataKey="upper"
                            stroke="var(--chart-net)"
                            strokeDasharray="4 4"
                            dot={false}
                            isAnimationActive={false}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="chart-legend">
                      <span>Solid: usual spending</span>
                      <span>Dashed: variable spending ±25%</span>
                    </div>
                    {shortage && (
                      <p className="notice warning">
                        The model drops below zero around{" "}
                        <time className="date-value" dateTime={shortage.date}>
                          {formatUkDate(shortage.date)}
                        </time>
                        . Check payment timing and recent balances before making
                        spending decisions.
                      </p>
                    )}
                    <details>
                      <summary>Forecast inputs and assumptions</summary>
                      <p>
                        Starting point:{" "}
                        {money(forecast.anchor!.total!, currency)} verified on{" "}
                        <time
                          className="date-value"
                          dateTime={forecast.anchor!.date}
                        >
                          {formatUkDate(forecast.anchor!.date)}
                        </time>{" "}
                        across {data.accounts.length} account
                        {data.accounts.length === 1 ? "" : "s"}. Movements since
                        that date use imported transactions and estimated
                        missing recurring payments. Unobserved day-to-day
                        spending is estimated from {forecast.baselineMonths}{" "}
                        complete month{forecast.baselineMonths === 1 ? "" : "s"}
                        .
                      </p>
                      <ul>
                        {!forecast.converted &&
                          data.accounts
                            .filter((a) => a.tracking !== "manual")
                            .map((account, index) => (
                              <li key={account.id}>
                                {account.displayName}:{" "}
                                {money(
                                  forecast.anchor!.balances[
                                    `account${index}`
                                  ] ?? 0,
                                  currency,
                                )}{" "}
                                on{" "}
                                <time
                                  className="date-value"
                                  dateTime={forecast.anchor!.date}
                                >
                                  {formatUkDate(forecast.anchor!.date)}
                                </time>
                              </li>
                            ))}
                      </ul>
                      <p>
                        Usual variable spending: approximately{" "}
                        {money(Math.round(forecast.dailyVariable!), currency)}{" "}
                        per day. Bills use the last charge; repeating income
                        uses the lowest of the last three payments. Cancelled
                        subscriptions and transfers are excluded from future
                        payments. No repeating income detected means no income
                        is assumed.
                      </p>
                      <p>
                        The dashed lines change variable spending by 25%; they
                        are scenarios, not statistical confidence limits. New
                        purchases, irregular income, rate changes, taxes and
                        payment delays may change the result. Budgets do not
                        replace observed spending in this forecast.
                      </p>
                    </details>
                  </>
                )
              )}
            </section>
            <section className="card">
              <div className="section-heading">
                <h2>Upcoming payments</h2>
                <span className="muted">Next {horizon} days</span>
              </div>
              <p className="coverage-note">
                Expected dates and amounts from repeated imported transactions.
                These are estimates, not confirmed bills or payments.
              </p>
              {!forecast.upcoming.length ? (
                <p className="muted">
                  No supported recurring pattern found yet. Import more
                  statement history to identify recurring income and bills.
                </p>
              ) : (
                <ol className="payment-timeline">
                  {forecast.upcoming.map((p) => (
                    <li key={p.id}>
                      <Link
                        to={`/transactions?allDates=1&account=${p.accountId}&search=${encodeURIComponent(p.merchant)}`}
                      >
                        <div>
                          <strong>
                            {displayMerchant({
                              merchant: p.merchant,
                              description: p.merchant,
                            })}
                          </strong>
                          <span>
                            <time className="date-value" dateTime={p.date}>
                              {formatUkDate(p.date)}
                            </time>{" "}
                            · {accounts.get(p.accountId)} · {p.cadence}
                          </span>
                          <small>
                            {p.evidence} payment{p.evidence === 1 ? "" : "s"}{" "}
                            support{p.evidence === 1 ? "s" : ""} this estimate
                          </small>
                        </div>
                        <strong
                          className={
                            p.originalAmount < 0 ? "payment-out" : "payment-in"
                          }
                        >
                          {p.amount === undefined ? (
                            <>
                              Rate needed
                              <small>
                                {money(
                                  p.originalAmount,
                                  p.originalCurrency,
                                  true,
                                )}
                              </small>
                            </>
                          ) : (
                            money(p.amount, currency, true, forecast.converted)
                          )}
                        </strong>
                      </Link>
                    </li>
                  ))}
                </ol>
              )}
            </section>
            <ScenarioPanel currency={currency} points={forecast.points} />
          </div>
        )}
      </div>
    </>
  );
}
