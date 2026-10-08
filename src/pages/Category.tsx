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
import { categoryOverview } from "../analytics/category";
import {
  monthBounds,
  monthOffset,
  monthLabel,
  formatUkDate,
  formatDateRange,
} from "../domain/dates";
import { monthCoverage, verifiedStatements } from "../analytics/coverage";
import { localToday } from "../analytics/reminders";
import { shiftDate } from "../analytics/analysis-period";
import { displayMerchant } from "../domain/presentation";
import { money, currencyPrecision } from "../domain/money";
import { MonthPicker, Metric } from "../components/common";
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
  const [params] = useSearchParams();
  const [selected, setSelected] = useState(
    /^\d{4}-(0[1-9]|1[0-2])$/.test(params.get("month") ?? "")
      ? params.get("month")!
      : month,
  );
  const [window, setWindow] = useState(6);
  const data = useLiveQuery(async () => {
    const [categories, accounts, statements] = await Promise.all([
      db.categories.toArray(),
      db.accounts.where("currency").equals(currency).toArray(),
      db.statements.toArray(),
    ]);
    const start = monthBounds(monthOffset(selected, -12))[0];
    const end = monthBounds(selected)[1];
    const documents = statements.filter(
      (s) =>
        s.currency === currency &&
        s.statementPeriodStart < end &&
        s.statementPeriodEnd >= start,
    );
    const readStart = [
      start,
      ...documents.map((s) => s.statementPeriodStart),
    ].sort()[0];
    const readEnd = [
      end,
      ...documents.map((s) => shiftDate(s.statementPeriodEnd, 1)),
    ]
      .sort()
      .at(-1)!;
    const transactions = await db.transactions
      .where("[currency+date]")
      .between([currency, readStart], [currency, readEnd], true, false)
      .toArray();
    return { transactions, categories, accounts, statements };
  }, [selected, currency]);
  if (!data) return <p role="status">Loading category overview…</p>;
  const category = data.categories.find((c) => c.id === id);
  if (!category && id !== "uncategorized")
    return (
      <section className="card">
        <h1>Category not found</h1>
        <Link to="/">Home</Link>
      </section>
    );
  const name = category?.name ?? "Uncategorized";
  const today = localToday();
  const documents = verifiedStatements(
    data.statements,
    data.transactions,
    today,
  );
  const coverage = monthCoverage(
    data.accounts,
    data.statements,
    data.transactions,
    selected,
    currency,
    today,
  );
  const stats = categoryOverview(
    data.transactions,
    data.accounts,
    documents,
    data.categories,
    id,
    selected,
    currency,
    window,
    today,
    (m) => {
      const eligible = monthCoverage(
        data.accounts,
        data.statements,
        data.transactions,
        m,
        currency,
        today,
      );
      return (
        eligible.complete &&
        (category?.kind !== "income" || eligible.hasIncomeSource)
      );
    },
  );
  const series = stats.series.slice(-window).map((point) => {
    const covered = monthCoverage(
      data.accounts,
      data.statements,
      data.transactions,
      point.month,
      currency,
      today,
    );
    return {
      ...point,
      amount:
        covered.status === "No data" ||
        covered.status === "Unverified" ||
        (stats.incomeCategory && !covered.hasIncomeSource)
          ? null
          : point.amount,
      unavailableReason:
        stats.incomeCategory && !covered.hasIncomeSource
          ? "No income source imported"
          : "No verified statements",
      coverage: covered,
    };
  });
  const transactionUrl = (m: string) =>
    `/transactions?category=${encodeURIComponent(id)}&month=${m}`;
  const chooseMonth = (m: string) => {
    setSelected(m);
    setMonth(m);
  };
  const mean = stats.mean === undefined ? undefined : Math.round(stats.mean);
  const std = stats.std === undefined ? undefined : Math.round(stats.std);
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
          <p className="eyebrow">CATEGORY OVERVIEW</p>
          <h1>{name}</h1>
        </div>
      </div>
      <CategoryAnalysisPicker month={selected} category={id} />
      <div className="toolbar">
        <MonthPicker month={selected} onChange={chooseMonth} />
        <div
          className="theme-options"
          role="group"
          aria-label="Trend and comparison history"
        >
          {[1, 3, 6, 12].map((n) => (
            <button
              key={n}
              aria-pressed={window === n}
              onClick={() => setWindow(n)}
            >
              {n} months
            </button>
          ))}
        </div>
      </div>
      <p className="coverage-note">
        {monthLabel(selected)} · {coverage.status}. Trend:{" "}
        {formatDateRange(
          `${monthOffset(selected, 1 - window)}-01`,
          shiftDate(monthBounds(selected)[1], -1),
        )}
        .
      </p>
      <section className="card category-kpis">
        {coverage.hasData &&
        (!stats.incomeCategory || coverage.hasIncomeSource) ? (
          <Metric
            label={
              stats.incomeCategory ? "Income this month" : "Spent this month"
            }
            value={stats.current.amount}
            currency={currency}
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
            {stats.baseline.length} complete months in previous {window}
          </small>
        </div>
        <div className="metric">
          <span>
            {stats.incomeCategory
              ? "Share of total income"
              : "Share of income spent"}
          </span>
          <strong>
            {!coverage.hasIncomeSource ||
            stats.current.incomePercent === undefined
              ? "Unavailable"
              : `${stats.current.incomePercent.toFixed(1)}%`}
          </strong>
          <small>
            {!coverage.hasIncomeSource
              ? "No income source imported"
              : stats.current.income > 0
                ? `Of ${money(stats.current.income, currency)} recorded income`
                : "No income recorded for this period"}
          </small>
        </div>
        <div className="metric">
          <span>Difference from average</span>
          <strong>
            {!coverage.complete || stats.difference === undefined
              ? "Unavailable"
              : money(Math.round(stats.difference), currency, true)}
          </strong>
          <small>
            {!coverage.complete || stats.change === undefined
              ? ""
              : `${stats.change >= 0 ? "+" : ""}${stats.change.toFixed(1)}%`}
            {!coverage.complete ? "Month incomplete; comparison withheld" : ""}
          </small>
        </div>
      </section>
      {coverage.hasUnverifiedStatements && (
        <p className="notice warning" role="status">
          Unverified statement amounts are included in recorded totals;
          comparisons with usual spending are withheld for this month.
        </p>
      )}
      {stats.aboveUsual && (
        <p className="notice warning">
          {stats.incomeCategory ? "Income" : "Spending"} is above its usual
          variation: more than one standard deviation above the historical
          average.
        </p>
      )}
      {isProperty && (
        <section className="card">
          <h2>Property cash flow</h2>
          <div className="category-kpis">
            {coverage.hasIncomeSource ? (
              <Metric
                label="Rent received"
                value={stats.property.income}
                currency={currency}
              />
            ) : (
              <div className="metric">
                <span>Rent received</span>
                <strong>Not imported</strong>
              </div>
            )}
            {coverage.hasData ? (
              <Metric
                label="Property costs"
                value={stats.property.expenses}
                currency={currency}
              />
            ) : (
              <div className="metric">
                <span>Property costs</span>
                <strong>Not imported</strong>
              </div>
            )}
            {coverage.hasIncomeSource ? (
              <Metric
                label="Net property cash flow"
                value={stats.property.net}
                currency={currency}
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
              Usual range: {money(Math.max(0, mean - std), currency)}–
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
          Tap a bar or month below to inspect its transactions. The shaded band
          shows usual variation; it is not a budget.
        </p>
        <div
          role="img"
          aria-label={`${name} monthly trend with average and usual variation`}
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
                tickFormatter={(m) => monthLabel(String(m)).split(" ")[0]}
                tick={{ fill: "var(--muted)", fontSize: 13 }}
                interval={window > 6 ? 1 : 0}
              />
              <YAxis
                tickFormatter={(v) =>
                  String(
                    Math.round(Number(v) / 10 ** currencyPrecision(currency)),
                  )
                }
                tick={{ fill: "var(--muted)", fontSize: 13 }}
              />
              <Tooltip
                labelFormatter={(label) => monthLabel(String(label))}
                formatter={(v, label, entry) =>
                  label === "No statements"
                    ? [
                        String(
                          entry.payload?.unavailableReason ??
                            "No verified statements",
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
                    fillOpacity={point.coverage.status === "Partial" ? 0.55 : 1}
                  />
                ))}
              </Bar>
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className="coverage-note">
          Hatched months have no verified statements; faded bars are partial.
          Zero is shown only when verified coverage supports it.
        </p>
        <details>
          <summary>Average and standard deviation explained</summary>
          <p>
            Average:{" "}
            {mean === undefined ? "unavailable" : money(mean, currency)}. Sample
            standard deviation:{" "}
            {std === undefined
              ? "unavailable — needs at least three complete months"
              : money(std, currency)}
            . The baseline excludes this month, missing coverage, and accounts
            with mismatched currency. A verified month with no category spending
            counts as zero. Transfers are excluded. Past variation does not
            predict a spending limit.
          </p>
        </details>
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
                {!point.coverage.hasIncomeSource ||
                point.incomePercent === undefined
                  ? "Income share unavailable"
                  : `${point.incomePercent.toFixed(1)}% of income`}
              </small>
            </Link>
          ))}
        </div>
      </section>
      {stats.children.length > 0 && (
        <section className="card">
          <h2>Subcategories</h2>
          {stats.children.map((c) => (
            <Link
              key={c.id}
              className="subscription-evidence"
              to={`/categories/${c.id}?month=${selected}`}
            >
              <span>{c.name}</span>
              <strong>{money(c.amount, currency)}</strong>
            </Link>
          ))}
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
                  <small className="muted"> · {formatUkDate(t.date)}</small>
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
