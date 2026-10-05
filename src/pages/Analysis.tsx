import { useState } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../storage/database";
import { monthBounds, monthOffset, monthLabel } from "../domain/dates";
import {
  cashFlow,
  categorySpending,
  propertyFlow,
  monthlySeries,
  comparisons,
  comparableMonths,
  recurring,
} from "../analytics/calculations";
import { money } from "../domain/money";
import { MonthPicker, Metric } from "../components/common";
import { CashChart } from "../components/Chart";
const shiftDate = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000)
    .toISOString()
    .slice(0, 10);
export default function Analysis({
  month,
  setMonth,
  currency,
  property = false,
}: {
  month: string;
  setMonth: (s: string) => void;
  currency: string;
  property?: boolean;
}) {
  const [period, setPeriod] = useState(property ? "ytd" : "6");
  const [customFrom, setCustomFrom] = useState(monthBounds(month)[0]);
  const [customTo, setCustomTo] = useState(
    shiftDate(monthBounds(month)[1], -1),
  );
  const start =
    period === "custom"
      ? customFrom
      : period === "ytd"
        ? `${month.slice(0, 4)}-01-01`
        : period === "annual"
          ? `${month.slice(0, 4)}-01-01`
          : monthBounds(monthOffset(month, 1 - Number(period)))[0];
  const end =
    period === "custom"
      ? customTo
        ? shiftDate(customTo, 1)
        : ""
      : period === "annual"
        ? `${Number(month.slice(0, 4)) + 1}-01-01`
        : monthBounds(month)[1];
  const data = useLiveQuery(
    async () => ({
      items:
        !start || !end || start >= end
          ? []
          : await db.transactions
              .where("[currency+date]")
              .between([currency, start], [currency, end], true, false)
              .toArray(),
      comparison: await db.transactions
        .where("[currency+date]")
        .between(
          [currency, monthBounds(monthOffset(month, -12))[0]],
          [currency, monthBounds(month)[1]],
          true,
          false,
        )
        .toArray(),
      categories: await db.categories.toArray(),
    }),
    [start, end, currency, month],
  );
  if (!data) return <p>Loading analysis…</p>;
  const relevant = property
    ? data.items.filter(
        (t) =>
          t.categoryId === "property" || t.categoryId === "property-income",
      )
    : data.items;
  const flow = property
    ? propertyFlow(data.items, currency)
    : cashFlow(data.items, currency);
  const spending = categorySpending(relevant, data.categories, currency);
  const insights = comparisons(
    data.comparison,
    data.categories,
    month,
    currency,
  );
  const regular = recurring(data.comparison, currency);
  const previous = cashFlow(
    data.comparison.filter((t) => t.date.startsWith(monthOffset(month, -1))),
    currency,
  );
  const current = cashFlow(
    data.comparison.filter((t) => t.date.startsWith(month)),
    currency,
  );
  const rolling = cashFlow(
    data.comparison.filter(
      (t) => t.date >= monthBounds(monthOffset(month, -11))[0],
    ),
    currency,
  );
  const largest = [...relevant]
    .filter((t) => !t.isTransfer && t.amount < 0)
    .sort((a, b) => a.amount - b.amount)
    .slice(0, 5);
  const subcategories = property
    ? data.categories
        .filter((c) => c.parentId === "property")
        .map((c) => ({
          ...c,
          amount: -data.items
            .filter(
              (t) =>
                !t.isTransfer &&
                t.amount < 0 &&
                t.categoryId === "property" &&
                t.subcategoryId === c.id,
            )
            .reduce((s, t) => s + t.amount, 0),
        }))
        .filter((c) => c.amount)
    : [];
  return (
    <>
      {property && (
        <Link className="back-link" to="/analysis">
          ← Analyse
        </Link>
      )}
      <div className="page-heading">
        <div>
          <p className="eyebrow">
            {property ? "RENT, COSTS & CASH FLOW" : "PUT YOUR MONTH IN CONTEXT"}
          </p>
          <h1>{property ? "Property" : "Analyse"}</h1>
        </div>
        {!property && (
          <Link className="button" to="/property">
            Property analysis
          </Link>
        )}
      </div>
      <div className="toolbar">
        <MonthPicker month={month} onChange={setMonth} />
        <label className="period-label">
          Period
          <select value={period} onChange={(e) => setPeriod(e.target.value)}>
            {["1", "3", "6", "12", "ytd", "annual", "custom"].map((v) => (
              <option key={v} value={v}>
                {v === "ytd"
                  ? "Year to date"
                  : v === "annual"
                    ? "Calendar year"
                    : v === "custom"
                      ? "Custom period"
                      : `${v} month${v === "1" ? "" : "s"}`}
              </option>
            ))}
          </select>
        </label>
      </div>
      {period === "custom" && (
        <div className="card form-grid">
          <label>
            From
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
            />
          </label>
          <label>
            To
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
            />
          </label>
        </div>
      )}
      <p className="muted">
        {start && end && start < end
          ? `${start} to ${shiftDate(end, -1)}`
          : "Choose a valid date range"}{" "}
        · {currency} · transfers excluded
      </p>
      <section className="card metric-strip">
        <Metric
          label={property ? "Rental income" : "Income"}
          value={flow.income}
          currency={currency}
        />
        <Metric
          label={property ? "Property costs" : "Expenses"}
          value={flow.expenses}
          currency={currency}
        />
        <Metric
          label={property ? "Net property cash flow" : "Net cash flow"}
          value={flow.net}
          currency={currency}
        />
      </section>
      <section className="card">
        <div className="section-heading">
          <h2>
            {property
              ? "Monthly property cash flow"
              : "Income, expenses & net cash flow"}
          </h2>
          <span className="muted">12 months to {monthLabel(month)}</span>
        </div>
        <CashChart
          data={monthlySeries(data.comparison, month, 12, currency)}
          currency={currency}
          property={property}
        />
      </section>
      <div className="content-grid">
        <section className="card">
          <h2>{property ? "Property costs" : "Category spending"}</h2>
          {property ? (
            <dl className="totals">
              {subcategories.map((c) => (
                <div key={c.id}>
                  <dt>
                    <Link to={`/transactions?category=${c.id}&month=${month}`}>
                      {c.name}
                    </Link>
                  </dt>
                  <dd>{money(c.amount, currency)}</dd>
                </div>
              ))}
              <div>
                <dt>Unspecified property cost</dt>
                <dd>
                  {money(
                    -data.items
                      .filter(
                        (t) =>
                          t.categoryId === "property" &&
                          !t.subcategoryId &&
                          !t.isTransfer &&
                          t.amount < 0,
                      )
                      .reduce((s, t) => s + t.amount, 0),
                    currency,
                  )}
                </dd>
              </div>
            </dl>
          ) : (
            spending.map((c) => (
              <Link
                key={c.id}
                className="category-row"
                to={`/transactions?category=${c.id}&month=${month}`}
              >
                <div className="category-meta">
                  <span>{c.name}</span>
                  <strong>{money(c.amount, currency)}</strong>
                </div>
                <div className="bar-track">
                  <div
                    style={{ width: `${c.percent}%`, background: c.color }}
                  />
                </div>
              </Link>
            ))
          )}
          {!spending.length && (
            <p className="muted">No costs in this period.</p>
          )}
        </section>
        <section className="card">
          <h2>Largest expenses</h2>
          {largest.map((t) => (
            <Link
              key={t.id}
              to={`/transactions/${t.id}`}
              className="insight-row"
            >
              <span>
                {t.merchant}
                <small>{t.date}</small>
              </span>
              <strong>{money(t.amount, currency)}</strong>
            </Link>
          ))}
          {!largest.length && (
            <p className="muted">No expenses in this period.</p>
          )}
        </section>
      </div>
      {!property && (
        <>
          <section className="card">
            <h2>Month-over-month · {monthLabel(month)}</h2>
            <dl className="totals">
              {comparableMonths(
                data.comparison,
                month,
                monthOffset(month, -1),
                currency,
              ) && (
                <>
                  <div>
                    <dt>Income change</dt>
                    <dd>
                      {money(current.income - previous.income, currency, true)}
                    </dd>
                  </div>
                  <div>
                    <dt>Expense change</dt>
                    <dd>
                      {money(
                        current.expenses - previous.expenses,
                        currency,
                        true,
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Net cash flow change</dt>
                    <dd>{money(current.net - previous.net, currency, true)}</dd>
                  </div>
                </>
              )}
              <div>
                <dt>Average expenses · comparable previous months</dt>
                <dd>
                  {insights.sampleMonths
                    ? money(insights.average, currency)
                    : "Not enough history"}
                </dd>
              </div>
              <div>
                <dt>12-month income</dt>
                <dd>{money(rolling.income, currency)}</dd>
              </div>
              <div>
                <dt>12-month expenses</dt>
                <dd>{money(rolling.expenses, currency)}</dd>
              </div>
              <div>
                <dt>12-month net cash flow</dt>
                <dd>{money(rolling.net, currency, true)}</dd>
              </div>
            </dl>
            <p>{insights.text}</p>
          </section>
          <section className="card">
            <h2>Category trends</h2>
            <p className="muted">
              Monthly expenses across the last six months. Tap a value to
              inspect it.
            </p>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Category</th>
                    {Array.from({ length: 6 }, (_, i) =>
                      monthOffset(month, i - 5),
                    ).map((m) => (
                      <th key={m}>{m}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {spending.map((c) => (
                    <tr key={c.id}>
                      <th>{c.name}</th>
                      {Array.from({ length: 6 }, (_, i) =>
                        monthOffset(month, i - 5),
                      ).map((m) => (
                        <td key={m}>
                          <Link
                            to={`/transactions?category=${c.id}&month=${m}`}
                          >
                            {money(
                              categorySpending(
                                data.comparison.filter((t) =>
                                  t.date.startsWith(m),
                                ),
                                data.categories,
                                currency,
                              ).find((x) => x.id === c.id)?.amount ?? 0,
                              currency,
                            )}
                          </Link>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="card">
            <h2>Potential recurring costs</h2>
            <p className="muted">
              At least three payments, approximately a month apart, with similar
              amounts. These are suggestions for review.
            </p>
            {regular.map((r) => (
              <div key={r.merchant} className="insight-row">
                <span>
                  {r.merchant}
                  <small>
                    {r.occurrences} payments · last {r.lastDate}
                  </small>
                </span>
                <strong>{money(r.amount, currency)} / month</strong>
              </div>
            ))}
            {!regular.length && <p>No recurring pattern found yet.</p>}
          </section>
        </>
      )}
    </>
  );
}
