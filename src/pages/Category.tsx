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
} from "recharts";
import { db } from "../storage/database";
import { categoryOverview } from "../analytics/category";
import { monthBounds, monthOffset, monthLabel } from "../domain/dates";
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
  const data = useLiveQuery(
    async () => ({
      transactions: await db.transactions
        .where("[currency+date]")
        .between(
          [currency, monthBounds(monthOffset(selected, -12))[0]],
          [currency, monthBounds(selected)[1]],
          true,
          false,
        )
        .toArray(),
      categories: await db.categories.toArray(),
      accounts: await db.accounts.where("currency").equals(currency).toArray(),
      statements: await db.statements.toArray(),
    }),
    [selected, currency],
  );
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
  const stats = categoryOverview(
    data.transactions,
    data.accounts,
    data.statements,
    data.categories,
    id,
    selected,
    currency,
    window,
  );
  const transactionUrl = (m: string) =>
    `/transactions?category=${encodeURIComponent(id)}&month=${m}`;
  const chooseMonth = (m: string) => {
    setSelected(m);
    setMonth(m);
  };
  const mean = stats.mean === undefined ? undefined : Math.round(stats.mean);
  const std = stats.std === undefined ? undefined : Math.round(stats.std);
  const isProperty = id === "property";
  return (
    <>
      <Link to="/" className="back-link">
        ← Overview
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
          aria-label="Comparison history"
        >
          {[6, 12].map((n) => (
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
      {!stats.current.complete && (
        <p className="notice warning">
          Partial or unverified month coverage. These are recorded amounts so
          far, not a full-month overspending assessment.
        </p>
      )}
      <section className="card category-kpis">
        <Metric
          label={
            stats.incomeCategory ? "Income this month" : "Spent this month"
          }
          value={stats.current.amount}
          currency={currency}
        />
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
            {stats.current.incomePercent === undefined
              ? "Unavailable"
              : `${stats.current.incomePercent.toFixed(1)}%`}
          </strong>
          <small>
            {stats.current.income > 0
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
            {!stats.current.complete ? " · month incomplete" : ""}
          </small>
        </div>
      </section>
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
            <Metric
              label="Rent received"
              value={stats.property.income}
              currency={currency}
            />
            <Metric
              label="Property costs"
              value={stats.property.expenses}
              currency={currency}
            />
            <Metric
              label="Net property cash flow"
              value={stats.property.net}
              currency={currency}
            />
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
              data={stats.series}
              margin={{ top: 12, right: 8, left: 0, bottom: 0 }}
            >
              <XAxis
                dataKey="month"
                tickFormatter={(m) => monthLabel(String(m)).split(" ")[0]}
                tick={{ fill: "var(--muted)", fontSize: 12 }}
              />
              <YAxis
                tickFormatter={(v) =>
                  String(
                    Math.round(Number(v) / 10 ** currencyPrecision(currency)),
                  )
                }
                tick={{ fill: "var(--muted)", fontSize: 12 }}
              />
              <Tooltip
                formatter={(v) => money(Number(v), currency)}
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
                  fill="var(--accent)"
                  fillOpacity={0.12}
                  ifOverflow="extendDomain"
                />
              )}
              {stats.mean !== undefined && (
                <ReferenceLine
                  y={stats.mean}
                  stroke="var(--accent)"
                  strokeDasharray="5 4"
                  ifOverflow="extendDomain"
                />
              )}
              <Bar
                name={stats.incomeCategory ? "Income" : "Spending"}
                dataKey="amount"
                fill="var(--accent)"
                maxBarSize={28}
                isAnimationActive={false}
                onClick={(_data, index) => {
                  const point = stats.series[index];
                  if (point) location.hash = transactionUrl(point.month);
                }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
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
          {stats.series.map((point) => (
            <Link to={transactionUrl(point.month)} key={point.month}>
              <span>
                {monthLabel(point.month)}
                {!point.complete ? " · partial" : ""}
              </span>
              <strong>{money(point.amount, currency)}</strong>
              <small>
                {point.incomePercent === undefined
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
                  {t.merchant}
                  <small className="muted"> · {t.date}</small>
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
