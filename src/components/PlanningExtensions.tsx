import { UKDateInput } from "./UKDateInput";
import { chartTickFontSize, useRootFontSize } from "./useRootFontSize";
import { reviewDate } from "../analytics/month-review-details";
import { Sheet, SheetFooter } from "./Sheet";
import { ContextHelp } from "./ContextHelp";
import { displayMerchant } from "../domain/presentation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Link } from "react-router-dom";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  Account,
  MonthlyBudget,
  Pot,
  RecurringSeries,
  Scenario,
  Statement,
  Transaction,
} from "../domain/models";
import { db } from "../storage/database";
import {
  confirmPotContribution,
  removePot,
  removeScenario,
  saveDebtTerms,
  saveMonthlyBudget,
  savePot,
  saveRecurringSeries,
  saveScenario,
} from "../storage/planning-v2";
import { auditedMutation, undoChange } from "../storage/audit";
import {
  debtPayoff,
  debtBalances,
  detectRecurringSeries,
  potProgress,
  potsOverview,
  recurringCalendar,
  rolloverBudget,
  scenarioForecast,
} from "../analytics/planning-v2";
import { effectiveTransactions } from "../analytics/effective-transactions";
import { reportingPeriodLabel } from "../domain/period";
import {
  compactMoney,
  currencyPrecision,
  decimalMoney,
  money,
  parseMoney,
  safeSum,
} from "../domain/money";
import { formatUkDate, monthBounds, monthLabel } from "../domain/dates";
import { localToday } from "../analytics/reminders";
import { projectedReportingTransactions, convertMinor } from "../analytics/fx";
import { monthCoverage } from "../analytics/coverage";
import { reportingPeriod } from "../domain/period";
import { readBudget, budgetKey } from "../analytics/planning";
import { detectSubscriptions } from "../analytics/subscriptions";
import { resolveRecurringSeries } from "../analytics/recurring-identity";
import { saveRecurringMatchDecision } from "../storage/recurring-identity";
import "./planning-v2.css";
import { Toast } from "./Toast";
import {
  KeyValueRow,
  ListRow,
  SegmentedControl,
  StatusChip,
  WarningBox,
} from "./UIPrimitives";

function useFeedback(onUndo?: () => void | Promise<void>) {
  const [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [changeId, setChange] = useState(""),
    [busy, setBusy] = useState(false);
  const run = async (
    operation: () => Promise<{ changeId: string }>,
    message: string,
  ) => {
    setBusy(true);
    setError("");
    try {
      const result = await operation();
      setChange(result.changeId);
      setMessage(message);
      return true;
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "This change could not be saved.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  };
  const feedback = (
    <>
      {error && <p role="alert">{error}</p>}
      {message && (
        <Toast
          message={message}
          id={changeId}
          undo={
            changeId
              ? async () => {
                  await undoChange(changeId);
                  await onUndo?.();
                  setChange("");
                  setMessage("Change undone.");
                }
              : undefined
          }
        />
      )}
    </>
  );
  return { run, feedback, busy, setError };
}
export function PotsPanel({
  currency,
  month,
}: {
  currency: string;
  month: string;
}) {
  const data = useLiveQuery(
    async () => ({
      pots: await db.pots.toArray(),
      rates: await db.fxRates.toArray(),
      valuations: await db.valuations.toArray(),
      accounts: await db.accounts.toArray(),
      statements: await db.statements.toArray(),
      categories: await db.categories.toArray(),
      transactions: await db.transactions
        .where("date")
        .between(
          `${Number(localToday().slice(0, 4)) - 3}-01-01`,
          localToday(),
          true,
          true,
        )
        .toArray(),
    }),
    [currency],
  );
  const [editing, setEditing] = useState<Pot | null>(),
    [name, setName] = useState(""),
    [type, setType] = useState<Pot["type"]>("goal"),
    [target, setTarget] = useState(""),
    [date, setDate] = useState(""),
    [account, setAccount] = useState(""),
    [category, setCategory] = useState("");
  const [contribution, setContribution] = useState<Record<string, string>>({});
  const [potCadence, setPotCadence] =
    useState<NonNullable<Pot["cadence"]>>("annual");
  const f = useFeedback();
  if (!data) return <p role="status">Loading savings pots…</p>;
  const edit = (pot: Pot | null) => {
    setEditing(pot);
    setName(pot?.name ?? "");
    setType(pot?.type ?? "goal");
    setPotCadence(pot?.cadence ?? "annual");
    setTarget(pot ? decimalMoney(pot.targetMinor, pot.currency) : "");
    setDate(pot?.targetDate ?? "");
    setAccount(pot?.linkedAccountId ?? "");
    setCategory(pot?.linkedCategoryId ?? "");
  };
  const annual = detectRecurringSeries(
    data.transactions,
    currency,
    localToday(),
  ).filter(
    (s) =>
      s.cadence === "annual" &&
      s.expectedAmountMinor < 0 &&
      !data.pots.some((p) => p.name === s.name),
  );
  const suggestionDate = reviewDate(monthBounds(month)[1], localToday());
  const overview = potsOverview(
    data.pots,
    data.accounts,
    data.statements,
    data.transactions,
    currency,
    suggestionDate,
    data.rates,
    data.valuations,
  );
  return (
    <>
      <section className="card">
        <div className="section-heading">
          <div className="context-help-heading">
            <h2>Pots and goals</h2>
            <ContextHelp title="Pots and goals" label="About pots and goals">
              <p>
                Earmarks for future costs. Set-aside amounts stay in your
                account balances.
              </p>
              <p>
                Progress uses the contributions you record, or the balance of a
                linked savings account.
              </p>
            </ContextHelp>
          </div>
          <button onClick={() => edit(null)}>New pot</button>
        </div>
        {annual.length > 0 && (
          <details>
            <summary>Suggested annual-cost pots</summary>
            {annual.map((s) => (
              <button
                className="planning-v2-object"
                key={s.id}
                onClick={() => {
                  edit(null);
                  setName(s.name);
                  setType("sinking");
                  setTarget(decimalMoney(-s.expectedAmountMinor, currency));
                  setDate(s.nextDue);
                }}
              >
                <span>
                  {s.name}
                  <small>Annual cost seen in your statements</small>
                </span>
                <strong>{money(-s.expectedAmountMinor, currency)}</strong>
              </button>
            ))}
          </details>
        )}
        {editing !== undefined && (
          <Sheet
            title={editing ? "Edit pot" : "New pot"}
            onClose={() => {
              if (!f.busy) setEditing(undefined);
            }}
          >
            <form
              id="pot-form"
              className="planning-v2-form"
              onSubmit={(e) => {
                e.preventDefault();
                void (async () => {
                  try {
                    const potCurrency = editing?.currency ?? currency;
                    const pot: Pot = {
                      id: editing?.id ?? crypto.randomUUID(),
                      name,
                      type,
                      cadence: type === "sinking" ? potCadence : undefined,
                      targetMinor: parseMoney(target, potCurrency),
                      currency: potCurrency,
                      targetDate: date || undefined,
                      linkedAccountId: account || undefined,
                      linkedCategoryId: category || undefined,
                      contributions: editing?.contributions ?? [],
                      createdAt: editing?.createdAt ?? new Date().toISOString(),
                    };
                    if (await f.run(() => savePot(pot), "Pot saved."))
                      setEditing(undefined);
                  } catch (e) {
                    f.setError(
                      e instanceof Error
                        ? e.message
                        : "Enter a valid pot amount.",
                    );
                  }
                })();
              }}
            >
              <label>
                Name
                <input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label>
                Type
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value as Pot["type"])}
                >
                  <option value="goal">Savings goal</option>
                  <option value="sinking">Irregular cost</option>
                </select>
              </label>
              <label>
                Target amount
                <input
                  required
                  inputMode="decimal"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                />
              </label>
              {type === "sinking" && (
                <label>
                  Cost frequency
                  <select
                    disabled={type !== "sinking"}
                    value={potCadence}
                    onChange={(e) =>
                      setPotCadence(
                        e.target.value as NonNullable<Pot["cadence"]>,
                      )
                    }
                  >
                    <option value="monthly">Monthly</option>
                    <option value="quarterly">Quarterly</option>
                    <option value="annual">Annual</option>
                  </select>
                </label>
              )}
              <label>
                Due date
                <UKDateInput value={date} onChange={(e) => setDate(e)} />
              </label>
              <label>
                How progress is tracked
                <select
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                >
                  <option value="">Contributions</option>
                  {data.accounts
                    .filter((a) => a.accountType === "savings")
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.displayName}
                      </option>
                    ))}
                </select>
              </label>
              {type === "sinking" && (
                <label>
                  Spending category
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                  >
                    <option value="">Choose category</option>
                    {data.categories
                      .filter(
                        (c) =>
                          c.kind === "expense" && !c.parentId && !c.archived,
                      )
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </select>
                </label>
              )}
              <SheetFooter>
                <div className="actions">
                  <button className="primary" form="pot-form" disabled={f.busy}>
                    Save pot
                  </button>
                  <button type="button" onClick={() => setEditing(undefined)}>
                    Cancel
                  </button>
                </div>
              </SheetFooter>
              {f.feedback}
            </form>
          </Sheet>
        )}
        {f.feedback}
      </section>
      <div className="budget-grid">
        {data.pots.map((p) => {
          const linked = p.linkedAccountId
            ? data.accounts.find((a) => a.id === p.linkedAccountId)
            : undefined;
          const info = overview.items.find((i) => i.pot.id === p.id)!;
          const balance = info.progress.linkedUnavailable
            ? undefined
            : info.progress.savedMinor;
          const progress = info.progress;
          return (
            <article className="card" key={p.id}>
              <button className="planning-v2-object" onClick={() => edit(p)}>
                <span>
                  <strong>{p.name}</strong>
                  <small>
                    {p.type === "sinking" ? "Irregular cost" : "Savings goal"}
                    {progress.nextTargetDate && (
                      <>
                        {" "}
                        · due{" "}
                        <time
                          className="date-value"
                          dateTime={progress.nextTargetDate}
                        >
                          {formatUkDate(progress.nextTargetDate)}
                        </time>
                      </>
                    )}
                  </small>
                </span>
                <strong>
                  {progress.linkedUnavailable
                    ? "Not imported"
                    : money(progress.savedMinor, p.currency)}
                  <small>of {money(p.targetMinor, p.currency)}</small>
                </strong>
              </button>
              <div
                className="pot-progress"
                role="progressbar"
                aria-label={`${p.name} saved`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progress.progress}
              >
                <span style={{ width: `${progress.progress}%` }} />
              </div>
              <p>
                {money(progress.monthlyMinor, p.currency)} a month needed
                {progress.covered ? " · Covered by pot" : ""}
              </p>
              <div className="context-help-heading">
                <StatusChip
                  tone={
                    progress.linkedUnavailable || !progress.onTrack
                      ? "warning"
                      : "complete"
                  }
                >
                  {progress.linkedUnavailable
                    ? "Balance unavailable"
                    : progress.onTrack
                      ? "On track"
                      : `Behind by ${money(progress.behindMinor, p.currency)}`}
                </StatusChip>
                <small className="muted">
                  As of{" "}
                  <time className="date-value" dateTime={suggestionDate}>
                    {formatUkDate(suggestionDate)}
                  </time>
                </small>
                <ContextHelp
                  title={`${p.name}: monthly suggestion`}
                  label={`How this suggestion works for ${p.name}`}
                >
                  <p>
                    Calculated as of{" "}
                    <time className="date-value" dateTime={suggestionDate}>
                      {formatUkDate(suggestionDate)}
                    </time>{" "}
                    for the calendar month, including confirmed contributions. A
                    payday-aligned review uses its own period end.
                  </p>
                  {info.sharedAccount && (
                    <p>
                      This savings balance funds more than one goal; totals
                      count it once.
                    </p>
                  )}
                </ContextHelp>
              </div>
              {linked ? (
                <p className="muted">
                  From {linked.displayName}
                  {balance === undefined ? " · Import a verified balance" : ""}.
                  {info.sourceDate && (
                    <>
                      {" "}
                      As of{" "}
                      <time className="date-value" dateTime={info.sourceDate}>
                        {formatUkDate(info.sourceDate)}
                      </time>
                      .
                    </>
                  )}
                  {info.sharedAccount ? " Shared savings balance." : ""}
                </p>
              ) : (
                <form
                  className="planning-v2-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    try {
                      const existing = p.contributions.find(
                        (c) => c.month === month,
                      )?.amountMinor;
                      const amount = parseMoney(
                        contribution[p.id] ??
                          decimalMoney(
                            existing ?? progress.monthlyMinor,
                            p.currency,
                          ),
                        p.currency,
                      );
                      void f.run(
                        () => confirmPotContribution(p.id, month, amount),
                        `${p.name} contribution confirmed.`,
                      );
                    } catch (e) {
                      f.setError(
                        e instanceof Error
                          ? e.message
                          : "Invalid contribution.",
                      );
                    }
                  }}
                >
                  <label>
                    {monthLabel(month)} contribution
                    <input
                      inputMode="decimal"
                      aria-label={`${p.name} contribution`}
                      value={
                        contribution[p.id] ??
                        decimalMoney(
                          p.contributions.find((c) => c.month === month)
                            ?.amountMinor ?? progress.monthlyMinor,
                          p.currency,
                        )
                      }
                      onChange={(e) =>
                        setContribution({
                          ...contribution,
                          [p.id]: e.target.value,
                        })
                      }
                    />
                  </label>
                  <button disabled={f.busy}>Confirm contribution</button>
                </form>
              )}
              <details className="object-menu">
                <summary>Pot options</summary>{" "}
                <button
                  onClick={() => {
                    if (
                      window.confirm(
                        `Delete ${p.name}? You can undo this change.`,
                      )
                    )
                      void f.run(() => removePot(p.id), "Pot deleted.");
                  }}
                >
                  Delete pot
                </button>
              </details>
            </article>
          );
        })}
      </div>
      {!data.pots.length && editing === undefined && (
        <p className="muted">
          Add a goal or prepare for a bill that arrives once a year.
        </p>
      )}
    </>
  );
}

