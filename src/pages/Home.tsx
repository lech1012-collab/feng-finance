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
import { PositionSummary } from "../components/PositionSummary";
import { ImportButton } from "../components/ImportPicker";
import { MonthPicker } from "../components/common";
import { CashChart } from "../components/Chart";
import { db } from "../storage/database";
import { auditedMutation } from "../storage/audit";
import { loadDemo } from "../storage/demo";
import { monthBounds, monthLabel, monthOffset } from "../domain/dates";
import { displayDate, displayMerchant } from "../domain/presentation";
import { cashFlow, categorySpending } from "../analytics/calculations";
import { verifiedStatements } from "../analytics/coverage";
import { excludedFlows, homeDataHealth } from "../analytics/home-summary";
import { reportingPlanningForecast } from "../analytics/reporting-forecast";
import { potsOverview } from "../analytics/planning-v2";
import { deeperInsights } from "../analytics/deeper";
import { localToday } from "../analytics/reminders";
import { detectSubscriptions } from "../analytics/subscriptions";
import { money } from "../domain/money";
import { accountSnapshot } from "../analytics/balances";
import {
  effectiveTransactions,
  needsReview,
} from "../analytics/effective-transactions";
import { projectedReportingTransactions } from "../analytics/fx";
import {
  reportingCoverage,
  reportingMonthlySeries,
} from "../analytics/reporting";
import { reportingPeriod, reportingPeriodLabel } from "../domain/period";

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
  const data = useLiveQuery(
    () =>
      db.transaction(
        "r",
        [
          db.statements,
          db.accounts,
          db.transactions,
          db.categories,
          db.settings,
          db.fxRates,
          db.valuations,
          db.pots,
          db.transferProposals,
          db.recurringSeries,
        ],
        async () => {
          // One coherent snapshot avoids combining source balances and transactions
          // from different commits, and keeps remounted reads out of the implicit cache.
          const [statements, accounts] = await Promise.all([
            db.statements.toArray(),
            db.accounts.toArray(),
          ]);
          let from = [
            monthBounds(monthOffset(month, -12))[0],
            `${Number(today.slice(0, 4)) - 3}${today.slice(4)}`,
          ].sort()[0];
          let to = [monthBounds(month)[1], today].sort().at(-1)!;
          // Card statements can extend beyond the selected calendar month. Load all
          // their rows so coverage verification can check their printed balances.
          const documents = statements.filter(
            (s) => s.statementPeriodStart <= to && s.statementPeriodEnd >= from,
          );
          from = [
            from,
            ...documents.map((s) => s.statementPeriodStart),
          ].sort()[0];
          to = [to, ...documents.map((s) => s.statementPeriodEnd)]
            .sort()
            .at(-1)!;
          const transactions = await db.transactions
            .where("date")
            .between(from, to, true, true)
            .toArray();
          // A latest dated account balance may be older than the analysis window, or
          // a card may contain purchases before its printed period. Check its complete
          // source rows by index, rather than mistaking an unloaded row for deletion.
          const snapshots = accounts.map((account) =>
            accountSnapshot(account, statements, month),
          );
          const sourceRows = (
            await Promise.all(
              [
                ...new Set(
                  snapshots.flatMap((snapshot) =>
                    snapshot.statement ? [snapshot.statement.id] : [],
                  ),
                ),
              ].map((statementId) =>
                db.transactions
                  .where("statementId")
                  .equals(statementId)
                  .toArray(),
              ),
            )
          ).flat();
          const manualWalletIds = accounts
            .filter(
              (account) =>
                account.tracking === "manual" &&
                ["current", "savings"].includes(account.accountType),
            )
            .map((account) => account.id);
          // Wallet balances need every movement since their opening valuation, even
          // when that movement predates the chart's analysis window.
          const manualWalletRows = manualWalletIds.length
            ? await db.transactions
                .where("accountId")
                .anyOf(manualWalletIds)
                .toArray()
            : [];
          const indexedRows = new Map(transactions.map((row) => [row.id, row]));
          for (const row of [...sourceRows, ...manualWalletRows])
            indexedRows.set(row.id, row);
          return {
            transactions: [...indexedRows.values()],
            categories: await db.categories.toArray(),
            accounts,
            statements,
            settings: await db.settings.toArray(),
            count: await db.transactions.count(),
            uncategorized: await db.transactions
              .filter(
                (t) =>
                  !t.parentId &&
                  !t.categoryId &&
                  !t.isTransfer &&
                  t.kind !== "refund" &&
                  t.kind !== "split_parent",
              )
              .count(),
            toReview: await db.transactions.filter(needsReview).count(),
            rates: await db.fxRates.toArray(),
            valuations: await db.valuations.toArray(),
            pots: await db.pots.toArray(),
            proposals: await db.transferProposals.toArray(),
            recurringSeries: await db.recurringSeries.toArray(),
          };
        },
      ),
    [month, currency, today],
  );
  if (!data) return <p role="status">Loading your finances…</p>;

  if (!data.accounts.length && !data.count)
    return (
      <>
        <div className="page-heading">
          <h1>Home</h1>
        </div>
        <section className="welcome card">
          <Wallet size={30} />
          <h2>Your finances, in one place.</h2>
          <p>
            Import statements to see your financial position. Everything stays
            on this device.
          </p>
          <div className="actions">
            <ImportButton className="button primary">
              Import your first statement
            </ImportButton>
            <button onClick={() => void loadDemo()}>
              Try fictitious demo data
            </button>
          </div>
        </section>
      </>
    );

  const projection = projectedReportingTransactions(
    effectiveTransactions(data.transactions),
    currency,
    data.rates,
  );
  const reportingRows = projection.transactions;
  const [start, end] = reportingPeriod(month, data.settings, data.transactions);
  const current = reportingRows.filter((t) => t.date >= start && t.date < end);
  const flow = cashFlow(current, currency);
  const coverage = reportingCoverage(
    data.accounts,
    data.statements,
    data.transactions,
    month,
    currency,
    data.rates,
    data.settings,
    data.proposals,
    today,
    projection,
  );
  const previousMonth = monthOffset(month, -1);
  const previousCoverage = reportingCoverage(
    data.accounts,
    data.statements,
    data.transactions,
    previousMonth,
    currency,
    data.rates,
    data.settings,
    data.proposals,
    today,
    projection,
  );
  const previousRange = reportingPeriod(
    previousMonth,
    data.settings,
    data.transactions,
  );
  const previous = cashFlow(
    reportingRows.filter(
      (t) => t.date >= previousRange[0] && t.date < previousRange[1],
    ),
    currency,
  );
  const difference = flow.net - previous.net;
  const categories = categorySpending(current, data.categories, currency);
  const excluded = excludedFlows(
    projectedReportingTransactions(data.transactions, currency, data.rates)
      .transactions,
    data.accounts,
    month,
    currency,
    [start, end],
  );
  const subscriptions = [...new Set(data.accounts.map((a) => a.currency))]
    .flatMap((native) =>
      detectSubscriptions(data.transactions, data.settings, native, today),
    )
    .filter((s) => s.needsReview);
  const forecast = reportingPlanningForecast(
    data.transactions,
    data.accounts,
    data.statements,
    data.settings,
    currency,
    today,
    30,
    data.rates,
    data.recurringSeries,
  );
  const selectedEnd = new Date(
    Date.parse(`${monthBounds(month)[1]}T12:00:00Z`) - 86400000,
  )
    .toISOString()
    .slice(0, 10);
  const potSummary = potsOverview(
    data.pots,
    data.accounts,
    data.statements,
    data.transactions,
    currency,
    selectedEnd < today ? selectedEnd : today,
    data.rates,
    data.valuations,
  );
  const flowHref = (kind: string) =>
    `/transactions?month=${month}&flow=${kind}&from=${start}&to=${new Date(Date.parse(`${end}T12:00:00Z`) - 86400000).toISOString().slice(0, 10)}&allDates=0`;
  const insights = deeperInsights(
    reportingRows,
    data.accounts,
    verifiedStatements(data.statements, data.transactions, today),
    data.categories,
    data.settings,
    month,
    currency,
    today,
    (candidateMonth) =>
      reportingCoverage(
        data.accounts,
        data.statements,
        data.transactions,
        candidateMonth,
        currency,
        data.rates,
        data.settings,
        data.proposals,
        today,
        projection,
      ).complete,
  );
  const insight = insights.items[0];
  const health = homeDataHealth(data.settings, today);
  const sortHref = "/transactions?review=1&allDates=1&sort=1";
  const missingAccounts = data.accounts.filter((a) =>
    coverage.incompleteAccountIds.includes(a.id),
  );
  const todo = [
    ...(data.toReview > 0 ? [{ kind: "sort", account: undefined }] : []),
    ...(coverage.pendingTransfers > 0
      ? [{ kind: "transfers", account: undefined }]
      : []),
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
        <span className="muted">
          {reportingPeriodLabel(month, data.settings, data.transactions)}
        </span>
      </div>
      {location.state?.importedCount !== undefined && (
        <div className="notice import-result" role="status">
          <span>
            Import complete: {location.state.importedCount} imported
            {location.state.updatedStatementCount > 0 &&
              ` · ${location.state.updatedStatementCount} statement${location.state.updatedStatementCount === 1 ? "" : "s"} updated`}
            {location.state.duplicateCount > 0 &&
              ` · ${location.state.duplicateCount} duplicate${location.state.duplicateCount === 1 ? "" : "s"} skipped`}
            {location.state.excludedCount > 0 &&
              ` · ${location.state.excludedCount} excluded by you`}
            {location.state.skippedFileCount > 0 &&
              ` · ${location.state.skippedFileCount} PDF${location.state.skippedFileCount === 1 ? "" : "s"} skipped`}
            {location.state.automaticallyLinkedCount > 0 &&
              ` · ${location.state.automaticallyLinkedCount} pair${location.state.automaticallyLinkedCount === 1 ? "" : "s"} linked automatically`}
            {data.toReview > 0 && ` · ${data.toReview} still to review`}
          </span>
          {location.state.automaticallyLinkedCount > 0 && (
            <Link to="/transactions?type=transfer&allDates=1">
              Review linked transfers
            </Link>
          )}
          {data.toReview > 0 && <Link to={sortHref}>Sort now</Link>}
        </div>
      )}
      {location.state?.importedCount > 0 &&
        !data.settings.some(
          (s) => s.key === "setup:dismissed" && s.value === "true",
        ) && (
          <section
            className="card first-import-setup"
            aria-label="After your first import"
          >
            <div className="section-heading">
              <h2>Ready for next month</h2>
              <button
                onClick={() =>
                  void auditedMutation("Dismiss setup tips", ["settings"], () =>
                    db.settings.put({ key: "setup:dismissed", value: "true" }),
                  )
                }
              >
                Dismiss
              </button>
            </div>
            <p>Protect access and keep a copy of your data.</p>
            <div className="actions">
              <Link to="/settings#security">Set app lock</Link>
              <Link to="/settings#backup">Save backup</Link>
              <Link to="/settings#transfers">Transfer matching</Link>
            </div>
          </section>
        )}
      <PositionSummary
        transactions={data.transactions}
        period={balancePeriod}
        onPeriodChange={setBalancePeriod}
        accounts={data.accounts}
        statements={data.statements}
        valuations={data.valuations}
        rates={data.rates}
        pots={data.pots}
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
          <Link to={flowHref("income")} className="month-income">
            <span>Income</span>
            {coverage.hasIncomeSource ? (
              <strong>
                {coverage.missingRates
                  ? "Rates needed"
                  : `${projection.converted ? "≈ " : ""}${money(flow.income, currency)}${coverage.complete ? "" : "*"}`}
              </strong>
            ) : (
              <strong className="metric-unavailable">
                No income source imported
              </strong>
            )}
          </Link>
          <Link to={flowHref("spending")} className="month-spending">
            <span>Spending</span>
            <strong>
              {coverage.hasData
                ? coverage.missingRates
                  ? "Rates needed"
                  : `${projection.converted ? "≈ " : ""}${money(flow.expenses, currency)}${coverage.complete ? "" : "*"}`
                : "Not imported"}
            </strong>
          </Link>
          <Link to={flowHref("net")} className="month-net">
            <span>Net cash flow</span>
            <strong>
              {coverage.hasIncomeSource && coverage.hasData
                ? coverage.missingRates
                  ? "n/a"
                  : `${projection.converted ? "≈ " : ""}${money(flow.net, currency, true)}${coverage.complete ? "" : "*"}`
                : "n/a"}
            </strong>
          </Link>
        </div>
        {!coverage.complete && coverage.hasData && (
          <p className="month-status">From imported accounts only.</p>
        )}
        {coverage.hasUnverifiedStatements && (
          <p className="coverage-note">
            Monthly history is not fully verified. Statement dates or balances
            prevent a reliable comparison.
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
          {data.transactions.some(
            (t) => t.kind === "refund" && t.date >= start && t.date < end,
          ) && (
            <Link to={`/transactions?month=${month}&allDates=0`}>
              Refunds · counted in original purchase months
            </Link>
          )}
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
                      <strong>
                        Update {missingAccounts.length} account
                        {missingAccounts.length === 1 ? "" : "s"}
                      </strong>
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
                to={
                  item.kind === "sort"
                    ? sortHref
                    : item.kind === "transfers"
                      ? "/transactions?transfers=1&allDates=1"
                      : "/subscriptions"
                }
              >
                <span>
                  {item.kind === "sort"
                    ? `Review ${data.toReview} transaction${data.toReview === 1 ? "" : "s"}`
                    : item.kind === "transfers"
                      ? `${coverage.pendingTransfers} transfer${coverage.pendingTransfers === 1 ? "" : "s"} to confirm`
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

      {todo.length === 0 && (
        <section className="card home-todos">
          <h2>All sorted</h2>
          <Link to={`/review?month=${month}`} className="button">
            Review month
          </Link>
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

      {data.pots.length > 0 && (
        <section className="card">
          <div className="section-heading">
            <h2>Pots and goals</h2>
            <Link to="/planning">Planning</Link>
          </div>
          {potSummary.items.slice(0, 3).map(({ pot, progress, partial }) => (
            <Link className="insight-row" key={pot.id} to="/planning?tab=pots">
              <span>
                {pot.name}
                <small>Set aside · included in your cash</small>
              </span>
              <strong>
                {progress.linkedUnavailable
                  ? "Balance unavailable"
                  : money(progress.savedMinor, pot.currency)}{" "}
                / {money(pot.targetMinor, pot.currency)}
                {partial ? "*" : ""}
              </strong>
            </Link>
          ))}
          {potSummary.partial && (
            <p className="coverage-note">
              * Some linked balances or exchange rates are unavailable. Pots
              earmark cash; they never reduce your account balance.
            </p>
          )}
        </section>
      )}
      <section className="card flow-card">
        <div className="section-heading">
          <h2>Cash flow</h2>
          <span className="muted">6 months</span>
        </div>
        <CashChart
          showValues={false}
          data={reportingMonthlySeries(
            data.transactions,
            data.accounts,
            data.statements,
            month,
            6,
            currency,
            data.rates,
            data.settings,
            data.proposals,
            today,
          )}
          currency={currency}
        />
      </section>

      <PositionSummary
        historyOnly
        transactions={data.transactions}
        period={balancePeriod}
        onPeriodChange={setBalancePeriod}
        accounts={data.accounts}
        statements={data.statements}
        valuations={data.valuations}
        rates={data.rates}
        pots={data.pots}
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
              <strong>
                {forecast.converted ? "≈ " : ""}
                {money(payment.amount, currency, true)}
              </strong>
            </Link>
          ))}
          <p className="coverage-note">
            {forecast.reason
              ? `Balance forecast unavailable: ${forecast.reason}`
              : `Forecast based on ${forecast.baselineMonths} complete imported month${forecast.baselineMonths === 1 ? "" : "s"} and verified balances across ${data.accounts.length} account${data.accounts.length === 1 ? "" : "s"}.`}
          </p>
          {forecast.converted && (
            <p className="coverage-note">
              Future payments use cached exchange rates, which may change.
            </p>
          )}
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
            " Save a new backup to include recent imports and changes."}
        </p>
        <p className="muted">
          {data.count} transaction{data.count === 1 ? "" : "s"} on this device
          {health.reviewDate &&
            ` · next statement review ${displayDate(health.reviewDate)}`}
        </p>
      </section>
    </>
  );
}
