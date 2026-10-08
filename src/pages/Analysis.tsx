import { CategoryAnalysisPicker } from "../components/CategoryAnalysisPicker";
import { DeeperInsights } from "../components/DeeperInsights";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../storage/database";
import {
  monthBounds,
  monthOffset,
  monthLabel,
  formatUkDate,
  formatDateRange,
} from "../domain/dates";
import {
  cashFlow,
  categorySpending,
  propertyFlow,
  recurring,
} from "../analytics/calculations";
import {
  analysisPeriod,
  monthsInRange,
  shiftDate,
} from "../analytics/analysis-period";
import { coverageMonthlySeries, monthCoverage } from "../analytics/coverage";
import { localToday } from "../analytics/reminders";
import { financialType } from "../domain/transaction-type";
import { displayMerchant } from "../domain/presentation";
import { money } from "../domain/money";
import { MonthPicker, Metric } from "../components/common";
import { CashChart } from "../components/Chart";
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
  const scope = analysisPeriod(month, period, customFrom, customTo);
  const { start, end } = scope;
  const today = localToday();
  const data = useLiveQuery(async () => {
    const [categories, accounts, statements] = await Promise.all([
      db.categories.toArray(),
      db.accounts.where("currency").equals(currency).toArray(),
      db.statements.toArray(),
    ]);
    const historyStart = [
      scope.previousStart || start || `${month}-01`,
      monthBounds(monthOffset(month, -12))[0],
    ].sort()[0];
    const historyEnd = end || monthBounds(month)[1];
    // Read complete source statements even when a selected range cuts through
    // a card statement, so the reconciliation check still has every row.
    const documents = statements.filter(
      (statement) =>
        statement.currency === currency &&
        statement.statementPeriodEnd >= historyStart &&
        statement.statementPeriodStart < historyEnd,
    );
    const readStart = [
      historyStart,
      ...documents.map((statement) => statement.statementPeriodStart),
    ].sort()[0];
    const readEnd = [
      historyEnd,
      ...documents.map((statement) =>
        shiftDate(statement.statementPeriodEnd, 1),
      ),
    ]
      .sort()
      .at(-1)!;
    const transactions = await db.transactions
      .where("[currency+date]")
      .between([currency, readStart], [currency, readEnd], true, false)
      .toArray();
    return {
      items: scope.valid
        ? transactions.filter(
            (transaction) =>
              transaction.date >= start && transaction.date < end,
          )
        : [],
      transactions,
      categories,
      accounts,
      statements,
    };
  }, [start, end, scope.previousStart, currency, month]);
  if (!data) return <p>Loading analysis…</p>;
  const selectedItems = scope.valid
    ? data.transactions.filter(
        (transaction) => transaction.date >= start && transaction.date < end,
      )
    : [];
  const relevant = property
    ? selectedItems.filter(
        (t) =>
          t.categoryId === "property" || t.categoryId === "property-income",
      )
    : selectedItems;
  const flow = property
    ? propertyFlow(selectedItems, currency)
    : cashFlow(selectedItems, currency);
  const spending = categorySpending(relevant, data.categories, currency);
  const coverage = scope.months.map((m) => {
    const covered = monthCoverage(
      data.accounts,
      data.statements,
      data.transactions,
      m,
      currency,
      today,
    );
    const rangeStart = [start, `${m}-01`].sort().at(-1)!;
    const rangeEnd = [end, monthBounds(m)[1]].sort()[0];
    const intersects = (statement: (typeof data.statements)[number]) =>
      statement.currency === currency &&
      data.accounts.some((account) => account.id === statement.accountId) &&
      statement.statementPeriodStart < rangeEnd &&
      statement.statementPeriodEnd >= rangeStart;
    const documents = data.statements.filter(intersects);
    const verified = covered.verifiedStatements.filter(intersects);
    const rangeRows = selectedItems.filter(
      (transaction) =>
        transaction.date >= rangeStart && transaction.date < rangeEnd,
    );
    const verifiedIds = new Set(verified.map((statement) => statement.id));
    const hasData = documents.length > 0 || rangeRows.length > 0;
    const hasUnverifiedStatements =
      documents.some((statement) => !verifiedIds.has(statement.id)) ||
      rangeRows.some(
        (transaction) => !verifiedIds.has(transaction.statementId),
      );
    return {
      ...covered,
      hasData,
      hasUnverifiedStatements,
      verifiedStatements: verified,
      covered: new Set(verified.map((statement) => statement.accountId)).size,
      hasIncomeSource: verified.some((statement) =>
        data.accounts.some(
          (account) =>
            account.id === statement.accountId &&
            account.accountType !== "credit",
        ),
      ),
      status: covered.complete
        ? ("Complete" as const)
        : verified.length
          ? ("Partial" as const)
          : hasData
            ? ("Unverified" as const)
            : ("No data" as const),
    };
  });
  const hasIncomeSource = coverage.some((c) => c.hasIncomeSource);
  const complete = coverage.length > 0 && coverage.every((c) => c.complete);
  const previousCoverage = monthsInRange(
    scope.previousStart,
    scope.previousEnd,
  ).map((m) =>
    monthCoverage(
      data.accounts,
      data.statements,
      data.transactions,
      m,
      currency,
      today,
    ),
  );
  const comparable =
    complete &&
    previousCoverage.length > 0 &&
    previousCoverage.every((c) => c.complete);
  const previous = cashFlow(
    data.transactions.filter(
      (t) => t.date >= scope.previousStart && t.date < scope.previousEnd,
    ),
    currency,
  );
  const regular = recurring(relevant, currency);
  const series = scope.months.length
    ? coverageMonthlySeries(
        data.transactions,
        data.accounts,
        data.statements,
        scope.months.at(-1)!,
        scope.months.length,
        currency,
        today,
      ).map((point) => {
        const covered = coverage[scope.months.indexOf(point.month)];
        const usable =
          covered.status === "Complete" || covered.status === "Partial";
        const clipped =
          `${point.month}-01` < start || monthBounds(point.month)[1] > end;
        const rows = selectedItems.filter((transaction) =>
          transaction.date.startsWith(point.month),
        );
        const amounts = cashFlow(rows, currency);
        return {
          ...point,
          coverage: {
            ...covered,
            complete: covered.complete && !clipped,
            status:
              covered.status === "Complete" && clipped
                ? ("Partial" as const)
                : covered.status,
          },
          income: usable && covered.hasIncomeSource ? amounts.income : null,
          expenses: usable ? amounts.expenses : null,
          net: usable && covered.hasIncomeSource ? amounts.net : null,
          property: usable ? propertyFlow(rows, currency).net : null,
        };
      })
    : [];
  const fullMonths = scope.months.filter(
    (m) => `${m}-01` >= start && monthBounds(m)[1] <= end,
  );
  const verifiedSeries = series.filter(
    (point) => point.coverage.complete && fullMonths.includes(point.month),
  );
  const average = verifiedSeries.length
    ? verifiedSeries.reduce((sum, point) => sum + (point.expenses ?? 0), 0) /
      verifiedSeries.length
    : undefined;
  const largest = [...relevant]
    .filter((t) => financialType(t) !== "transfer" && t.amount < 0)
    .sort((a, b) => a.amount - b.amount)
    .slice(0, 5);
  const subcategories = property
    ? data.categories
        .filter((c) => c.parentId === "property")
        .map((c) => ({
          ...c,
          amount: -selectedItems
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
          <Link to="/planning" className="button">
            Planning
          </Link>
        )}
      </div>
      {!property && <CategoryAnalysisPicker month={month} />}
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
        {scope.valid
          ? formatDateRange(start, shiftDate(end, -1))
          : "Choose a valid date range"}
        {scope.valid &&
          ` · ${complete ? "Complete" : coverage.some((c) => c.hasData) ? "Partial or unverified" : "No data"}`}
        {" · transfers excluded"}
      </p>
      <section className="card metric-strip">
        {hasIncomeSource ? (
          <Metric
            label={property ? "Rental income" : "Income"}
            value={flow.income}
            currency={currency}
          />
        ) : (
          <div className="metric">
            <span>{property ? "Rental income" : "Income"}</span>
            <strong>Not imported</strong>
            <small>No income source imported</small>
          </div>
        )}
        {coverage.some((c) => c.hasData) ? (
          <Metric
            label={property ? "Property costs" : "Expenses"}
            value={flow.expenses}
            currency={currency}
          />
        ) : (
          <div className="metric">
            <span>{property ? "Property costs" : "Expenses"}</span>
            <strong>Not imported</strong>
          </div>
        )}
        {hasIncomeSource ? (
          <Metric
            label={property ? "Net property cash flow" : "Net cash flow"}
            value={flow.net}
            currency={currency}
          />
        ) : (
          <div className="metric">
            <span>{property ? "Net property cash flow" : "Net cash flow"}</span>
            <strong>Unavailable</strong>
          </div>
        )}
      </section>
      {!complete && coverage.some((c) => c.hasData) && (
        <p className="coverage-note">
          Amounts from imported accounts only; coverage is incomplete.
        </p>
      )}
      {coverage.some((c) => c.hasUnverifiedStatements) && (
        <p className="notice warning" role="status">
          Statements with incomplete date or balance verification are included
          in these recorded totals. Balances or extracted rows could not be
          confirmed; verified comparisons are withheld.
        </p>
      )}
      {!property && (
        <DeeperInsights
          transactions={data.transactions}
          accounts={data.accounts}
          statements={data.statements}
          categories={data.categories}
          month={month}
          currency={currency}
          months={fullMonths}
        />
      )}
      <section className="card">
        <div className="section-heading">
          <h2>
            {property
              ? "Monthly property cash flow"
              : "Income, expenses & net cash flow"}
          </h2>
          <span className="muted">
            {scope.months.length} month{scope.months.length === 1 ? "" : "s"}
          </span>
        </div>
        <CashChart data={series} currency={currency} property={property} />
        {period === "custom" && fullMonths.length !== scope.months.length && (
          <p className="coverage-note">
            Partial bars include only the selected dates, rather than a whole
            calendar month.
          </p>
        )}
      </section>
      <div className="content-grid">
        <section className="card">
          <h2>{property ? "Property costs" : "Category spending"}</h2>
          {property ? (
            <dl className="totals">
              {subcategories.map((c) => (
                <div key={c.id}>
                  <dt>
                    <Link
                      to={
                        c.id === "uncategorized"
                          ? "/transactions?uncategorized=1&allDates=1"
                          : `/categories/${c.id}?month=${month}`
                      }
                    >
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
                    -selectedItems
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
                to={
                  c.id === "uncategorized"
                    ? "/transactions?uncategorized=1&allDates=1"
                    : `/categories/${c.id}?month=${month}`
                }
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
                {displayMerchant(t)}
                <small>{formatUkDate(t.date)}</small>
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
            <h2>Compare with previous period</h2>
            <dl className="totals">
              {comparable && (
                <>
                  <div>
                    <dt>Income change</dt>
                    <dd>
                      {money(flow.income - previous.income, currency, true)}
                    </dd>
                  </div>
                  <div>
                    <dt>Expense change</dt>
                    <dd>
                      {money(flow.expenses - previous.expenses, currency, true)}
                    </dd>
                  </div>
                  <div>
                    <dt>Net cash flow change</dt>
                    <dd>{money(flow.net - previous.net, currency, true)}</dd>
                  </div>
                </>
              )}
              <div>
                <dt>
                  Average monthly spending · verified months in this period
                </dt>
                <dd>
                  {average !== undefined
                    ? money(Math.round(average), currency)
                    : "Not enough history"}
                </dd>
              </div>
            </dl>
            <p className="coverage-note">
              {comparable
                ? `Compared with ${formatDateRange(scope.previousStart, shiftDate(scope.previousEnd, -1))}; both periods have complete verified coverage.`
                : "Not comparable yet: both periods need complete verified statement coverage."}
              {average !== undefined &&
                ` Monthly average uses ${verifiedSeries.length} verified month${verifiedSeries.length === 1 ? "" : "s"}.`}
            </p>
          </section>
          <section className="card">
            <h2>Category trends</h2>
            <p className="muted">
              Monthly expenses in the selected period. Tap a value to inspect
              it.
            </p>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Category</th>
                    {scope.months.map((m) => (
                      <th key={m}>{monthLabel(m)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {spending.map((c) => (
                    <tr key={c.id}>
                      <th>{c.name}</th>
                      {scope.months.map((m, index) => (
                        <td key={m}>
                          <Link
                            to={`/transactions?category=${c.id}&month=${m}`}
                          >
                            {series[index]?.expenses === null
                              ? "No verified statements"
                              : money(
                                  categorySpending(
                                    selectedItems.filter((t) =>
                                      t.date.startsWith(m),
                                    ),
                                    data.categories,
                                    currency,
                                  ).find((x) => x.id === c.id)?.amount ?? 0,
                                  currency,
                                )}
                            {series[index]?.coverage.status === "Partial"
                              ? " · partial"
                              : ""}
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
                  {displayMerchant({
                    merchant: r.merchant,
                    description: r.merchant,
                  })}
                  <small>
                    {r.occurrences} payments · last {formatUkDate(r.lastDate)}
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