export function MonthlyBudgetsPanel({
  currency,
  month,
}: {
  currency: string;
  month: string;
}) {
  const data = useLiveQuery(
    async () => ({
      budgets: await db.budgets.where("currency").equals(currency).toArray(),
      categories: await db.categories.toArray(),
      transactions: await db.transactions
        .where("date")
        .between("1900-01-01", "9999-12-31", true, true)
        .toArray(),
      rates: await db.fxRates.toArray(),
      accounts: await db.accounts.toArray(),
      statements: await db.statements.toArray(),
      closes: await db.monthCloses.toArray(),
      settings: await db.settings.toArray(),
    }),
    [currency],
  );
  const [category, setCategory] = useState("groceries"),
    [amount, setAmount] = useState(""),
    [rollover, setRollover] = useState<MonthlyBudget["rollover"]>("none");
  const [editingBudget, setEditingBudget] = useState(false);
  const f = useFeedback();
  if (!data) return <p role="status">Loading monthly budgets…</p>;
  const selected = data.budgets
    .filter((b) => b.month <= month)
    .sort((a, b) => b.month.localeCompare(a.month));
  const budgets = [
    ...new Map(
      selected.map((b) => [b.categoryId, b] as const).reverse(),
    ).values(),
  ].map((b) => ({ ...b, id: `${currency}:${b.categoryId}:${month}`, month }));
  for (const category of data.categories) {
    const limit = readBudget(
      data.settings.find((s) => s.key === budgetKey(currency, category.id))
        ?.value,
    );
    if (
      limit !== undefined &&
      !budgets.some((b) => b.categoryId === category.id)
    )
      budgets.push({
        id: `${currency}:${category.id}:${month}`,
        categoryId: category.id,
        month,
        currency,
        amountMinor: limit,
        rollover: "none",
      });
  }
  const projection = projectedReportingTransactions(
    effectiveTransactions(data.transactions),
    currency,
    data.rates,
  );
  const analytical = projection.transactions;
  const coverage = monthCoverage(
    data.accounts,
    data.statements,
    data.transactions,
    month,
    "*",
    localToday(),
    reportingPeriod(month, data.settings, data.transactions),
  );
  return (
    <section className="card">
      <div className="section-heading">
        <div className="context-help-heading">
          <h2>Monthly budgets</h2>
          <ContextHelp
            title="How budgets work"
            label="How budgets work"
            tone={
              coverage.status !== "Complete" || projection.missing.length
                ? "warning"
                : "help"
            }
          >
            <p>
              {reportingPeriodLabel(month, data.settings, data.transactions)}.
              Budget plus carried amount, minus spending, equals what is left.
            </p>
            {coverage.status !== "Complete" && (
              <p>
                Recorded spending is partial until all accounts are imported and
                verified.
              </p>
            )}
            {projection.missing.length > 0 && (
              <p>
                {projection.missing.length} transaction
                {projection.missing.length === 1 ? "" : "s"} need
                {projection.missing.length === 1 ? "s" : ""} exchange rates;
                totals are partial.
              </p>
            )}
            {projection.converted && <p>≈ Includes currency conversions.</p>}
          </ContextHelp>
        </div>
      </div>
      {(coverage.status !== "Complete" ||
        projection.missing.length > 0 ||
        projection.converted) && (
        <div className="context-help-heading">
          <span className="coverage-note">
            {coverage.status !== "Complete"
              ? coverage.status === "No data"
                ? "No spending data"
                : `${coverage.status} spending`
              : ""}
            {projection.missing.length
              ? `${coverage.status !== "Complete" ? " · " : ""}Rates needed for ${projection.missing.length} transaction${projection.missing.length === 1 ? "" : "s"} · Partial totals`
              : ""}
            {projection.converted
              ? `${coverage.status !== "Complete" || projection.missing.length ? " · " : ""}≈ Converted`
              : ""}
          </span>
        </div>
      )}
      {editingBudget && (
        <Sheet
          title="Monthly budget"
          onClose={() => {
            if (!f.busy) setEditingBudget(false);
          }}
        >
          <form
            id="monthly-budget-form"
            className="planning-v2-form"
            onSubmit={(e) => {
              e.preventDefault();
              try {
                void f
                  .run(
                    () =>
                      saveMonthlyBudget({
                        id: `${currency}:${category}:${month}`,
                        categoryId: category,
                        month,
                        currency,
                        amountMinor: parseMoney(amount, currency),
                        rollover,
                      }),
                    "Monthly budget saved.",
                  )
                  .then((ok) => {
                    if (ok) setEditingBudget(false);
                  });
              } catch (e) {
                f.setError(
                  e instanceof Error ? e.message : "Invalid budget amount.",
                );
              }
            }}
          >
            <label>
              Category
              <select
                value={category}
                onChange={(e) => {
                  setCategory(e.target.value);
                  const b = budgets.find(
                    (b) => b.categoryId === e.target.value,
                  );
                  setAmount(b ? decimalMoney(b.amountMinor, currency) : "");
                  setRollover(b?.rollover ?? "none");
                }}
              >
                {data.categories
                  .filter(
                    (c) => !c.parentId && !c.archived && c.kind === "expense",
                  )
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              {monthLabel(month)} budget
              <input
                required
                inputMode="decimal"
                aria-label="Monthly rollover budget amount"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
            <label>
              Carry into next month
              <select
                value={rollover}
                onChange={(e) =>
                  setRollover(e.target.value as MonthlyBudget["rollover"])
                }
              >
                <option value="none">Nothing</option>
                <option value="surplus">Surplus only</option>
                <option value="both">Both</option>
              </select>
            </label>
            {rollover === "both" && (
              <p className="muted">Carry forward both surplus and overspend.</p>
            )}
            {f.feedback}
            <SheetFooter>
              <button
                className="primary"
                form="monthly-budget-form"
                disabled={f.busy || !amount}
              >
                Save monthly budget
              </button>
            </SheetFooter>
          </form>
        </Sheet>
      )}
      {f.feedback}
      <div className="budget-grid">
        {budgets.map((b) => {
          const missingCategoryRate = projection.missing.some(
            (t) =>
              t.categoryId === b.categoryId &&
              t.date <
                reportingPeriod(month, data.settings, data.transactions)[1],
          );
          const r = rolloverBudget(
            b,
            data.budgets,
            analytical,
            data.closes,
            localToday(),
            data.settings,
            data.transactions,
          );
          return (
            <article className="budget-card" key={b.id}>
              <div className="section-heading">
                <button
                  className="budget-category-name"
                  title="Edit budget"
                  aria-haspopup="dialog"
                  onClick={() => {
                    setCategory(b.categoryId);
                    setAmount(decimalMoney(b.amountMinor, currency));
                    setRollover(b.rollover);
                    setEditingBudget(true);
                  }}
                >
                  <span
                    className="category-colour-dot"
                    aria-hidden="true"
                    style={{
                      background:
                        data.categories.find((c) => c.id === b.categoryId)
                          ?.color ?? "var(--muted)",
                    }}
                  />
                  {data.categories.find((c) => c.id === b.categoryId)?.name ??
                    "Category"}
                </button>
                <strong>
                  {missingCategoryRate
                    ? "Left: unavailable"
                    : `${money(r.leftMinor, currency)} ${month < localToday().slice(0, 7) ? (r.leftMinor < 0 ? "overspent" : "unspent") : "left"}`}
                </strong>
              </div>
              <p>
                <span className="amount">{money(b.amountMinor, currency)}</span>{" "}
                budget{" "}
                <span className="amount">
                  + {money(r.carryMinor, currency)}
                </span>{" "}
                carried{" "}
                {missingCategoryRate ? (
                  "− Spending needs exchange rates"
                ) : (
                  <>
                    <span className="amount">
                      − {money(r.spentMinor, currency)}
                    </span>{" "}
                    spent
                  </>
                )}
              </p>
              <div className="context-help-heading">
                <small className="muted">
                  {month < localToday().slice(0, 7)
                    ? `Ended ${formatUkDate(new Date(Date.parse(`${monthBounds(month)[1]}T12:00:00Z`) - 86400000).toISOString().slice(0, 10))}`
                    : `${r.daysRemaining} day${r.daysRemaining === 1 ? "" : "s"} remaining`}
                  {r.provisional ? " · Provisional carry" : ""}
                </small>
                {r.provisional && (
                  <ContextHelp
                    title="Provisional budget carry"
                    label={`About provisional carry for ${data.categories.find((c) => c.id === b.categoryId)?.name ?? "this category"}`}
                    tone="warning"
                  >
                    <p>
                      Carry is provisional until previous months are closed.
                    </p>
                  </ContextHelp>
                )}
              </div>
            </article>
          );
        })}
      </div>
      {!budgets.length && <p>No budgets yet.</p>}
      <div className="budget-footer-actions">
        <button onClick={() => setEditingBudget(true)}>Set budget</button>
      </div>
    </section>
  );
}

export function CalendarPanel({
  currency,
  month,
}: {
  currency: string;
  month: string;
}) {
  const data = useLiveQuery(
    async () => ({
      series: await db.recurringSeries.toArray(),
      settings: await db.settings.toArray(),
      accounts: await db.accounts.toArray(),
      rates: await db.fxRates.toArray(),
      transactions: await db.transactions
        .where("date")
        .between(
          `${Number(month.slice(0, 4)) - 3}-01-01`,
          `${month}-31`,
          true,
          true,
        )
        .toArray(),
    }),
    [currency, month],
  );
  const [day, setDay] = useState(""),
    [editing, setEditing] = useState<RecurringSeries>(),
    [name, setName] = useState(""),
    [cadence, setCadence] = useState<RecurringSeries["cadence"]>("monthly"),
    [amount, setAmount] = useState(""),
    [due, setDue] = useState(""),
    [end, setEnd] = useState(""),
    [account, setAccount] = useState("");
  const [moneyDirection, setMoneyDirection] = useState("out");
  const [matching, setMatching] = useState<{
    confirmed: RecurringSeries;
    detected: RecurringSeries;
  }>();
  const f = useFeedback();
  if (!data) return <p role="status">Loading payment calendar…</p>;
  const detected = [
    ...new Set(data.transactions.map((t) => t.currency)),
  ].flatMap((native) =>
    detectRecurringSeries(
      data.transactions,
      native,
      localToday(),
      data.settings,
    ),
  );
  const { series, proposals: possibleMatches } = resolveRecurringSeries(
    data.series,
    detected,
    data.settings,
  );
  const priceRises = [...new Set(data.transactions.map((t) => t.currency))]
    .flatMap((native) =>
      detectSubscriptions(
        data.transactions,
        data.settings,
        native,
        localToday(),
      ),
    )
    .filter(
      (s) =>
        s.increase > 0 &&
        s.needsReview &&
        !s.stale &&
        !data.series.some(
          (series) =>
            series.matchKey === s.key &&
            (series.status === "ignored" ||
              (series.endDate && series.endDate < localToday())),
        ),
    );
  const formCurrency =
    data.accounts.find((a) => a.id === account)?.currency ??
    editing?.currency ??
    currency;
  const items = recurringCalendar(
    series,
    data.transactions,
    month,
    "*",
    data.settings,
  );
  const missingRates = items.some(
    (i) =>
      i.currency !== currency &&
      !convertMinor(i.amountMinor, i.currency, currency, i.date, data.rates),
  );
  const date = day.startsWith(month) ? day : `${month}-01`;
  const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const days = new Date(
    Date.parse(`${monthBounds(month)[1]}T00:00:00Z`) - 86400000,
  ).getUTCDate();
  const offset = (new Date(`${month}-01T00:00:00Z`).getUTCDay() + 6) % 7;
  const edit = (s?: RecurringSeries) => {
    const target =
      s ??
      ({
        id: crypto.randomUUID(),
        matchKey: crypto.randomUUID(),
        accountId: data.accounts[0]?.id ?? "",
        name: "",
        currency,
        cadence: "monthly",
        expectedAmountMinor: 0,
        amountHistory: [],
        nextDue: localToday(),
        status: "active",
      } as RecurringSeries);
    setEditing(target);
    setName(
      displayMerchant({ merchant: target.name, description: target.name }),
    );
    setCadence(target.cadence);
    setAmount(
      decimalMoney(Math.abs(target.expectedAmountMinor), target.currency),
    );
    setMoneyDirection(target.expectedAmountMinor > 0 ? "in" : "out");
    setDue(target.nextDue);
    setEnd(target.endDate ?? "");
    setAccount(target.accountId);
  };
  return (
    <section className="card">
      <div className="section-heading">
        <div className="context-help-heading">
          <h2>Payments calendar</h2>
          <ContextHelp
            title="Payments calendar"
            label="About the payments calendar"
            tone={missingRates ? "warning" : "help"}
          >
            <p>
              Filled: imported payments. Outline: expected payments. Expected
              amounts are estimates.
            </p>
            {items.some((i) => i.currency !== currency) && (
              <p>
                ≈ Daily totals use cached reporting-currency conversions;
                individual payments keep their original currency.
              </p>
            )}
            {missingRates && (
              <p>
                Some payments need exchange rates. Daily totals are partial
                until rates are available.
              </p>
            )}
          </ContextHelp>
        </div>
        <button disabled={!data.accounts.length} onClick={() => edit()}>
          New recurring payment
        </button>
      </div>
      <div className="context-help-heading">
        <span className="muted">
          Filled: imported · Outline: estimated
          {items.some((i) => i.currency !== currency)
            ? " · ≈ Converted totals"
            : ""}
        </span>
        {missingRates && (
          <span className="coverage-note">Partial totals · Rates needed</span>
        )}
      </div>
      {possibleMatches.length > 0 && (
        <WarningBox
          severity="warning"
          title={`${possibleMatches.length} possible recurring bill match${possibleMatches.length === 1 ? "" : "es"}`}
        >
          <div className="context-help-heading">
            <span>Possible duplicates in expected totals</span>
            <ContextHelp
              title="Possible recurring bill matches"
              label="About possible recurring bill matches"
              tone="warning"
            >
              <p>
                Similar entries remain separate until you confirm they are the
                same bill. Expected totals may include both.
              </p>
            </ContextHelp>
          </div>
          <button onClick={() => setMatching(possibleMatches[0])}>
            Review possible match
          </button>
        </WarningBox>
      )}
      {priceRises.length > 0 && (
        <aside className="notice warning" aria-label="Recurring price changes">
          <div className="section-heading">
            <h3>Recurring prices changed</h3>
            <Link to="/subscriptions">Review price changes</Link>
          </div>
          {priceRises.map((s) => (
            <div className="planning-v2-object" key={s.key}>
              <span>
                <strong>{s.merchant}</strong>
                <small>
                  Was {money(s.previousMedian!, s.currency)}, now{" "}
                  {money(s.amount, s.currency)}. Up{" "}
                  {money(s.increase, s.currency)} (+
                  {Math.round(s.increasePercent ?? 0)}%).
                </small>
                <small>
                  {s.annual !== undefined
                    ? `${money(safeSum(Array.from({ length: s.annual / s.amount }, () => s.increase)), s.currency)} more per year at this price.`
                    : ""}
                </small>
              </span>
            </div>
          ))}
        </aside>
      )}
      <div className="calendar-scroll">
        <div className="calendar-grid">
          {weekdays.map((d) => (
            <div className="calendar-weekday" key={d}>
              {d}
            </div>
          ))}
          {Array.from({ length: offset }, (_, i) => (
            <div key={`blank${i}`} aria-hidden="true" />
          ))}
          {Array.from({ length: days }, (_, i) => {
            const d = `${month}-${String(i + 1).padStart(2, "0")}`,
              rows = items.filter((t) => t.date === d),
              actual = -safeSum(
                rows
                  .filter((t) => !t.expected && t.amountMinor < 0)
                  .map(
                    (t) =>
                      convertMinor(
                        t.amountMinor,
                        t.currency,
                        currency,
                        t.date,
                        data.rates,
                      )?.amount ?? 0,
                  ),
              ),
              expected = -safeSum(
                rows
                  .filter((t) => t.expected && t.amountMinor < 0)
                  .map(
                    (t) =>
                      convertMinor(
                        t.amountMinor,
                        t.currency,
                        currency,
                        t.date,
                        data.rates,
                      )?.amount ?? 0,
                  ),
              );
            const dayMissing = rows.some(
              (t) =>
                t.amountMinor < 0 &&
                !convertMinor(
                  t.amountMinor,
                  t.currency,
                  currency,
                  t.date,
                  data.rates,
                ),
            );
            return (
              <button
                className="calendar-day"
                key={d}
                aria-pressed={date === d}
                aria-label={`${formatUkDate(d)}, ${rows.length} payment${rows.length === 1 ? "" : "s"}, ${dayMissing ? "Money out unavailable; exchange rates needed" : `actual money out ${compactMoney(actual, currency)}, expected ${compactMoney(expected, currency)}`}`}
                onClick={() => setDay(d)}
              >
                <strong>{i + 1}</strong>
                {dayMissing && <span>n/a</span>}
                {actual > 0 && (
                  <span className="actual-payment">
                    {compactMoney(actual, currency)}
                  </span>
                )}
                {expected > 0 && (
                  <span className="expected-payment">
                    {compactMoney(expected, currency)}
                  </span>
                )}
                {rows.some((t) => t.payday) && (
                  <span className="payday-marker">Pay</span>
                )}
              </button>
            );
          })}
        </div>
      </div>
      <h3>{formatUkDate(date)}</h3>
      <div className="planning-v2-list">
        {items
          .filter((i) => i.date === date)
          .map((i) => (
            <div className="planning-v2-object" key={i.id}>
              <span>
                {i.transactionId ? (
                  <Link to={`/transactions/${i.transactionId}`}>
                    {displayMerchant({ merchant: i.name, description: i.name })}
                  </Link>
                ) : (
                  <button
                    onClick={() =>
                      edit(series.find((s) => s.id === i.seriesId))
                    }
                  >
                    {displayMerchant({ merchant: i.name, description: i.name })}
                  </button>
                )}
                <small>
                  {i.expected ? "Expected" : "Imported"}
                  {i.payday ? " · Payday" : ""}
                  {" · "}
                  {data.accounts.find((a) => a.id === i.accountId)
                    ?.displayName ?? "Account unavailable"}
                </small>
              </span>
              <strong>{money(i.amountMinor, i.currency)}</strong>
            </div>
          ))}
      </div>
      {!items.some((i) => i.date === date) && (
        <p className="muted">No payments on this day.</p>
      )}
      <details>
        <summary>Recurring series ({series.length})</summary>
        {series.map((s) => (
          <button
            className="planning-v2-object"
            key={s.id}
            onClick={() => edit(s)}
          >
            <span>
              {displayMerchant({ merchant: s.name, description: s.name })}
              <small>
                {s.cadence[0].toUpperCase() + s.cadence.slice(1)} ·{" "}
                {s.status[0].toUpperCase() + s.status.slice(1)} ·{" "}
                {data.series.some((d) => d.id === s.id)
                  ? "Confirmed"
                  : "Detected, confirm or edit"}
              </small>
            </span>
            <strong>{money(s.expectedAmountMinor, s.currency)}</strong>
          </button>
        ))}
      </details>
      {matching && (
        <Sheet
          title={`Is this the same as ${displayMerchant({ merchant: matching.confirmed.name, description: matching.confirmed.name })}?`}
          onClose={() => {
            if (!f.busy) setMatching(undefined);
          }}
        >
          <p>
            Confirming uses the saved amount and due date for one expected bill.
            Imported transactions and balances stay unchanged.
          </p>
          {[
            { label: "Saved payment", value: matching.confirmed },
            { label: "Detected payment", value: matching.detected },
          ].map(({ label, value }) => (
            <section key={label} aria-label={label}>
              <h3>{label}</h3>
              <KeyValueRow
                label="Bill"
                value={displayMerchant({
                  merchant: value.name,
                  description: value.name,
                })}
              />
              <KeyValueRow
                label="Amount"
                value={money(value.expectedAmountMinor, value.currency)}
              />
              <KeyValueRow
                label="Account"
                value={
                  data.accounts.find((a) => a.id === value.accountId)
                    ?.displayName ?? "Account unavailable"
                }
              />
              <KeyValueRow
                label="Next due"
                value={formatUkDate(value.nextDue)}
              />
              <KeyValueRow
                label="Frequency"
                value={value.cadence[0].toUpperCase() + value.cadence.slice(1)}
              />
            </section>
          ))}
          {f.feedback}
          <SheetFooter>
            <button
              disabled={f.busy}
              onClick={() =>
                void f
                  .run(
                    () =>
                      saveRecurringMatchDecision(
                        matching.confirmed.id,
                        matching.detected,
                        "separate",
                      ),
                    "Recurring bills kept separate.",
                  )
                  .then((ok) => {
                    if (ok) setMatching(undefined);
                  })
              }
            >
              Keep separate
            </button>
            <button
              className="primary"
              disabled={f.busy}
              onClick={() =>
                void f
                  .run(
                    () =>
                      saveRecurringMatchDecision(
                        matching.confirmed.id,
                        matching.detected,
                        "same",
                      ),
                    "Recurring bill match confirmed.",
                  )
                  .then((ok) => {
                    if (ok) setMatching(undefined);
                  })
              }
            >
              Same bill
            </button>
          </SheetFooter>
        </Sheet>
      )}
      {editing && (
        <Sheet
          title="Recurring payment"
          onClose={() => {
            if (!f.busy) setEditing(undefined);
          }}
        >
          <form
            id="recurring-payment-form"
            className="planning-v2-form"
            onSubmit={(e) => {
              e.preventDefault();
              try {
                void f
                  .run(
                    () =>
                      saveRecurringSeries({
                        ...editing,
                        name,
                        accountId: account,
                        cadence,
                        currency: formCurrency,
                        expectedAmountMinor:
                          Math.abs(parseMoney(amount, formCurrency)) *
                          (moneyDirection === "in" ? 1 : -1),
                        nextDue: due,
                        endDate: end || undefined,
                        status: "active",
                      }),
                    "Recurring series saved.",
                  )
                  .then((ok) => {
                    if (ok) setEditing(undefined);
                  });
              } catch (e) {
                f.setError(
                  e instanceof Error ? e.message : "Invalid expected amount.",
                );
              }
            }}
          >
            <label>
              Name
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              Account
              <select
                disabled={!!editing?.amountHistory.length}
                value={account}
                onChange={(e) => setAccount(e.target.value)}
              >
                {data.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Cadence
              <select
                value={cadence}
                onChange={(e) =>
                  setCadence(e.target.value as RecurringSeries["cadence"])
                }
              >
                {["weekly", "monthly", "quarterly", "annual"].map((c) => (
                  <option key={c} value={c}>
                    {c[0].toUpperCase() + c.slice(1)}
                  </option>
                ))}
              </select>
            </label>
            <SegmentedControl
              label="Money direction"
              value={moneyDirection}
              onChange={setMoneyDirection}
              options={[
                { value: "out", label: "Money out" },
                { value: "in", label: "Money in" },
              ]}
            />
            <label>
              Expected amount ({formCurrency})
              <input
                required
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <small>
                The money direction controls whether this is a payment or
                income.
              </small>
            </label>
            <label>
              Next due
              <UKDateInput
                required

                value={due}
                onChange={(e) => setDue(e)}
              />
            </label>
            <label>
              End date
              <UKDateInput value={end} onChange={(e) => setEnd(e)} />
            </label>
            {f.feedback}
            <details className="object-menu">
              <summary>More series options</summary>
              <div className="actions">
                <button
                  type="button"
                  onClick={() =>
                    void f
                      .run(
                        () =>
                          saveRecurringSeries({
                            ...editing,
                            name,
                            accountId: account,
                            currency: formCurrency,
                            cadence,
                            expectedAmountMinor:
                              Math.abs(parseMoney(amount, formCurrency)) *
                              (moneyDirection === "in" ? 1 : -1),
                            nextDue: due,
                            endDate: end || undefined,
                            status: "ignored",
                          }),
                        "Series ignored.",
                      )
                      .then((ok) => {
                        if (ok) setEditing(undefined);
                      })
                  }
                >
                  Ignore merchant
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void f
                      .run(
                        () =>
                          saveRecurringSeries({
                            ...editing,
                            name,
                            accountId: account,
                            currency: formCurrency,
                            cadence,
                            expectedAmountMinor:
                              Math.abs(parseMoney(amount, formCurrency)) *
                              (moneyDirection === "in" ? 1 : -1),
                            nextDue: due,
                            endDate: localToday(),
                          }),
                        "Series ended.",
                      )
                      .then((ok) => {
                        if (ok) setEditing(undefined);
                      })
                  }
                >
                  End series today
                </button>
              </div>
            </details>
            <SheetFooter>
              <button
                type="button"
                disabled={f.busy}
                onClick={() => setEditing(undefined)}
              >
                Cancel
              </button>
              <button
                className="primary"
                form="recurring-payment-form"
                disabled={f.busy}
              >
                Confirm series
              </button>
            </SheetFooter>
          </form>
        </Sheet>
      )}
      {!matching && f.feedback}
    </section>
  );
}

export function DebtPanel({
  currency,
  month,
}: {
  currency: string;
  month: string;
}) {
  const data = useLiveQuery(
    async () => ({
      accounts: await db.accounts.toArray(),
      rates: await db.fxRates.toArray(),
      statements: await db.statements.toArray(),
      valuations: await db.valuations.toArray(),
      transactions: await db.transactions
        .where("date")
        .between(
          `${Number(month.slice(0, 4)) - 1}-01-01`,
          localToday(),
          true,
          true,
        )
        .toArray(),
      settings: await db.settings.get(`debt-plan:${currency}`),
    }),
    [currency, month],
  );
  const [payment, setPayment] = useState(""),
    [strategy, setStrategy] = useState<"avalanche" | "snowball" | "custom">(
      "avalanche",
    ),
    [custom, setCustom] = useState<string[]>([]),
    [terms, setTerms] = useState<
      Record<string, { apr: string; minimum: string }>
    >({}),
    [ready, setReady] = useState(true);
  const [editingDebt, setEditingDebt] = useState<string>();
  const [editingPlan, setEditingPlan] = useState(false);
  const restorePlanDraft = (stored?: string) => {
    try {
      const value = JSON.parse(stored ?? "null") as {
        payment?: string;
        strategy?: typeof strategy;
        custom?: string[];
      } | null;
      setPayment(value?.payment ?? "");
      setStrategy(
        value?.strategy &&
          ["avalanche", "snowball", "custom"].includes(value.strategy)
          ? value.strategy
          : "avalanche",
      );
      setCustom(Array.isArray(value?.custom) ? value.custom : []);
    } catch {
      setPayment("");
      setStrategy("avalanche");
      setCustom([]);
    }
  };
  const f = useFeedback(async () => {
    setTerms({});
    const saved = await db.settings.get(`debt-plan:${currency}`);
    restorePlanDraft(saved?.value);
  });
  const initialized = useRef("");
  useEffect(() => {
    if (!data || initialized.current === currency) return;
    initialized.current = currency;
    restorePlanDraft(data.settings?.value);
  }, [data, currency]);
  if (!data) return <p role="status">Loading debt planner…</p>;
  const debtRows = debtBalances(
    data.accounts,
    data.statements,
    data.valuations,
    data.transactions,
    month,
    localToday(),
  );
  // Card minimums are estimates. A loan/mortgage needs the owner's actual payment.
  const includedRows = debtRows.filter(
    (d) =>
      ["credit", "credit_card"].includes(d.account.accountType) ||
      (d.account.minPaymentMinor ?? 0) > 0,
  );
  let result: ReturnType<typeof debtPayoff> | undefined,
    minimum: ReturnType<typeof debtPayoff> | undefined,
    planError = "";
  if (ready && payment.trim())
    try {
      const rows = includedRows.filter((d) => d.balance && !d.full);
      if (!rows.length)
        throw new Error(
          "No debts are included. Add a credit card or enter the actual monthly payment for a loan.",
        );
      if (rows.some((d) => d.account.apr === undefined))
        throw new Error("Enter the APR for each debt before calculating.");
      if (includedRows.some((d) => d.balance === undefined))
        throw new Error(
          "A verified imported balance or dated manual valuation is needed for every debt before calculating.",
        );
      const inputs = rows.map((d) => {
        const balance = convertMinor(
          d.balance!,
          d.account.currency,
          currency,
          localToday(),
          data.rates,
        );
        const min =
          d.account.minPaymentMinor === undefined
            ? undefined
            : convertMinor(
                d.account.minPaymentMinor,
                d.account.currency,
                currency,
                localToday(),
                data.rates,
              );
        const floor = convertMinor(
          25 * 10 ** currencyPrecision(d.account.currency),
          d.account.currency,
          currency,
          localToday(),
          data.rates,
        );
        if (
          !balance ||
          !floor ||
          (d.account.minPaymentMinor !== undefined && !min)
        )
          throw new Error(
            "Cached exchange rates are needed for every debt currency.",
          );
        return {
          id: d.account.id,
          name: d.account.displayName,
          balanceMinor: balance.amount,
          apr: d.account.apr!,
          minimumMinor: min?.amount,
          floorMinor: floor.amount,
          currency,
          accountType: d.account.accountType,
        };
      });
      result = debtPayoff(
        inputs,
        parseMoney(payment, currency),
        strategy,
        month,
        custom,
      );
      minimum = debtPayoff(inputs, undefined, strategy, month, custom);
    } catch (e) {
      planError =
        e instanceof Error ? e.message : "Enter a valid monthly amount.";
    }
  return (
    <section className="card">
      <div className="context-help-heading">
        <h2>Debt payoff planner</h2>
        <ContextHelp
          title="Debt payoff estimates"
          label="About debt payoff estimates"
        >
          <p>
            Monthly interest = balance × APR ÷ 12, rounded to the nearest penny.
            Estimates assume unchanged rates and no new borrowing. Loans and
            mortgages are included only after you enter their actual monthly
            payment.
          </p>
        </ContextHelp>
      </div>
      {!debtRows.length && (
        <p>Add a credit card, loan or mortgage to plan repayments.</p>
      )}
      {planError && <p role="alert">{planError}</p>}
      {result && (
        <>
          {result.reason && <p className="notice warning">{result.reason}</p>}
          {!result.reason && (
            <div className="planning-v2-kpis">
              <div>
                <small>Total interest</small>
                <strong>{money(result.totalInterestMinor, currency)}</strong>
              </div>
              <div>
                <small>Estimated debt-free</small>
                <strong>
                  {result.reason
                    ? "Not determined"
                    : result.points.length
                      ? monthLabel(result.points.at(-1)!.month)
                      : "Already clear"}
                </strong>
              </div>
              {minimum && !minimum.reason && (
                <div>
                  <small>Interest saved vs minimum only</small>
                  <strong>
                    {money(
                      Math.max(
                        0,
                        minimum.totalInterestMinor - result.totalInterestMinor,
                      ),
                      currency,
                    )}
                  </strong>
                </div>
              )}
            </div>
          )}
          {!result.reason && (
            <div
              className="table-scroll"
              role="region"
              tabIndex={0}
              aria-label="Estimated debt payoff"
            >
              <table className="planning-compact-table">
                <thead>
                  <tr>
                    <th>Debt</th>
                    <th>Estimated payoff</th>
                  </tr>
                </thead>
                <tbody>
                  {includedRows
                    .filter((d) => !d.full && d.balance)
                    .map((d) => (
                      <tr key={d.account.id}>
                        <td>{d.account.displayName}</td>
                        <td>
                          {result.payoff[d.account.id]
                            ? monthLabel(result.payoff[d.account.id]!)
                            : "Not determined"}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
          {!result.reason && (
            <details>
              <summary>Monthly payment schedule</summary>
              <div
                className="table-scroll"
                role="region"
                tabIndex={0}
                aria-label="Monthly payment schedule values"
              >
                <table className="planning-compact-table">
                  <thead>
                    <tr>
                      <th>Month</th>
                      <th>Paid</th>
                      <th>Interest</th>
                      <th>Remaining</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.points.map((p) => (
                      <tr key={p.month}>
                        <td>{monthLabel(p.month)}</td>
                        <td>{money(p.paidMinor, currency)}</td>
                        <td>{money(p.interestMinor, currency)}</td>
                        <td>{money(p.balanceMinor, currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </>
      )}
      <div className="planning-v2-list">
        {debtRows.map((d) => {
          const t = terms[d.account.id] ?? {
            apr: d.account.apr === undefined ? "" : String(d.account.apr),
            minimum:
              d.account.minPaymentMinor === undefined
                ? ""
                : decimalMoney(d.account.minPaymentMinor, d.account.currency),
          };
          return (
            <article className="budget-card" key={d.account.id}>
              <div className="section-heading">
                <strong>{d.account.displayName}</strong>
                <span>
                  {d.balance === undefined
                    ? "No balance"
                    : money(d.balance, d.account.currency)}
                </span>
              </div>
              {d.reason && (
                <p className="notice warning">
                  Unverified balance: {d.reason} Review its statement before
                  planning repayments.
                </p>
              )}
              {d.sourceDate && (
                <small>
                  {d.estimated ? "Estimated" : "Balance"} as of{" "}
                  {formatUkDate(d.sourceDate)}
                </small>
              )}
              {!["credit", "credit_card"].includes(d.account.accountType) &&
                (d.account.minPaymentMinor ?? 0) <= 0 && (
                  <p className="muted">
                    Not included · Enter the actual monthly payment to include
                    this loan.
                  </p>
                )}
              {d.full ? (
                <p className="muted">Paid in full monthly, no plan needed.</p>
              ) : (
                <>
                  <button
                    onClick={() => {
                      setTerms({});
                      setEditingDebt(d.account.id);
                    }}
                  >
                    Edit repayment terms
                  </button>
                  {editingDebt === d.account.id && (
                    <Sheet
                      title={`${d.account.displayName} terms`}
                      onClose={() => {
                        if (!f.busy) {
                          setTerms({});
                          setEditingDebt(undefined);
                        }
                      }}
                    >
                      <form
                        id="debt-terms-form"
                        className="planning-v2-form"
                        onSubmit={(e) => {
                          e.preventDefault();
                          try {
                            void f
                              .run(
                                () =>
                                  saveDebtTerms(
                                    d.account.id,
                                    Number(t.apr),
                                    t.minimum
                                      ? parseMoney(
                                          t.minimum,
                                          d.account.currency,
                                        )
                                      : undefined,
                                  ),
                                "Debt terms saved.",
                              )
                              .then((ok) => {
                                if (ok) {
                                  setTerms({});
                                  setEditingDebt(undefined);
                                }
                              });
                          } catch (e) {
                            f.setError(
                              e instanceof Error
                                ? e.message
                                : "Enter valid debt terms.",
                            );
                          }
                        }}
                      >
                        <label>
                          APR %
                          <input
                            required
                            inputMode="decimal"
                            aria-label={`${d.account.displayName} APR`}
                            value={t.apr}
                            onChange={(e) =>
                              setTerms({
                                ...terms,
                                [d.account.id]: { ...t, apr: e.target.value },
                              })
                            }
                          />
                        </label>
                        <label>
                          Minimum monthly payment
                          <input
                            inputMode="decimal"
                            aria-label={`${d.account.displayName} minimum payment`}
                            value={t.minimum}
                            onChange={(e) =>
                              setTerms({
                                ...terms,
                                [d.account.id]: {
                                  ...t,
                                  minimum: e.target.value,
                                },
                              })
                            }
                          />
                          <small>
                            {["credit", "credit_card"].includes(
                              d.account.accountType,
                            ) ? (
                              <>
                                Empty: 1% plus interest, or{" "}
                                {money(
                                  25 *
                                    10 ** currencyPrecision(d.account.currency),
                                  d.account.currency,
                                )}
                                .
                              </>
                            ) : (
                              "Enter the actual payment to include this loan. No credit-card minimum is assumed."
                            )}
                          </small>
                        </label>
                        {f.feedback}
                        <SheetFooter>
                          <button
                            className="primary"
                            form="debt-terms-form"
                            disabled={f.busy || !t.apr}
                          >
                            Done
                          </button>
                        </SheetFooter>
                      </form>
                    </Sheet>
                  )}
                </>
              )}
            </article>
          );
        })}
      </div>
      <button
        onClick={() => {
          restorePlanDraft(data.settings?.value);
          setEditingPlan(true);
        }}
      >
        Edit repayment plan
      </button>
      {editingPlan && (
        <Sheet
          title="Repayment plan"
          onClose={() => {
            if (!f.busy) {
              restorePlanDraft(data.settings?.value);
              setEditingPlan(false);
            }
          }}
        >
          <form
            id="debt-plan-form"
            className="planning-v2-form"
            onSubmit={(e) => {
              e.preventDefault();
              setReady(true);
              try {
                if (parseMoney(payment, currency) <= 0)
                  throw new Error("Enter a monthly amount greater than zero.");
                void f
                  .run(
                    () =>
                      auditedMutation(
                        "Save debt plan",
                        ["settings"],
                        async () => {
                          await db.settings.put({
                            key: `debt-plan:${currency}`,
                            value: JSON.stringify({
                              payment,
                              strategy,
                              custom,
                            }),
                          });
                        },
                      ),
                    "Repayment settings saved.",
                  )
                  .then((ok) => {
                    if (ok) setEditingPlan(false);
                  });
              } catch (e) {
                f.setError(
                  e instanceof Error
                    ? e.message
                    : "Enter a valid monthly amount.",
                );
              }
            }}
          >
            <label>
              Monthly amount available
              <input
                required
                inputMode="decimal"
                value={payment}
                onChange={(e) => {
                  setPayment(e.target.value);
                }}
              />
            </label>
            <fieldset>
              <legend>Strategy</legend>
              <div className="context-help-row">
                <div className="segmented-control">
                  {(["avalanche", "snowball", "custom"] as const).map((v) => (
                    <button
                      key={v}
                      type="button"
                      aria-pressed={strategy === v}
                      onClick={() => {
                        setStrategy(v);
                      }}
                    >
                      {v[0].toUpperCase() + v.slice(1)}
                    </button>
                  ))}
                </div>
                <ContextHelp
                  title="Debt repayment strategies"
                  label="About debt repayment strategies"
                >
                  <p>Avalanche: pay the highest APR first.</p>
                  <p>Snowball: clear the smallest balance first.</p>
                  <p>Custom: choose which debt to prioritise.</p>
                </ContextHelp>
              </div>
            </fieldset>
            {strategy === "custom" && (
              <div className="full-width">
                <p>Move the first priority to the top.</p>
                {[
                  ...new Set([...custom, ...debtRows.map((d) => d.account.id)]),
                ].map((id, i) => (
                  <div className="planning-v2-object" key={id}>
                    <span>
                      {i + 1}.{" "}
                      {data.accounts.find((a) => a.id === id)?.displayName}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setCustom([
                          id,
                          ...[
                            ...new Set([
                              ...custom,
                              ...debtRows.map((d) => d.account.id),
                            ]),
                          ].filter((d) => d !== id),
                        ])
                      }
                    >
                      Move first
                    </button>
                  </div>
                ))}
              </div>
            )}
            {f.feedback}
            <SheetFooter>
              <button
                className="primary"
                form="debt-plan-form"
                disabled={f.busy || !payment}
              >
                Done
              </button>
            </SheetFooter>
          </form>
        </Sheet>
      )}
      {f.feedback}
    </section>
  );
}

export function ScenarioPanel({
  currency,
  points,
}: {
  currency: string;
  points: { date: string; balance: number }[];
}) {
  const chartRem = useRootFontSize();
  const data = useLiveQuery(
    async () => ({
      scenarios: await db.scenarios.toArray(),
      rates: await db.fxRates.toArray(),
      series: await db.recurringSeries.toArray(),
    }),
    [currency],
  );
  const [selected, setSelected] = useState(""),
    [name, setName] = useState("My scenario"),
    [type, setType] = useState<Scenario["changes"][number]["type"]>("one-off"),
    [date, setDate] = useState(localToday()),
    [amount, setAmount] = useState(""),
    [description, setDescription] = useState(""),
    [seriesId, setSeriesId] = useState(""),
    [end, setEnd] = useState(""),
    [changes, setChanges] = useState<Scenario["changes"]>([]);
  const [direction, setDirection] = useState("out");
  const [editingScenario, setEditingScenario] = useState(false);
  const f = useFeedback();
  const capturedCurrency =
    data?.scenarios.find((s) => s.id === selected)?.currency ?? currency;
  const scenario: Scenario = {
    id: selected || "preview",
    name,
    changes,
    currency: capturedCurrency,
    createdAt:
      data?.scenarios.find((s) => s.id === selected)?.createdAt ??
      new Date().toISOString(),
  };
  const convertedChanges = changes.map((c) => ({
    ...c,
    amountMinor: convertMinor(
      c.amountMinor,
      capturedCurrency,
      currency,
      c.date,
      data?.rates ?? [],
    )?.amount,
  }));
  const missingRate =
    convertedChanges.some((c) => c.amountMinor === undefined) ||
    changes.some((c) => {
      if (!c.recurringSeriesId) return false;
      const series = data?.series.find((s) => s.id === c.recurringSeriesId);
      return (
        !series ||
        !convertMinor(
          series.expectedAmountMinor,
          series.currency,
          currency,
          localToday(),
          data?.rates ?? [],
        )
      );
    });
  const projected = useMemo(
    () =>
      missingRate
        ? []
        : scenarioForecast(
            points.filter((p) => p.date >= localToday()),
            {
              ...scenario,
              changes: convertedChanges.map((c) => ({
                ...c,
                amountMinor: c.amountMinor!,
              })),
            },
            data?.series.map((s) => ({
              ...s,
              expectedAmountMinor:
                convertMinor(
                  s.expectedAmountMinor,
                  s.currency,
                  currency,
                  localToday(),
                  data.rates,
                )?.amount ?? 0,
            })),
            localToday(),
          ),
    [
      points,
      changes,
      data?.series,
      data?.rates,
      currency,
      capturedCurrency,
      missingRate,
    ],
  );
  if (!data) return <p role="status">Loading scenarios…</p>;
  const finalPoint = projected.at(-1);
  const endDifference = finalPoint
    ? finalPoint.scenario - finalPoint.balance
    : undefined;
  const save = () => {
    const nextId = selected || crypto.randomUUID();
    void f
      .run(() => saveScenario({ ...scenario, id: nextId }), "Scenario saved.")
      .then((ok) => {
        if (ok) {
          setSelected(nextId);
          setEditingScenario(false);
        }
      });
  };
  return (
    <section className="card">
      <div className="section-heading">
        <div className="context-help-heading">
          <h2>What if?</h2>
          <ContextHelp
            title="What-if scenarios"
            label="About what-if scenarios"
          >
            <p>Preview changes without editing your actual finances.</p>
            <p>Scenario values never become actual balances.</p>
          </ContextHelp>
        </div>
        <button onClick={() => setEditingScenario(true)}>Edit scenario</button>
      </div>
      {changes.length === 0 ? (
        <p>
          No adjustments yet. Edit a scenario to compare it with the baseline.
        </p>
      ) : (
        <p>
          {name} · {changes.length} adjustment{changes.length === 1 ? "" : "s"}
        </p>
      )}
      {finalPoint &&
        endDifference !== undefined &&
        !missingRate &&
        changes.length > 0 && (
          <p className="scenario-end-summary">
            {endDifference === 0 ? (
              "No change to the baseline on "
            ) : (
              <>
                <span className="amount">
                  {money(Math.abs(endDifference), currency)}
                </span>
                {endDifference < 0 ? " less on " : " more on "}
              </>
            )}
            <time dateTime={finalPoint.date}>
              {formatUkDate(finalPoint.date)}
            </time>
            .
            <small>
              {" "}
              Projected balance{" "}
              <span className="amount">
                {money(finalPoint.scenario, currency)}
              </span>
              .
            </small>
          </p>
        )}
      {projected.length > 0 && !missingRate ? (
        <>
          <div
            className="chart"
            role="img"
            aria-label="Solid baseline and dashed what-if balance"
          >
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={projected}>
                <CartesianGrid vertical={false} stroke="var(--line)" />
                <XAxis
                  dataKey="date"
                  minTickGap={50}
                  tick={{
                    fontSize: chartTickFontSize(chartRem),
                    fill: "var(--muted)",
                  }}
                  tickFormatter={(v) => formatUkDate(String(v))}
                />
                <YAxis
                  width={Math.max(60, Math.round(chartRem * 3.75))}
                  tick={{
                    fontSize: chartTickFontSize(chartRem),
                    fill: "var(--muted)",
                  }}
                  tickFormatter={(v) => compactMoney(Number(v), currency)}
                />
                <Tooltip
                  labelFormatter={(v) => formatUkDate(String(v))}
                  formatter={(v) => money(Number(v), currency)}
                  contentStyle={{
                    background: "var(--surface)",
                    border: "1px solid var(--line)",
                    color: "var(--ink)",
                  }}
                />
                <Line
                  name="Baseline"
                  dataKey="balance"
                  dot={false}
                  stroke="var(--chart-income)"
                  isAnimationActive={false}
                />
                <Line
                  name="What-if scenario"
                  dataKey="scenario"
                  dot={false}
                  stroke="var(--chart-net)"
                  strokeDasharray="6 4"
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <details>
            <summary>View values</summary>
            <div
              className="table-scroll"
              role="region"
              aria-label="Scenario values"
              tabIndex={0}
            >
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Baseline</th>
                    <th>Scenario</th>
                  </tr>
                </thead>
                <tbody>
                  {projected.map((point) => (
                    <tr key={point.date}>
                      <th>{formatUkDate(point.date)}</th>
                      <td className="amount">
                        {money(point.balance, currency)}
                      </td>
                      <td className="amount">
                        {money(point.scenario, currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      ) : (
        <p className="muted">
          {missingRate
            ? "Cached exchange rates are needed for this scenario."
            : "Import complete recent history to show a baseline and scenario chart. Your scenario can still be saved."}
        </p>
      )}
      {changes.length > 0 && (
        <div className="planning-v2-list">
          {changes.map((c) => (
            <ListRow
              key={c.id}
              title={c.description}
              meta={formatUkDate(c.date)}
              amount={<strong>{money(c.amountMinor, capturedCurrency)}</strong>}
            />
          ))}
        </div>
      )}
      {editingScenario && (
        <Sheet
          title="Edit scenario"
          onClose={() => {
            if (!f.busy) setEditingScenario(false);
          }}
          footer={
            <>
              <button
                type="button"
                disabled={f.busy}
                onClick={() => setEditingScenario(false)}
              >
                Done
              </button>
              <button
                type="button"
                className="primary"
                disabled={f.busy || changes.length === 0 || !name.trim()}
                onClick={save}
              >
                Save scenario
              </button>
            </>
          }
        >
          <label>
            Saved scenario
            <select
              value={selected}
              onChange={(e) => {
                setSelected(e.target.value);
                const s = data.scenarios.find((s) => s.id === e.target.value);
                setName(s?.name ?? "My scenario");
                setChanges(s?.changes ?? []);
              }}
            >
              <option value="">New scenario</option>
              {data.scenarios.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <p className="muted">Save up to five scenarios.</p>
          <form
            id="scenario-adjustment-form"
            className="planning-v2-form"
            onSubmit={(e) => {
              e.preventDefault();
              try {
                const value =
                  type === "pause"
                    ? 0
                    : Math.abs(parseMoney(amount, capturedCurrency)) *
                      (direction === "out" ? -1 : 1);
                if (
                  (type === "pause" || type === "recurring-change") &&
                  !seriesId
                )
                  throw new Error("Choose the recurring series to adjust.");
                setChanges([
                  ...changes,
                  {
                    id: crypto.randomUUID(),
                    date,
                    amountMinor: value,
                    description: description || type,
                    type,
                    recurringSeriesId: seriesId || undefined,
                    endDate: end || undefined,
                  },
                ]);
                setAmount("");
              } catch (e) {
                f.setError(
                  e instanceof Error ? e.message : "Enter a valid adjustment.",
                );
              }
            }}
          >
            <label>
              Adjustment
              <select
                value={type}
                onChange={(e) => setType(e.target.value as typeof type)}
              >
                <option value="one-off">One-off payment</option>
                <option value="recurring-change">Change a payment</option>
                <option value="pause">Pause a payment</option>
                <option value="new-recurring">New monthly item</option>
              </select>
            </label>
            <label>
              From date
              <UKDateInput
                required

                value={date}
                onChange={(e) => setDate(e)}
              />
            </label>
            {type !== "pause" && (
              <>
                <label>
                  Amount ({capturedCurrency})
                  <input
                    required
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </label>
                <SegmentedControl
                  label="Scenario money direction"
                  value={direction}
                  onChange={setDirection}
                  options={[
                    { value: "out", label: "Money out" },
                    { value: "in", label: "Money in" },
                  ]}
                />
              </>
            )}
            {(type === "pause" || type === "recurring-change") && (
              <label>
                Recurring series
                <select
                  required
                  value={seriesId}
                  onChange={(e) => setSeriesId(e.target.value)}
                >
                  <option value="">Choose series</option>
                  {data.series
                    .filter(
                      (s) =>
                        s.status !== "ignored" &&
                        (!s.endDate || s.endDate >= localToday()),
                    )
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.currency})
                      </option>
                    ))}
                </select>
              </label>
            )}
            <label>
              Label
              <input
                placeholder="e.g. Car repair"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
            {type !== "one-off" && (
              <label>
                Until date (optional)
                <UKDateInput value={end} onChange={(e) => setEnd(e)} />
              </label>
            )}
            <button>Add adjustment</button>
          </form>
          <div className="planning-v2-list">
            {changes.map((c) => (
              <div key={c.id}>
                <ListRow
                  title={c.description}
                  meta={formatUkDate(c.date)}
                  amount={
                    <strong>{money(c.amountMinor, capturedCurrency)}</strong>
                  }
                />
                <button
                  type="button"
                  aria-label={`Remove ${c.description}`}
                  onClick={() =>
                    setChanges(changes.filter((x) => x.id !== c.id))
                  }
                >
                  Remove adjustment
                </button>
              </div>
            ))}
          </div>
          <label>
            Scenario name
            <input
              value={name}
              maxLength={100}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          {selected && (
            <details className="object-menu">
              <summary>Scenario options</summary>
              <button
                className="danger"
                type="button"
                onClick={() => {
                  if (
                    !window.confirm(`Delete ${name}? You can undo this change.`)
                  )
                    return;
                  void f
                    .run(() => removeScenario(selected), "Scenario deleted.")
                    .then((ok) => {
                      if (ok) {
                        setSelected("");
                        setChanges([]);
                        setEditingScenario(false);
                      }
                    });
                }}
              >
                Delete scenario
              </button>
            </details>
          )}
          {f.feedback}
        </Sheet>
      )}
      {!editingScenario && f.feedback}
    </section>
  );
}
