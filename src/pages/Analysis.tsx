import { UKDateInput } from "../components/UKDateInput";
import { merchantExpenses } from "../analytics/merchant-expenses";
import { useSearchParams } from "react-router-dom";
import { ReportBuilder } from "../components/ReportBuilder";
import { TagAnalysis } from "../components/TagAnalysis";
import { projectedReportingTransactions } from "../analytics/fx";
import { effectiveTransactions } from "../analytics/effective-transactions";
import {
  reportingCoverage,
  reportingMonthlySeries,
} from "../analytics/reporting";
import { reportingPeriod } from "../domain/period";
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
import { MonthPicker, Metric, PeriodControl } from "../components/common";
import { CashChart } from "../components/Chart";
import { ListRow } from "../components/UIPrimitives";
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
  const [params] = useSearchParams();
  const view = params.get("view");
  const [period, setPeriod] = useState(property ? "ytd" : "6");
  const [customFrom, setCustomFrom] = useState(monthBounds(month)[0]);
  const [customTo, setCustomTo] = useState(
    shiftDate(monthBounds(month)[1], -1),
  );
  const today = localToday();
  const source = useLiveQuery(
    async () => ({
      transactions: await db.transactions.toArray(),
      categories: await db.categories.toArray(),
      accounts: await db.accounts.toArray(),
      statements: await db.statements.toArray(),
      settings: await db.settings.toArray(),
      rates: await db.fxRates.toArray(),
      proposals: await db.transferProposals.toArray(),
      tags: await db.tags.toArray(),
    }),
    [],
  );
  const data = source
    ? {
        ...source,
        settings: source.settings ?? [],
        rates: source.rates ?? [],
        proposals: source.proposals ?? [],
        tags: source.tags ?? [],
        transactions: projectedReportingTransactions(
          effectiveTransactions(source.transactions),
          currency,
          source.rates ?? [],
        ).transactions,
      }
    : undefined;
  const scope = analysisPeriod(
    month,
    period,
    customFrom,
    customTo,
    data?.settings,
    source?.transactions,
  );
  const { start, end } = scope;
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
    const covered = reportingCoverage(
      data.accounts,
      data.statements,
      source!.transactions,
      m,
      currency,
      data.rates,
      data.settings,
      data.proposals,
      today,
    );
    const bounds = reportingPeriod(m, data.settings, source!.transactions);
    const rangeStart = [start, bounds[0]].sort().at(-1)!;
    const rangeEnd = [end, bounds[1]].sort()[0];
    const intersects = (statement: (typeof data.statements)[number]) =>
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
            ![
              "credit",
              "credit_card",
              "loan",
              "mortgage",
              "other_liability",
            ].includes(account.accountType),
        ),
      ),
      status:
        covered.missingRates || covered.staleRates
          ? ("Unverified" as const)
          : covered.complete
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
  const missingRates = coverage.some((c) => c.missingRates > 0);
  const approximate = selectedItems.some((t) => "conversion" in t);
  const previousCoverage = monthsInRange(
    scope.previousStart,
    scope.previousEnd,
  ).map((m) =>
    reportingCoverage(
      data.accounts,
      data.statements,
      source!.transactions,
      m,
      currency,
      data.rates,
      data.settings,
      data.proposals,
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
  const previousCategoryAmounts = new Map(
    categorySpending(
      data.transactions.filter(
        (t) => t.date >= scope.previousStart && t.date < scope.previousEnd,
      ),
      data.categories,
      currency,
    ).map((category) => [category.id, category.amount]),
  );
  const regular = recurring(relevant, currency);
  const series = scope.months.length
    ? reportingMonthlySeries(
        source!.transactions,
        data.accounts,
        data.statements,
        scope.months.at(-1)!,
        scope.months.length,
        currency,
        data.rates,
        data.settings,
        data.proposals,
        today,
      ).map((point) => {
        const covered = coverage[scope.months.indexOf(point.month)];
        const usable =
          covered.status === "Complete" || covered.status === "Partial";
        const clipped =
          reportingPeriod(point.month, data.settings, source!.transactions)[0] <
            start ||
          reportingPeriod(point.month, data.settings, source!.transactions)[1] >
            end;
        const rows = selectedItems.filter(
          (transaction) =>
            transaction.date >=
              reportingPeriod(
                point.month,
                data.settings,
                source!.transactions,
              )[0] &&
            transaction.date <
              reportingPeriod(
                point.month,
                data.settings,
                source!.transactions,
              )[1],
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
    (m) =>
      reportingPeriod(m, data.settings, source!.transactions)[0] >= start &&
      reportingPeriod(m, data.settings, source!.transactions)[1] <= end,
  );
  const verifiedSeries = series.filter(
    (point) => point.coverage.complete && fullMonths.includes(point.month),
  );
  const average = verifiedSeries.length
    ? verifiedSeries.reduce((sum, point) => sum + (point.expenses ?? 0), 0) /
      verifiedSeries.length
    : undefined;
  const largest = merchantExpenses(relevant);
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
  if (!property && (view === "reports" || view === "trips"))
    return (
      <>
        <Link className="back-link" to="/analysis">
          ‹ Analyse
        </Link>
        <h1>{view === "reports" ? "Reports" : "Trips and projects"}</h1>
        {missingRates ? (
          <section className="card">
            <h2>Rates needed</h2>
            <p>
              Some amounts cannot be converted. Totals are withheld until their
              exchange rates are available.
            </p>
            <Link className="button" to="/settings?section=currency">
              Review exchange rates
            </Link>
          </section>
        ) : view === "reports" ? (
          <ReportBuilder
            transactions={data.transactions}
            accounts={data.accounts}
            categories={data.categories}
            tags={data.tags}
            currency={currency}
            rawTransactions={source!.transactions}
            settings={data.settings}
          />
        ) : (
          <>
            <TagAnalysis
              transactions={selectedItems}
              categories={data.categories}
              tags={data.tags}
              currency={currency}
            />
            <Link className="button" to="/settings?section=tags">
              Manage tags
            </Link>
          </>
        )}
      </>
    );
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
      </div>
      <div className="toolbar">
        <MonthPicker month={month} onChange={setMonth} />
        <PeriodControl value={period} onChange={setPeriod} />
      </div>
      {period === "custom" && (
        <div className="card form-grid">
          <label>
            From
            <UKDateInput
              value={customFrom}
              onChange={(e) => setCustomFrom(e)}
            />
          </label>
          <label>
            To
            <UKDateInput value={customTo} onChange={(e) => setCustomTo(e)} />
          </label>
        </div>
      )}
      <p className="muted">
        {scope.valid ? (
          <span className="date-value">
            {formatDateRange(start, shiftDate(end, -1))}
          </span>
        ) : (
          "Choose a valid date range"
        )}
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
            approximate={approximate}
            partial={!complete}
            unavailable={missingRates ? "Rates needed" : undefined}
          />
        ) : (
          <div className="metric">
            <span>{property ? "Rental income" : "Income"}</span>
            <strong>Not imported</strong>
          </div>
        )}
        {coverage.some((c) => c.hasData) ? (
          <Metric
            label={property ? "Property costs" : "Expenses"}
            value={flow.expenses}
            currency={currency}
            approximate={approximate}
            partial={!complete}
            unavailable={missingRates ? "Rates needed" : undefined}
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
            approximate={approximate}
            partial={!complete}
            unavailable={missingRates ? "Rates needed" : undefined}
          />
        ) : (
          <div className="metric">
            <span>{property ? "Net property cash flow" : "Net cash flow"}</span>
            <strong>Unavailable</strong>
          </div>
        )}
      </section>
      {missingRates && (
        <p className="notice warning" role="status">
          Some account currencies cannot be converted. Totals are unavailable;
          lists include only accounts with usable rates.{" "}
          <Link to="/settings#global-currency">Add exchange rates</Link>.
        </p>
      )}
      {approximate && (
        <p className="coverage-note">
          ≈ Converted using transaction-date exchange rates. Original amounts
          remain in each transaction.
        </p>
      )}
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
        <div className="analysis-shortcuts">
          <CategoryAnalysisPicker month={month} />
          <Link to={`/review?month=${month}`} className="button">
            Review month
          </Link>
        </div>
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
          rawTransactions={source!.transactions}
          reportingSettings={data.settings}
          rates={data.rates}
          proposals={data.proposals}
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
        <section className="card" id="category-spending">
          <h2>{property ? "Property costs" : "Category spending"}</h2>
          {property ? (
            <dl className="totals property-cost-rows">
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
              {selectedItems.some(
                (t) =>
                  t.categoryId === "property" &&
                  !t.subcategoryId &&
                  !t.isTransfer &&
                  t.amount < 0,
              ) && (
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
              )}
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
              key={`${t.currency}:${t.name}`}
              to={`/transactions?allDates=1&advanced=1&conditions=${encodeURIComponent(
                JSON.stringify([
                  {
                    field: "displayMerchant",
                    operator: "equals",
                    value: t.name,
                  },
                  {
                    field: "date",
                    operator: "between",
                    value: start,
                    valueTo: shiftDate(end, -1),
                  },
                ]),
              )}`}
              className="insight-row"
            >
              <span>
                {t.name}
                <small>
                  {t.count} payment{t.count === 1 ? "" : "s"}
                </small>
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
              {comparable ? (
                <>
                  Compared with{" "}
                  <span className="date-value">
                    {formatDateRange(
                      scope.previousStart,
                      shiftDate(scope.previousEnd, -1),
                    )}
                  </span>
                  ; both periods have complete verified coverage.
                </>
              ) : (
                "Not comparable yet: both periods need complete verified statement coverage."
              )}
              {average !== undefined &&
                ` Monthly average uses ${verifiedSeries.length} verified month${verifiedSeries.length === 1 ? "" : "s"}.`}
            </p>
          </section>
          <details className="card">
            <summary>Category trends</summary>
            <p className="muted">
              Verified periods can be compared; incomplete history stays
              unavailable.
            </p>
            <div className="category-trend-summary">
              <p className="muted">
                Change against the previous period. Open a category for its
                monthly plot.
              </p>
              <ul className="category-trend-list">
                {spending.map((category) => (
                  <li key={category.id}>
                    <ListRow
                      title={category.name}
                      key={category.id}
                      to={
                        category.id === "uncategorized"
                          ? "/transactions?uncategorized=1&allDates=1"
                          : `/categories/${category.id}?month=${month}`
                      }
                      amount={
                        comparable
                          ? money(
                              category.amount -
                                (previousCategoryAmounts.get(category.id) ?? 0),
                              currency,
                              true,
                            )
                          : "Not comparable"
                      }
                    />
                  </li>
                ))}
              </ul>
            </div>
            <details className="category-monthly-values">
              <summary>Monthly values</summary>
              <div
                className="table-scroll"
                role="region"
                aria-label="Category monthly values"
                tabIndex={0}
              >
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
            </details>
          </details>
        </>
      )}
      {!property && (
        <section className="card more-analysis">
          <h2>More analysis</h2>
          <Link to="/analysis?view=reports">Reports ›</Link>
          <Link to="/subscriptions">Subscriptions and bills ›</Link>
          <Link to="/analysis?view=trips">Trips and projects ›</Link>
        </section>
      )}
    </>
  );
}
