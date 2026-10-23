import { reportingPeriodLabel } from "../domain/period";
import { CategoryAnalysisPicker } from "../components/CategoryAnalysisPicker";
import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceArea,
  ReferenceLine,
  Cell,
} from "recharts";
import { db } from "../storage/database";
import { categoryReport } from "../analytics/category-report";
import { monthLabel, formatUkDate, formatDateRange } from "../domain/dates";
import { localToday } from "../analytics/reminders";
import { shiftDate } from "../analytics/analysis-period";
import { displayMerchant } from "../domain/presentation";
import { compactMoney, money } from "../domain/money";
import { MonthPicker, Metric, RangeControl } from "../components/common";
import {
  chartTickFontSize,
  useRootFontSize,
} from "../components/useRootFontSize";
export default function CategoryPage({
  month,
  currency,
  setMonth,
}: {
  month: string;
  currency: string;
  setMonth: (value: string) => void;
}) {
  const { id = "uncategorized" } = useParams();
  const chartRem = useRootFontSize();
  const [params] = useSearchParams();
  const [selected, setSelected] = useState(
    /^\d{4}-(0[1-9]|1[0-2])$/.test(params.get("month") ?? "")
      ? params.get("month")!
      : month,
  );
  const [window, setWindow] = useState(6);
  const source = useLiveQuery(
    async () => ({
      transactions: await db.transactions.toArray(),
      categories: await db.categories.toArray(),
      accounts: await db.accounts.toArray(),
      statements: await db.statements.toArray(),
      settings: await db.settings.toArray(),
      rates: await db.fxRates.toArray(),
      proposals: await db.transferProposals.toArray(),
    }),
    [],
  );
  const data = source
    ? {
        ...source,
        settings: source.settings ?? [],
        rates: source.rates ?? [],
        proposals: source.proposals ?? [],
      }
    : undefined;
  if (!data) return <p role="status">Loading category overview…</p>;
  const category = data.categories.find((c) => c.id === id);
  if (!category && id !== "uncategorized")
    return (
      <section className="card">
        <h1>Category not found</h1>
        <Link to="/">Home</Link>
      </section>
    );
  const name = category?.name ?? "Uncategorised";
  const today = localToday();
  const {
    stats,
    series,
    coverage,
    financialCoverage,
    approximate,
    scopedAccounts,
    inferredScope,
  } = categoryReport({
    accounts: data.accounts,
    statements: data.statements,
    transactions: source!.transactions,
    categories: data.categories,
    categoryId: id,
    month: selected,
    currency,
    window,
    today,
    rates: data.rates,
    settings: data.settings,
    proposals: data.proposals,
  });
  const transactionUrl = (m: string) =>
    `/transactions?category=${encodeURIComponent(id)}&month=${m}`;
  const chooseMonth = (m: string) => {
    setSelected(m);
    setMonth(m);
  };
  const mean = stats.mean === undefined ? undefined : Math.round(stats.mean);
  const std = stats.std === undefined ? undefined : Math.round(stats.std);
  const partialBaseline = stats.baseline.some((point) => !point.complete);
  const isProperty = id === "property";
  const categoryColor = category?.color ?? "var(--chart-expense)";
  const gapHeight = Math.max(1, ...series.map((point) => point.amount ?? 0));
  return (
    <>
      <Link to="/" className="back-link">
        ← Home
      </Link>
      <div className="page-heading">
        <div>
          <h1>{name}</h1>
        </div>
      </div>
      <p className="muted">
        {reportingPeriodLabel(selected, data.settings, source!.transactions)}
      </p>
      <p className="coverage-note">
        Comparison accounts:{" "}
        {scopedAccounts
          .map(
            (account) =>
              `${account.displayName} (${account.maskedAccountIdentifier})`,
          )
          .join(", ") || "none yet"}
        .
        {inferredScope
          ? " The same category accounts are used in every month."
          : " With no category history, all statement accounts must support a verified zero."}
      </p>
      <div className="toolbar">
        <MonthPicker month={selected} onChange={chooseMonth} />
        <RangeControl
          value={window}
          onChange={setWindow}
          label="Trend and comparison history"
        />
      </div>
      <section className="card category-kpis">
        {stats.current.available || coverage.missingRates ? (
          <Metric
            label={
              stats.incomeCategory ? "Income this month" : "Spent this month"
            }
            value={stats.current.amount}
            currency={currency}
            approximate={approximate}
            partial={!coverage.complete}
            unavailable={coverage.missingRates ? "Rates needed" : undefined}
          />
        ) : (
          <div className="metric">
            <span>
              {stats.incomeCategory ? "Income this month" : "Spent this month"}
            </span>
            <strong>Not imported</strong>
            <small>
              {stats.incomeCategory
                ? "No income source imported"
                : "No statements for this month"}
            </small>
          </div>
        )}
        <div className="metric">
          <span>Monthly average</span>
          <strong>
            {mean === undefined ? "Unavailable" : money(mean, currency)}
          </strong>
          <small>
            {stats.baseline.length} recorded previous month
            {stats.baseline.length === 1 ? "" : "s"} out of {window}
          </small>
        </div>
        <div className="metric">
          <span>
            {stats.incomeCategory
              ? "Share of total income"
              : "Share of income spent"}
          </span>
          <strong>
            {financialCoverage.missingRates ||
            !financialCoverage.hasIncomeSource ||
            stats.current.incomePercent === undefined
              ? "Unavailable"
              : `${stats.current.incomePercent.toFixed(1)}%`}
          </strong>
          <small>
            {financialCoverage.missingRates
              ? "Exchange rates needed for recorded income"
              : !financialCoverage.hasIncomeSource
                ? "No income source imported"
                : stats.current.income > 0
                  ? `Of ${money(stats.current.income, currency)} recorded income`
                  : "No income recorded for this period"}
          </small>
        </div>
        <div className="metric">
          <span>Difference from average</span>
          <strong>
            {stats.difference === undefined
              ? "Unavailable"
              : money(Math.round(stats.difference), currency, true)}
          </strong>
          <small>
            {stats.change === undefined
              ? ""
              : `${stats.change >= 0 ? "+" : ""}${stats.change.toFixed(1)}%`}
            {stats.difference !== undefined && !coverage.complete
              ? " · Based on recorded totals"
              : ""}
          </small>
        </div>
      </section>
      <p className="coverage-note">
        <span className="date-value">{monthLabel(selected)}</span> ·{" "}
        {coverage.status}. Trend:{" "}
        <span className="date-value">
          {formatDateRange(
            series[0].coverage.start,
            shiftDate(series.at(-1)!.coverage.end, -1),
          )}
        </span>
        .
      </p>
      {coverage.missingRates > 0 && (
        <p className="notice warning" role="status">
          Some account currencies cannot be converted. Category totals are
          unavailable until{" "}
          <Link to="/settings#global-currency">exchange rates are added</Link>.
        </p>
      )}
      {approximate && (
        <p className="coverage-note">
          ≈ Converted using transaction-date exchange rates. Original amounts
          remain in each transaction.
        </p>
      )}
      {(partialBaseline || (stats.current.available && !coverage.complete)) && (
        <p className="coverage-note" role="status">
          Based on recorded transactions. Partial months are included in the
          average; totals may change when you import more statements.
        </p>
      )}
      {stats.aboveUsual && (
        <p className="notice warning">
          {stats.incomeCategory ? "Income" : "Spending"} is above its usual
          variation: more than one standard deviation above the historical
          average.
        </p>
      )}
      <CategoryAnalysisPicker month={selected} category={id} />
      {isProperty && (
        <section className="card">
          <h2>Property cash flow</h2>
          <div className="category-kpis">
            {financialCoverage.hasIncomeSource ? (
              <Metric
                label="Rent received"
                value={stats.property.income}
                currency={currency}
                approximate={approximate}
                partial={!financialCoverage.complete}
                unavailable={
                  financialCoverage.missingRates ? "Rates needed" : undefined
                }
              />
            ) : (
              <div className="metric">
                <span>Rent received</span>
                <strong>Not imported</strong>
              </div>
            )}
            {financialCoverage.hasData ? (
              <Metric
                label="Property costs"
                value={stats.property.expenses}
                currency={currency}
                approximate={approximate}
                partial={!financialCoverage.complete}
                unavailable={
                  financialCoverage.missingRates ? "Rates needed" : undefined
                }
              />
            ) : (
              <div className="metric">
                <span>Property costs</span>
                <strong>Not imported</strong>
              </div>
            )}
            {financialCoverage.hasIncomeSource ? (
              <Metric
                label="Net property cash flow"
                value={stats.property.net}
                currency={currency}
                approximate={approximate}
                partial={!financialCoverage.complete}
                unavailable={
                  financialCoverage.missingRates ? "Rates needed" : undefined
                }
              />
            ) : (
              <div className="metric">
                <span>Net property cash flow</span>
                <strong>Unavailable</strong>
              </div>
            )}
          </div>
          <Link to="/property">
            Year-to-date and annual property analysis →
          </Link>
        </section>
      )}
      <section className="card category-trend">
        {mean !== undefined && std !== undefined && (
          <p className="category-range">
            <strong>
              Average ± standard deviation:{" "}
              {money(Math.max(0, mean - std), currency)}–
              {money(mean + std, currency)}
            </strong>
            <br />
            <span className="muted">
              Standard deviation: {money(std, currency)}
            </span>
          </p>
        )}
        <h2>{stats.incomeCategory ? "Income" : "Spending"} over time</h2>
        <p className="muted">
          Tap a bar or month below to inspect its transactions. {window}{" "}
          previous month{window === 1 ? "" : "s"} and the selected month are
          shown.
          {std !== undefined
            ? " The shaded band is the recorded average ± one standard deviation, not a budget."
            : " The average uses recorded monthly totals, including partial months."}
        </p>
        <div
          role="img"
          aria-label={`${name} monthly trend with recorded average and variation`}
        >
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart
              data={series.map((point) => ({
                ...point,
                gap: point.amount === null ? gapHeight : null,
              }))}
              margin={{ top: 12, right: 8, left: 0, bottom: 0 }}
            >
              <defs>
                <pattern
                  id="category-no-statements"
                  width="8"
                  height="8"
                  patternUnits="userSpaceOnUse"
                >
                  <path
                    d="M-2 2L2-2M0 8L8 0M6 10L10 6"
                    stroke="var(--muted)"
                    strokeWidth="1"
                    opacity=".45"
                  />
                </pattern>
              </defs>
              <XAxis
                dataKey="month"
                tickFormatter={(m) => monthLabel(String(m)).slice(0, 3)}
                tick={{
                  fill: "var(--muted)",
                  fontSize: chartTickFontSize(chartRem),
                }}
                interval="preserveStartEnd"
                minTickGap={12}
              />
              <YAxis
                width={Math.max(60, Math.round(chartRem * 3.75))}
                tickFormatter={(v) => compactMoney(Number(v), currency)}
                tick={{
                  fill: "var(--muted)",
                  fontSize: chartTickFontSize(chartRem),
                }}
              />
              <Tooltip
                labelFormatter={(label) => monthLabel(String(label))}
                formatter={(v, label, entry) =>
                  label === "No statements"
                    ? [
                        String(
                          entry.payload?.unavailableReason ??
                            "No recorded category data",
                        ),
                        "",
                      ]
                    : money(Number(v), currency)
                }
                contentStyle={{
                  background: "var(--surface)",
                  border: "1px solid var(--line)",
                  color: "var(--ink)",
                }}
              />
              {stats.mean !== undefined && stats.std !== undefined && (
                <ReferenceArea
                  y1={Math.max(0, stats.mean - stats.std)}
                  y2={stats.mean + stats.std}
                  fill={categoryColor}
                  fillOpacity={0.12}
                  ifOverflow="extendDomain"
                />
              )}
              {stats.mean !== undefined && (
                <ReferenceLine
                  y={stats.mean}
                  stroke="var(--muted)"
                  strokeDasharray="5 4"
                  ifOverflow="extendDomain"
                />
              )}
              <Bar
                name="No statements"
                dataKey="gap"
                fill="url(#category-no-statements)"
                maxBarSize={28}
                isAnimationActive={false}
              />
              <Bar
                name={stats.incomeCategory ? "Income" : "Spending"}
                dataKey="amount"
                fill={categoryColor}
                maxBarSize={28}
                isAnimationActive={false}
                onClick={(_data, index) => {
                  const point = series[index];
                  if (point) location.hash = transactionUrl(point.month);
                }}
              >
                {series.map((point) => (
                  <Cell
                    key={point.month}
                    fillOpacity={point.coverage.complete ? 1 : 0.55}
                  />
                ))}
              </Bar>
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className="coverage-note">
          Faded bars are partial months and still count in the average. Hatched
          months are missing data and are skipped. A zero counts when recorded
          explicitly or supported by verified coverage.
        </p>
        <details className="category-comparison-months">
          <summary>
            Months used for comparison ({stats.baseline.length} of {window})
          </summary>
          <ul className="category-comparison-list">
            {series.slice(0, -1).map((point) => (
              <li key={point.month}>
                <strong>{monthLabel(point.month)}</strong>
                <span>
                  {point.available
                    ? `Included · ${money(point.amount!, currency)}`
                    : `Skipped · ${point.unavailableReason}`}
                  {point.available && !point.coverage.complete
                    ? " · Partial history"
                    : ""}
                </span>
                <small>
                  {formatDateRange(
                    point.coverage.start,
                    shiftDate(point.coverage.end, -1),
                  )}
                </small>
                {!point.coverage.complete &&
                  point.coverage.reasons.length > 0 && (
                    <details>
                      <summary>Coverage details</summary>
                      <ul>
                        {point.coverage.reasons.map((reason) => (
                          <li key={reason}>{reason}</li>
                        ))}
                      </ul>
                    </details>
                  )}
              </li>
            ))}
          </ul>
          <p className="muted">
            {monthLabel(selected)} is the selected month and is excluded from
            the historical average.
          </p>
        </details>
        <details>
          <summary>Average and standard deviation explained</summary>
          <p>
            Average:{" "}
            {mean === undefined
              ? "unavailable because no previous month has usable category data"
              : money(mean, currency)}
            . Sample standard deviation:{" "}
            {std === undefined
              ? `unavailable. Needs at least two recorded previous months; ${stats.baseline.length} currently available`
              : money(std, currency)}
            . Average = total of the included monthly category totals ÷ number
            of included months. Sample standard deviation measures their spread
            using n−1. Partial months count; months without a recorded total or
            verified zero are skipped. Missing currency conversions cannot be
            added together. Transfers and the selected month are excluded.
            Changing the month or history window recalculates both statistics.
          </p>
        </details>
        <details>
          <summary>View values</summary>
          <div className="category-months">
            {series.map((point) => (
              <Link to={transactionUrl(point.month)} key={point.month}>
                <span>
                  {monthLabel(point.month)}
                  {point.coverage.status !== "Complete"
                    ? ` · ${point.coverage.status.toLowerCase()}`
                    : ""}
                </span>
                <strong>
                  {point.amount === null
                    ? point.unavailableReason
                    : money(point.amount, currency)}
                </strong>
                <small>
                  {!point.incomeCoverage.hasIncomeSource ||
                  point.incomeCoverage.missingRates > 0 ||
                  point.incomePercent === undefined
                    ? "Income share unavailable"
                    : `${point.incomePercent.toFixed(1)}% of income`}
                </small>
              </Link>
            ))}
          </div>
        </details>
      </section>
      {stats.children.length > 0 && (
        <section className="card">
          <h2>Subcategories</h2>
          {stats.children
            .filter((c) => c.amount !== 0)
            .map((c) => (
              <Link
                key={c.id}
                className="subscription-evidence"
                to={`/categories/${c.id}?month=${selected}`}
              >
                <span>{c.name}</span>
                <strong>{money(c.amount, currency)}</strong>
              </Link>
            ))}
          {stats.children.some((c) => c.amount === 0) && (
            <details>
              <summary>Show all subcategories</summary>
              {stats.children
                .filter((c) => c.amount === 0)
                .map((c) => (
                  <Link
                    key={c.id}
                    className="subscription-evidence"
                    to={`/categories/${c.id}?month=${selected}`}
                  >
                    <span>{c.name}</span>
                    <strong>{money(c.amount, currency)}</strong>
                  </Link>
                ))}
            </details>
          )}
        </section>
      )}
      <section className="card">
        <div className="section-heading">
          <h2>Transactions</h2>
          <Link to={transactionUrl(selected)}>View all transactions</Link>
        </div>
        {stats.transactions.length ? (
          stats.transactions
            .slice()
            .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
            .slice(0, 10)
            .map((t) => (
              <Link
                className="subscription-evidence"
                key={t.id}
                to={`/transactions/${t.id}`}
              >
                <span>
                  {displayMerchant(t)}
                  <small className="muted">
                    <time className="date-value" dateTime={t.date}>
                      {formatUkDate(t.date)}
                    </time>
                  </small>
                </span>
                <strong>{money(t.amount, currency, true)}</strong>
              </Link>
            ))
        ) : (
          <p>No transactions for this category and month.</p>
        )}
      </section>
    </>
  );
}
