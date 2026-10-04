import { SubscriptionNotice } from "../components/SubscriptionNotice";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import {
  ArrowUpRight,
  ArrowDownRight,
  Building2,
  CheckCircle2,
  Upload,
  Wallet,
  ShieldCheck,
  ShoppingBag,
  ChevronRight,
} from "lucide-react";
import { db } from "../storage/database";
import { loadDemo } from "../storage/demo";
import { monthBounds, monthOffset } from "../domain/dates";
import {
  cashFlow,
  categorySpending,
  propertyFlow,
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
  const property = propertyFlow(current, currency);
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
  const uncategorized = current.filter(
    (t) => !t.categoryId && !t.isTransfer,
  ).length;
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">YOUR MONTH AT A GLANCE</p>
          <h1>Overview</h1>
        </div>
        <Link className="button primary import-main" to="/import">
          <Upload size={18} />
          Import statement
        </Link>
      </div>
      <div className="toolbar">
        <MonthPicker month={month} onChange={setMonth} />
        <span className="privacy-badge">
          <ShieldCheck size={15} />
          On-device only
        </span>
      </div>
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
            <Link className="button primary" to="/import">
              Import your first statement
            </Link>
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
            data={monthlySeries(data.transactions, month, 6, currency)}
            currency={currency}
          />
        </section>
      </div>
      <div className="content-grid">
        <section className="card categories-card">
          <div className="section-heading">
            <h2>Where did my money go?</h2>
            <ShoppingBag size={19} />
          </div>
          {categories.length ? (
            categories.map((c) => (
              <Link
                key={c.id}
                className="category-row"
                to={`/transactions?category=${c.id}&month=${month}`}
              >
                <div className="category-meta">
                  <span>{c.name}</span>
                  <strong>
                    {money(c.amount, currency)}{" "}
                    <small>{Math.round(c.percent)}%</small>
                  </strong>
                </div>
                <div className="bar-track">
                  <div
                    style={{ width: `${c.percent}%`, background: c.color }}
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
              to={`/transactions?uncategorized=1&month=${month}`}
            >
              {uncategorized} transactions need a category{" "}
              <ChevronRight size={16} />
            </Link>
          )}
        </section>
        <div className="right-stack">
          <Link to="/property" className="card property-card">
            <div className="section-heading">
              <h2>
                <Building2 size={18} /> Property
              </h2>
              <ChevronRight size={18} />
            </div>
            <dl className="totals">
              <div>
                <dt>Rent received</dt>
                <dd>{money(property.income, currency, true)}</dd>
              </div>
              <div>
                <dt>Costs</dt>
                <dd>{money(-property.expenses, currency)}</dd>
              </div>
              <div className="total">
                <dt>Net property</dt>
                <dd>{money(property.net, currency, true)}</dd>
              </div>
            </dl>
          </Link>
          <section className="card insight-card">
            <p className="eyebrow">THE BIGGER PICTURE</p>
            <h2>A little perspective</h2>
            <p>{insights.text}</p>
            {insights.items.slice(0, 3).map((c) => (
              <Link
                className="insight-row"
                key={c.id}
                to={`/transactions?category=${c.id}&month=${month}`}
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
      <section className="card accounts-card">
        <div className="section-heading">
          <h2>Your accounts</h2>
          <Link to="/settings">Manage</Link>
        </div>
        <div className="account-grid">
          {data.accounts.map((a) => {
            const latest = data.statements
              .filter(
                (s) =>
                  s.accountId === a.id &&
                  s.statementPeriodStart < monthBounds(month)[1],
              )
              .sort((a, b) =>
                b.statementPeriodEnd.localeCompare(a.statementPeriodEnd),
              )[0];
            const stale = !statementIsCurrent(
              latest?.statementPeriodEnd,
              month,
            );
            return (
              <div className="account-tile" key={a.id}>
                <span
                  className={`bank-mark ${a.institution === "Barclays" ? "barclays" : a.institution === "Revolut" ? "revolut" : "amex"}`}
                >
                  {a.institution === "Barclays"
                    ? "B"
                    : a.institution === "Revolut"
                      ? "R"
                      : "AE"}
                </span>
                <div>
                  <strong>{a.institution}</strong>
                  <p>
                    {a.displayName} · {a.maskedAccountIdentifier}
                  </p>
                  {latest?.closingBalance !== undefined && (
                    <div className="account-balance">
                      <span>
                        {a.accountType === "credit"
                          ? latest.closingBalance <= 0
                            ? "Statement amount owed"
                            : "Statement credit"
                          : "Statement closing balance"}
                      </span>
                      <strong>
                        {money(
                          a.accountType === "credit"
                            ? Math.abs(latest.closingBalance)
                            : latest.closingBalance,
                          a.currency,
                        )}
                      </strong>
                    </div>
                  )}
                  <span className={stale ? "stale" : "fresh"}>
                    {stale ? "Update needed" : <CheckCircle2 size={12} />}{" "}
                    {latest
                      ? `Statement to ${latest.statementPeriodEnd}`
                      : "No statement imported"}
                  </span>
                </div>
              </div>
            );
          })}
          {!data.accounts.length && (
            <p className="muted">
              Accounts appear when you import a statement.
            </p>
          )}
        </div>
      </section>
      <p className="local-note">
        <ShieldCheck size={14} /> Financial data stays in this browser. Back up
        regularly in Settings.
      </p>
    </>
  );
}
