import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import {
  ArrowUpRight,
  ArrowDownRight,
  Upload,
  Wallet,
  ShoppingBag,
  ChevronRight,
} from "lucide-react";
import { AccountBalances } from "../components/AccountBalances";
import { BalanceChart } from "../components/BalanceChart";
import { ImportButton } from "../components/ImportPicker";
import { MonthPicker } from "../components/common";
import { CashChart } from "../components/Chart";
import { db } from "../storage/database";
import { loadDemo } from "../storage/demo";
import { monthBounds, monthLabel, monthOffset } from "../domain/dates";
import { displayDate, displayMerchant } from "../domain/presentation";
import { cashFlow, categorySpending } from "../analytics/calculations";
import {
  coverageMonthlySeries,
  monthCoverage,
  verifiedStatements,
} from "../analytics/coverage";
import { excludedFlows, homeDataHealth } from "../analytics/home-summary";
import { planningForecast } from "../analytics/planning";
import { deeperInsights } from "../analytics/deeper";
import { localToday } from "../analytics/reminders";
import { detectSubscriptions } from "../analytics/subscriptions";
import { money } from "../domain/money";

export default function Home({
  month,
  setMonth,
  currency,
}: {
  month: string;
  setMonth: (m: string) => void;
  currency: string;
}) {
  const location = useLocation();
  const [share, setShare] = useState("spending");
  const [balancePeriod, setBalancePeriod] = useState(1);
  const today = localToday();
  const data = useLiveQuery(async () => {
    const statements = await db.statements.toArray();
    let from = [
      monthBounds(monthOffset(month, -12))[0],
      `${Number(today.slice(0, 4)) - 3}${today.slice(4)}`,
    ].sort()[0];
    let to = [monthBounds(month)[1], today].sort().at(-1)!;
    // Card statements can extend beyond the selected calendar month. Load all
    // their rows so coverage verification can check their printed balances.
    const documents = statements.filter(
      (s) =>
        s.currency === currency &&
        s.statementPeriodStart <= to &&
        s.statementPeriodEnd >= from,
    );
    from = [from, ...documents.map((s) => s.statementPeriodStart)].sort()[0];
    to = [to, ...documents.map((s) => s.statementPeriodEnd)].sort().at(-1)!;
    const transactions = await db.transactions
      .where("[currency+date]")
      .between([currency, from], [currency, to], true, true)
      .toArray();
    return {
      transactions,
      categories: await db.categories.toArray(),
      accounts: await db.accounts.where("currency").equals(currency).toArray(),
      statements,
      settings: await db.settings.toArray(),
      count: await db.transactions.count(),
      uncategorized: await db.transactions
        .where("[currency+date]")
        .between([currency, "0000"], [currency, "9999"], true, true)
        .filter(
          (t) =>
            !t.categoryId &&
            !t.subcategoryId &&
            !t.isTransfer &&
            t.type !== "transfer" &&
            !t.transferPairId,
        )
        .count(),
    };
  }, [month, currency, today]);
  if (!data) return <p role="status">Loading your finances…</p>;

  const current = data.transactions.filter((t) => t.date.startsWith(month));
  const flow = cashFlow(current, currency);
  const coverage = monthCoverage(
    data.accounts,
    data.statements,
    data.transactions,
    month,
    currency,
    today,
  );
  const previousCoverage = monthCoverage(
    data.accounts,
    data.statements,
    data.transactions,
    monthOffset(month, -1),
    currency,
    today,
  );
  const previous = cashFlow(
    data.transactions.filter((t) => t.date.startsWith(monthOffset(month, -1))),
    currency,
  );
  const difference = flow.net - previous.net;
  const categories = categorySpending(current, data.categories, currency);
  const excluded = excludedFlows(
    data.transactions,
    data.accounts,
    month,
    currency,
  );
  const subscriptions = detectSubscriptions(
    data.transactions,
    data.settings,
    currency,
    today,
  ).filter((s) => s.needsReview);
  const forecast = planningForecast(
    data.transactions,
    data.accounts,
    data.statements,
    data.settings,
    currency,
    today,
    30,
  );
  const insights = deeperInsights(
    data.transactions,
    data.accounts,
    verifiedStatements(data.statements, data.transactions, today),
    data.categories,
    data.settings,
    month,
    currency,
    today,
    (candidateMonth) =>
      monthCoverage(
        data.accounts,
        data.statements,
        data.transactions,
        candidateMonth,
        currency,
        today,
      ).complete,
  );
  const insight = insights.items[0];
  const health = homeDataHealth(data.settings, today);
  const sortHref = "/transactions?uncategorized=1&allDates=1&sort=1";
  const missingAccounts = data.accounts.filter((a) =>
    coverage.incompleteAccountIds.includes(a.id),
  );
  const todo = [
    ...(data.uncategorized > 0 ? [{ kind: "sort", account: undefined }] : []),
    ...(missingAccounts.length
      ? [
          {
            kind: "import",
            account:
              missingAccounts.length === 1 ? missingAccounts[0] : undefined,
          },
        ]
      : []),
    ...(subscriptions.length
      ? [{ kind: "subscriptions", account: undefined }]
      : []),
  ].slice(0, 3);
  const monthName = new Date(`${month}-01T12:00:00Z`).toLocaleDateString(
    "en-GB",
    { month: "long", timeZone: "UTC" },
  );

  return (
    <>
      <div className="page-heading">
        <h1>Home</h1>
        <ImportButton className="button primary import-main">
          <Upload size={18} />
          Import statement
        </ImportButton>
      </div>
      <div className="toolbar">
        <MonthPicker month={month} onChange={setMonth} />
      </div>
      {location.state?.importedCount !== undefined && (
        <div className="notice import-result" role="status">
          <span>
            Import complete: {location.state.importedCount} imported
            {location.state.updatedStatementCount > 0 &&
              ` · ${location.state.updatedStatementCount} statement${location.state.updatedStatementCount === 1 ? "" : "s"} updated`}
            {location.state.duplicateCount > 0 &&
              ` · ${location.state.duplicateCount} duplicates skipped`}
            {location.state.excludedCount > 0 &&
              ` · ${location.state.excludedCount} excluded by you`}
            {location.state.skippedFileCount > 0 &&
              ` · ${location.state.skippedFileCount} PDF${location.state.skippedFileCount === 1 ? "" : "s"} skipped`}
            {data.uncategorized > 0 && ` · ${data.uncategorized} still to sort`}
          </span>
          {data.uncategorized > 0 && <Link to={sortHref}>Sort now</Link>}
        </div>
      )}
      {!data.count && !data.statements.length && (
        <section className="welcome card">
          <Wallet size={30} />
          <h2>Your finances, in one place.</h2>
          <p>Import your bank statements to see your financial position.</p>
          <div className="actions">
            <ImportButton className="button primary">
              Import your first statement
            </ImportButton>
            <button onClick={() => void loadDemo()}>
              Try fictitious demo data
            </button>
          </div>
        </section>
      )}
      <AccountBalances
        transactions={data.transactions}
        period={balancePeriod}
        onPeriodChange={setBalancePeriod}
        accounts={data.accounts}
        statements={data.statements}
        month={month}
        currency={currency}
      />

      <section className="card month-summary">
        <div className="section-heading">
          <h2>This month</h2>
          <span
            className={`coverage-chip coverage-${coverage.status.toLowerCase().replaceAll(" ", "-")}`}
          >
            {coverage.status}
          </span>
        </div>
        <div className="month-figures">
          <div className="month-income">
            <span>Income</span>
            {coverage.hasIncomeSource ? (
              <strong>{money(flow.income, currency)}</strong>
            ) : (
              <strong className="metric-unavailable">
                No income source imported
              </strong>
            )}
          </div>
          <div className="month-spending">
            <span>Spending</span>
            <strong>
              {coverage.hasData
                ? money(flow.expenses, currency)
                : "Not imported"}
            </strong>
          </div>
          <div className="month-net">
            <span>Net cash flow</span>
            <strong>
              {coverage.hasIncomeSource && coverage.hasData
                ? money(flow.net, currency, true)
                : "n/a"}
            </strong>
          </div>
        </div>
        {!coverage.complete && coverage.hasData && (
          <p className="month-status">From imported accounts only.</p>
        )}
        {coverage.hasUnverifiedStatements && (
          <p className="coverage-note">
            Unverified amounts: one or more imported statements have not
            reconciled.
          </p>
        )}
        <p className="hero-comparison">
          {coverage.complete && previousCoverage.complete ? (
            <>
              {difference >= 0 ? (
                <ArrowUpRight size={16} />
              ) : (
                <ArrowDownRight size={16} />
              )}
              {money(difference, currency, true)} vs previous month
            </>
          ) : (
            `Not comparable yet: ${monthName} ${coverage.complete ? "needs a complete previous month" : coverage.hasUnverifiedStatements ? "unverified" : "incomplete"}.`
          )}
        </p>
        <div className="not-counted">
          <span>Not counted:</span>
          <Link
            to={`/transactions?month=${month}&type=transfer&transferKind=internal`}
          >
            {money(excluded.internal, currency)} transfers
          </Link>
          <span aria-hidden="true">·</span>
          <Link
            to={`/transactions?month=${month}&type=transfer&transferKind=card`}
          >
            {money(excluded.card, currency)} card repayments
          </Link>
        </div>
      </section>

      {todo.length > 0 && (
        <section className="card home-todos">
          <div className="section-heading">
            <h2>To do</h2>
          </div>
          {todo.map((item) =>
            item.kind === "import" ? (
              <ImportButton className="home-todo" key="import-accounts">
                <span>
                  {item.account ? (
                    <>
                      Import {item.account.displayName} for {monthLabel(month)}
                    </>
                  ) : (
                    <>
                      <strong>Update {missingAccounts.length} accounts</strong>
                      <small>
                        {missingAccounts.map((a) => a.displayName).join(" · ")}{" "}
                        · {monthLabel(month)}
                      </small>
                    </>
                  )}
                </span>
                <ChevronRight size={18} />
              </ImportButton>
            ) : (
              <Link
                className="home-todo"
                key={item.kind}
                to={item.kind === "sort" ? sortHref : "/subscriptions"}
              >
                <span>
                  {item.kind === "sort"
                    ? `Sort ${data.uncategorized} transaction${data.uncategorized === 1 ? "" : "s"}`
                    : `${subscriptions.length} recurring charge${subscriptions.length === 1 ? "" : "s"} to review`}
                </span>
                {item.kind === "sort" ? (
                  <strong>Start</strong>
                ) : (
                  <ChevronRight size={18} />
                )}
              </Link>
            ),
          )}
        </section>
      )}

      <section className="card categories-card">
        <div className="section-heading">
          <h2>Where did my money go?</h2>
          <ShoppingBag size={19} />
        </div>
        <div
          className="share-options"
          role="group"
          aria-label="Category percentage basis"
        >
          {["spending", "income"].map((value) => (
            <button
              key={value}
              aria-label={`Share of ${value}`}
              aria-pressed={share === value}
              onClick={() => setShare(value)}
            >
              {value === "spending" ? "Spending %" : "Income %"}
            </button>
          ))}
        </div>
        {categories.length ? (
          categories.map((category) => (
            <Link
              key={category.id}
              className={`category-row${category.id === "uncategorized" ? " category-uncategorized" : ""}`}
              to={
                category.id === "uncategorized"
                  ? "/transactions?uncategorized=1&allDates=1"
                  : `/categories/${category.id}?month=${month}`
              }
            >
              <div className="category-meta">
                <span>{category.name}</span>
                <strong>
                  {money(category.amount, currency)}{" "}
                  <small>
                    {share === "income"
                      ? coverage.hasIncomeSource && flow.income > 0
                        ? `${((category.amount / flow.income) * 100).toFixed(1)}%`
                        : "Unavailable"
                      : `${Math.round(category.percent)}%`}
                  </small>
                </strong>
              </div>
              <div className="bar-track">
                <div
                  style={{
                    width: `${Math.min(100, share === "income" ? (coverage.hasIncomeSource && flow.income > 0 ? (category.amount / flow.income) * 100 : 0) : category.percent)}%`,
                    background: category.color,
                  }}
                />
              </div>
            </Link>
          ))
        ) : (
          <p className="muted">
            {coverage.hasData
              ? "No spending for this month."
              : "Import statements to see spending."}
          </p>
        )}
        {data.uncategorized > 0 && (
          <Link
            className="review-link"
            to="/transactions?uncategorized=1&allDates=1"
          >
            {data.uncategorized} transaction
            {data.uncategorized === 1 ? "" : "s"} need
            {data.uncategorized === 1 ? "s" : ""} a category{" "}
            <ChevronRight size={16} />
          </Link>
        )}
      </section>

      <section className="card flow-card">
        <div className="section-heading">
          <h2>Cash flow</h2>
          <span className="muted">6 months</span>
        </div>
        <CashChart
          showValues={false}
          data={coverageMonthlySeries(
            data.transactions,
            data.accounts,
            data.statements,
            month,
            6,
            currency,
            today,
          )}
          currency={currency}
        />
      </section>
      <BalanceChart
        period={balancePeriod}
        transactions={data.transactions}
        accounts={data.accounts}
        statements={data.statements}
        month={month}
        currency={currency}
      />

      {forecast.upcoming.length > 0 && (
        <section className="card home-coming-up">
          <div className="section-heading">
            <h2>Coming up</h2>
            <Link to="/planning">Planning</Link>
          </div>
          <p className="muted">
            Next 30 days · estimated from imported payment patterns.
          </p>
          {forecast.upcoming.slice(0, 3).map((payment) => (
            <Link
              className="upcoming-row"
              key={payment.id}
              to={`/transactions?account=${payment.accountId}&allDates=1&search=${encodeURIComponent(payment.merchant)}`}
            >
              <span>
                <strong>
                  {displayMerchant({
                    merchant: payment.merchant,
                    description: payment.merchant,
                  })}
                </strong>
                <small>
                  Expected {displayDate(payment.date)} · {payment.evidence}{" "}
                  imported payments
                </small>
              </span>
              <strong>{money(payment.amount, currency, true)}</strong>
            </Link>
          ))}
          <p className="coverage-note">
            {forecast.reason
              ? `Balance forecast unavailable: ${forecast.reason}`
              : `Forecast based on ${forecast.baselineMonths} complete imported months and verified balances for all ${data.accounts.length} accounts.`}
          </p>
        </section>
      )}

      {(insight || categories.length > 0) && (
        <section className="card home-insight">
          <div className="section-heading">
            <h2>Insight</h2>
            <Link to="/analysis">Analyse</Link>
          </div>
          {insight ? (
            <Link className="financial-insight" to={insight.href}>
              <strong>{insight.title}</strong>
              <span>{insight.detail}</span>
            </Link>
          ) : (
            <p>
              {categories[0].name} is {Math.round(categories[0].percent)}% of{" "}
              {monthName} spending{coverage.complete ? "." : " so far."}{" "}
              {insights.baselineCount < 3
                ? `Comparisons start after 3 verified months · ${insights.baselineCount} of 3.`
                : !coverage.complete
                  ? `Month comparisons appear once ${monthName} is complete.`
                  : "No significant change detected in your verified history."}
            </p>
          )}
        </section>
      )}

      <section className="card data-health">
        <div className="section-heading">
          <h2>Data health</h2>
          <Link to="/settings#backup">Backup</Link>
        </div>
        <p
          className={
            health.warning && data.count > 0 ? "backup-warning" : "muted"
          }
        >
          {health.lastExportAt
            ? `Last backup export: ${displayDate(health.lastExportAt.slice(0, 10))}${health.exportedCount === undefined ? "" : ` · ${health.exportedCount} transaction${health.exportedCount === 1 ? "" : "s"}`}`
            : "No backup exported yet."}
          {health.lastExportAt &&
            health.warning &&
            " Save a new backup; the last is over 30 days old."}
        </p>
        <p className="muted">
          {data.count} transaction{data.count === 1 ? "" : "s"} on this device
          {health.reviewDate &&
            ` · next statement review ${displayDate(health.reviewDate)}`}
        </p>
      </section>
      {data.transactions.some((t) => t.isDemo) && (
        <div className="demo-note">
          Fictitious demo data. <Link to="/settings">Manage demo data</Link>
        </div>
      )}
    </>
  );
}
