import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Link } from "react-router-dom";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from "recharts";
import { db } from "../storage/database";
import { saveBudget } from "../storage/budgets";
import { budgetOverview, planningForecast } from "../analytics/planning";
import { localToday } from "../analytics/reminders";
import {
  decimalMoney,
  money,
  parseMoney,
  currencyPrecision,
} from "../domain/money";
import { MonthPicker } from "../components/common";
import { ImportButton } from "../components/ImportPicker";
import { monthOffset } from "../domain/dates";

function BudgetLimit({
  categoryId,
  name,
  currency,
  limit,
  average,
}: {
  categoryId: string;
  name: string;
  currency: string;
  limit?: number;
  average?: number;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const commit = async (amount: number | undefined) => {
    setBusy(true);
    try {
      await saveBudget(categoryId, currency, amount);
      setEditing(false);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Budget could not be saved.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="budget-editor">
      {editing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            try {
              const amount = value.trim()
                ? parseMoney(value, currency)
                : undefined;
              if (amount !== undefined && amount < 0)
                throw new Error("Budget cannot be negative.");
              void commit(amount);
            } catch (e) {
              setError(e instanceof Error ? e.message : "Invalid amount.");
            }
          }}
        >
          <label>
            Monthly limit for {name}
            <input
              autoFocus
              inputMode="decimal"
              aria-label={`${name} monthly budget`}
              value={value}
              disabled={busy}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Amount"
            />
          </label>
          <div className="actions">
            <button type="submit" disabled={busy}>
              Save budget
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setEditing(false);
                setError("");
              }}
            >
              Cancel
            </button>
          </div>
          <small>
            Leave empty to remove the limit. Applies to every month in{" "}
            {currency}.
          </small>
        </form>
      ) : (
        <button
          className="budget-limit"
          aria-label={`${limit === undefined ? "Set" : "Edit"} ${name} budget`}
          onClick={() => {
            setValue(limit === undefined ? "" : decimalMoney(limit, currency));
            setEditing(true);
          }}
        >
          {limit === undefined ? "Set monthly limit" : money(limit, currency)}
        </button>
      )}
      {!editing &&
        limit === undefined &&
        average !== undefined &&
        average > 0 && (
          <button
            className="budget-suggestion"
            disabled={busy}
            onClick={() => void commit(average)}
          >
            Use usual {money(average, currency)}
          </button>
        )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
export default function Planning({
  month,
  setMonth,
  currency,
}: {
  month: string;
  setMonth: (month: string) => void;
  currency: string;
}) {
  const today = localToday();
  const earliest = [
    `${Number(today.slice(0, 4)) - 3}-01-01`,
    `${monthOffset(month, -6)}-01`,
  ].sort()[0];
  const [horizon, setHorizon] = useState<30 | 60 | 90>(30);
  const [extraCategory, setExtraCategory] = useState("");
  const data = useLiveQuery(
    async () => ({
      accounts: await db.accounts.where("currency").equals(currency).toArray(),
      statements: await db.statements.toArray(),
      categories: await db.categories.toArray(),
      settings: await db.settings.toArray(),
      transactions: await db.transactions
        .where("[currency+date]")
        .between([currency, earliest], [currency, today], true, true)
        .toArray(),
    }),
    [currency, today, earliest],
  );
  if (!data) return <p role="status">Loading your plan…</p>;
  const budgets = budgetOverview(
    data.transactions,
    data.accounts,
    data.statements,
    data.categories,
    data.settings,
    month,
    currency,
    today,
  );
  const forecast = planningForecast(
    data.transactions,
    data.accounts,
    data.statements,
    data.settings,
    currency,
    today,
    horizon,
  );
  const shown = budgets.items.filter(
    (i) =>
      i.spent > 0 || i.limit !== undefined || i.category.id === extraCategory,
  );
  const end = forecast.points.at(-1);
  const factor = 10 ** currencyPrecision(currency);
  const accounts = new Map(data.accounts.map((a) => [a.id, a.displayName]));
  const shortage = forecast.points.find(
    (p) => p.date >= today && p.balance < 0,
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Planning</h1>
          <p className="muted">
            Budgets, upcoming payments and your next balance.
          </p>
        </div>
      </div>
      {data.transactions.some((t) => t.isDemo) && (
        <p className="demo-note">
          Fictitious demo data is included in this plan.
        </p>
      )}
      <section className="card">
        <div className="section-heading">
          <h2>Monthly budgets</h2>
        </div>
        <MonthPicker month={month} onChange={setMonth} />
        <div className="planning-kpis">
          <div>
            <span>Planned limit</span>
            <strong>{money(budgets.totalLimit, currency)}</strong>
          </div>
          <div>
            <span>Spent in budgeted categories</span>
            <strong>{money(budgets.budgetedSpending, currency)}</strong>
          </div>
          <div>
            <span>
              {budgets.totalLimit >= budgets.budgetedSpending
                ? "Remaining"
                : "Over budget"}
            </span>
            <strong>
              {money(
                Math.abs(budgets.totalLimit - budgets.budgetedSpending),
                currency,
              )}
            </strong>
          </div>
        </div>
        <p className="coverage-note">
          Recorded spending only; incomplete imports can understate it.
          Transfers are excluded. {money(budgets.unbudgetedSpending, currency)}{" "}
          of spending is outside your configured budgets.
        </p>
        <label className="planning-category">
          Add a category budget
          <select
            aria-label="Add a category budget"
            value={extraCategory}
            onChange={(e) => setExtraCategory(e.target.value)}
          >
            <option value="">Choose category</option>
            {budgets.items.map((i) => (
              <option key={i.category.id} value={i.category.id}>
                {i.category.name}
              </option>
            ))}
          </select>
        </label>
        {!shown.length && (
          <p className="muted">
            Choose a category above to set your first monthly limit.
          </p>
        )}
        <div className="budget-grid">
          {shown.map((i) => (
            <article className="budget-card" key={i.category.id}>
              <div className="section-heading">
                <Link to={`/categories/${i.category.id}?month=${month}`}>
                  <h3>{i.category.name}</h3>
                </Link>
                <span>{money(i.spent, currency)} spent</span>
              </div>
              <BudgetLimit
                key={`${currency}:${i.category.id}`}
                categoryId={i.category.id}
                name={i.category.name}
                currency={currency}
                limit={i.limit}
                average={i.average}
              />
              {i.limit !== undefined && (
                <>
                  <div
                    className="budget-progress"
                    role="meter"
                    aria-label={`${i.category.name} budget used`}
                    aria-valuemin={0}
                    aria-valuemax={Math.max(i.limit, 1)}
                    aria-valuenow={Math.min(i.spent, Math.max(i.limit, 1))}
                    aria-valuetext={`${money(i.spent, currency)} spent of ${money(i.limit, currency)}`}
                  >
                    <span
                      style={{
                        width: `${Math.min(100, i.limit ? (i.spent / i.limit) * 100 : i.spent ? 100 : 0)}%`,
                      }}
                    />
                  </div>
                  <p className={i.remaining! < 0 ? "warning-text" : "muted"}>
                    {money(Math.abs(i.remaining!), currency)}{" "}
                    {i.remaining! < 0 ? "over budget" : "remaining"}
                  </p>
                </>
              )}
              {i.average !== undefined && (
                <small className="muted">
                  Usual spending {money(i.average, currency)} ·{" "}
                  {budgets.historyMonths} verified months
                </small>
              )}
            </article>
          ))}
        </div>
      </section>
      <section className="card forecast-card">
        <div className="section-heading">
          <h2>Projected total balance</h2>
          <select
            aria-label="Forecast horizon"
            value={horizon}
            onChange={(e) => setHorizon(Number(e.target.value) as 30 | 60 | 90)}
          >
            {[30, 60, 90].map((d) => (
              <option key={d} value={d}>
                {d} days
              </option>
            ))}
          </select>
        </div>
        <p className="coverage-note">
          Forecast from today ({today}); the budget month above does not change
          it. Cash and savings minus card debt—not available cash or a spending
          allowance.
        </p>
        {forecast.reason ? (
          <div className="notice">
            <p>{forecast.reason}</p>
            <ImportButton>Import recent statements</ImportButton>
          </div>
        ) : (
          end && (
            <>
              <div className="planning-kpis">
                <div>
                  <span>Estimated on {end.date}</span>
                  <strong>{money(end.balance, currency)}</strong>
                </div>
                <div>
                  <span>Expected income · next {horizon} days</span>
                  <strong>{money(forecast.income, currency)}</strong>
                </div>
                <div>
                  <span>Expected bills · next {horizon} days</span>
                  <strong>{money(forecast.bills, currency)}</strong>
                </div>
              </div>
              <div
                className="chart"
                role="img"
                aria-label="Projected total balance with higher and lower variable-spending scenarios"
              >
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart
                    data={forecast.points}
                    margin={{ top: 13, right: 8, left: -15, bottom: 0 }}
                  >
                    <CartesianGrid vertical={false} stroke="var(--line)" />
                    <XAxis
                      dataKey="date"
                      minTickGap={40}
                      tickFormatter={(v) => String(v).slice(5)}
                      tick={{ fill: "var(--muted)", fontSize: 12 }}
                    />
                    <YAxis
                      tickFormatter={(v) =>
                        `${+(Number(v) / factor / 1000).toFixed(1)}k`
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
                    <ReferenceLine y={0} stroke="var(--chart-expense)" />
                    <Line
                      name="Usual spending"
                      dataKey="balance"
                      stroke="var(--accent)"
                      strokeWidth={3}
                      dot={false}
                      isAnimationActive={false}
                    />
                    <Line
                      name="25% more variable spending"
                      dataKey="lower"
                      stroke="var(--chart-expense)"
                      strokeDasharray="4 4"
                      dot={false}
                      isAnimationActive={false}
                    />
                    <Line
                      name="25% less variable spending"
                      dataKey="upper"
                      stroke="var(--chart-net)"
                      strokeDasharray="4 4"
                      dot={false}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="chart-legend">
                <span>Solid: usual spending</span>
                <span>Dashed: variable spending ±25%</span>
              </div>
              {shortage && (
                <p className="notice warning">
                  The model drops below zero around {shortage.date}. Check
                  payment timing and recent balances before making spending
                  decisions.
                </p>
              )}
              <details>
                <summary>Forecast assumptions</summary>
                <p>
                  Starting point: {money(forecast.anchor!.total!, currency)}{" "}
                  verified on {forecast.anchor!.date}. Movements since that date
                  use imported transactions and estimated missing recurring
                  payments. Unobserved day-to-day spending is estimated from{" "}
                  {forecast.baselineMonths} complete months.
                </p>
                <p>
                  Usual variable spending: approximately{" "}
                  {money(Math.round(forecast.dailyVariable!), currency)} per
                  day. Bills use the last charge; repeating income uses the
                  lowest of the last three payments. Cancelled subscriptions and
                  transfers are excluded from future payments. No repeating
                  income detected means no income is assumed.
                </p>
                <p>
                  The dashed lines change variable spending by 25%; they are
                  scenarios, not statistical confidence limits. New purchases,
                  irregular income, rate changes, taxes and payment delays may
                  change the result. Budgets do not replace observed spending in
                  this forecast.
                </p>
              </details>
            </>
          )
        )}
      </section>
      <section className="card">
        <div className="section-heading">
          <h2>Upcoming payments</h2>
          <span className="muted">Next {horizon} days</span>
        </div>
        <p className="coverage-note">
          Expected dates and amounts from repeated imported transactions. These
          are estimates, not confirmed bills or payments.
        </p>
        {!forecast.upcoming.length ? (
          <p className="muted">
            No supported recurring pattern found yet. Import more statement
            history to identify recurring income and bills.
          </p>
        ) : (
          <ol className="payment-timeline">
            {forecast.upcoming.map((p) => (
              <li key={p.id}>
                <Link
                  to={`/transactions?allDates=1&account=${p.accountId}&search=${encodeURIComponent(p.merchant)}`}
                >
                  <div>
                    <strong>{p.merchant}</strong>
                    <span>
                      {p.date} · {accounts.get(p.accountId)} · {p.cadence}
                    </span>
                    <small>{p.evidence} payments support this estimate</small>
                  </div>
                  <strong
                    className={p.amount < 0 ? "payment-out" : "payment-in"}
                  >
                    {money(p.amount, currency, true)}
                  </strong>
                </Link>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}
