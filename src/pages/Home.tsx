import { AccountBalances } from "../components/AccountBalances";
import { BalanceChart } from "../components/BalanceChart";
import { ImportButton } from "../components/ImportPicker";
import { useState } from "react";
import { SubscriptionNotice } from "../components/SubscriptionNotice";
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
import { db } from "../storage/database";
import { loadDemo } from "../storage/demo";
import { monthBounds, monthOffset } from "../domain/dates";
import {
  cashFlow,
  categorySpending,
  monthlySeries,
  comparisons,
  comparableMonths,
  statementIsCurrent,
} from "../analytics/calculations";
import { money } from "../domain/money";
import { MonthPicker, Metric } from "../components/common";
import { CashChart } from "../components/Chart";
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
  const data = useLiveQuery(async () => {
    const transactions = await db.transactions
      .where("[currency+date]")
      .between(
        [currency, monthBounds(monthOffset(month, -12))[0]],
        [currency, monthBounds(month)[1]],
        true,
        false,
      )
      .toArray();
    return {
      transactions,
      categories: await db.categories.toArray(),
      accounts: await db.accounts.where("currency").equals(currency).toArray(),
      statements: await db.statements.toArray(),
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
  }, [month, currency]);
  if (!data) return <p role="status">Loading your finances…</p>;
  const current = data.transactions.filter((t) => t.date.startsWith(month));
  const flow = cashFlow(current, currency);
  const previous = cashFlow(
    data.transactions.filter((t) => t.date.startsWith(monthOffset(month, -1))),
    currency,
  );
  const difference = flow.net - previous.net;
  const categories = categorySpending(current, data.categories, currency);
  const insights = comparisons(
    data.transactions,
    data.categories,
    month,
    currency,
  );
  const partialCoverage = data.accounts.some(
    (a) =>
      !statementIsCurrent(
        data.statements
          .filter(
            (s) =>
              s.accountId === a.id &&
              s.statementPeriodStart < monthBounds(month)[1],
          )
          .map((s) => s.statementPeriodEnd)
          .sort()
          .at(-1),
        month,
      ),
  );
  const uncategorized = data.uncategorized;
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Overview</h1>
        </div>
        <ImportButton className="button primary import-main">
          <Upload size={18} />
          Import statement
        </ImportButton>
      </div>
      <div className="toolbar">
        <MonthPicker month={month} onChange={setMonth} />
      </div>
      {location.state?.importedCount !== undefined && (
        <p className="notice" role="status">
          Import complete · {location.state.importedCount} transactions added
        </p>
      )}
      <SubscriptionNotice currency={currency} />
      {!data.count && (
        <section className="welcome card">
          <Wallet size={30} />
          <h2>Your finances, in one place.</h2>
          <p>
            Import a Barclays, American Express or Revolut PDF. Your statements
            stay on this device.
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
      )}
      {data.transactions.some((t) => t.isDemo) && (
        <div className="demo-note">
          Fictitious demo data is displayed.{" "}
          <Link to="/settings">Manage demo data</Link>
        </div>
      )}
      <div className="overview-grid">
        <section className="hero card">
          <div className="hero-top">
            <span className="eyebrow">NET CASH FLOW</span>
            <span className="small-chip">{currency}</span>
          </div>
          <div className="hero-number">{money(flow.net, currency, true)}</div>
          <p className="hero-basis">By transaction date · transfers excluded</p>
          <p className="hero-comparison">
            {comparableMonths(
              data.transactions,
              month,
              monthOffset(month, -1),
              currency,
            ) ? (
              <>
                {difference >= 0 ? (
                  <ArrowUpRight size={16} />
                ) : (
                  <ArrowDownRight size={16} />
                )}
                {money(difference, currency, true)} vs previous month
              </>
            ) : (
              "Based on your imported statements"
            )}
          </p>
          {data.count > 0 && partialCoverage && (
            <p className="coverage-note">
              Partial month coverage. Some accounts need newer statements;
              totals may be incomplete.
            </p>
          )}
          <div className="hero-footer">
            <Metric label="Income" value={flow.income} currency={currency} />
            <Metric
              label="Expenses"
              value={flow.expenses}
              currency={currency}
            />
          </div>
        </section>
        <section className="card flow-card">
          <div className="section-heading">
            <h2>Cash flow</h2>
            <span className="muted">Last 6 months</span>
          </div>
          <CashChart
            showValues={false}
            data={monthlySeries(data.transactions, month, 6, currency)}
            currency={currency}
          />
        </section>
      </div>
      <AccountBalances
        transactions={data.transactions}
        period={balancePeriod}
        onPeriodChange={setBalancePeriod}
        accounts={data.accounts}
        statements={data.statements}
        month={month}
        currency={currency}
      />
      <BalanceChart
        period={balancePeriod}
        transactions={data.transactions}
        accounts={data.accounts}
        statements={data.statements}
        month={month}
        currency={currency}
      />
      <div className="content-grid">
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
          <p className="muted">
            Percentages use recorded {share} for this month. Tap a category for
            its overview.
          </p>
          {categories.length ? (
            categories.map((c) => (
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
                  <strong>
                    {money(c.amount, currency)}{" "}
                    <small>
                      {share === "income"
                        ? flow.income > 0
                          ? `${((c.amount / flow.income) * 100).toFixed(1)}%`
                          : "Unavailable"
                        : `${Math.round(c.percent)}%`}
                    </small>
                  </strong>
                </div>
                <div className="bar-track">
                  <div
                    style={{
                      width: `${Math.min(100, share === "income" ? (flow.income > 0 ? (c.amount / flow.income) * 100 : 0) : c.percent)}%`,
                      background: c.color,
                    }}
                  />
                </div>
              </Link>
            ))
          ) : (
            <p className="muted">No expenses for this month.</p>
          )}
          {uncategorized > 0 && (
            <Link
              className="review-link"
              to="/transactions?uncategorized=1&allDates=1"
            >
              {uncategorized} transactions need a category{" "}
              <ChevronRight size={16} />
            </Link>
          )}
        </section>
        <div className="right-stack">
          <section className="card insight-card">
            <p className="eyebrow">THE BIGGER PICTURE</p>
            <h2>A little perspective</h2>
            <p>{insights.text}</p>
            {insights.items.slice(0, 3).map((c) => (
              <Link
                className="insight-row"
                key={c.id}
                to={
                  c.id === "uncategorized"
                    ? "/transactions?uncategorized=1&allDates=1"
                    : `/categories/${c.id}?month=${month}`
                }
              >
                <span>{c.name}</span>
                <strong>
                  {money(c.difference, currency, true)}
                  {c.change !== undefined && (
                    <small> / {Math.round(c.change)}%</small>
                  )}
                </strong>
              </Link>
            ))}
          </section>
        </div>
      </div>
    </>
  );
}
