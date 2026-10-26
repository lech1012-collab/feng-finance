import { Toast } from "./Toast";
import { SuggestedRules } from "./SuggestedRules";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../storage/database";
import { closeMonth, reopenMonths } from "../storage/month-review";
import { confirmPotContribution } from "../storage/planning-v2";
import {
  reportingMonthlySeries,
  reportingCoverage,
} from "../analytics/reporting";
import {
  effectiveTransactions,
  needsReview,
} from "../analytics/effective-transactions";
import { projectedReportingTransactions } from "../analytics/fx";
import { cashFlow, categorySpending } from "../analytics/calculations";
import { reportingPeriod, reportingPeriodLabel } from "../domain/period";
import { formatUkDate, monthLabel, monthOffset } from "../domain/dates";
import { monthBounds } from "../domain/dates";
import { displayMerchant } from "../domain/presentation";
import { money, parseMoney, decimalMoney, safeSum } from "../domain/money";
import { download } from "../storage/backup";
import {
  localToday,
  monthReviewCalendar,
  readReminderConfig,
  REMINDER_KEY,
} from "../analytics/reminders";
import { undoChange } from "../storage/audit";
import { potsOverview } from "../analytics/planning-v2";
import {
  reviewDate,
  reviewPriceChanges,
} from "../analytics/month-review-details";
import { ListRow } from "./UIPrimitives";
import { Sheet } from "./Sheet";
import { ContextHelp } from "./ContextHelp";
export function MonthReview({
  month,
  currency,
}: {
  month: string;
  currency: string;
}) {
  const data = useLiveQuery(
    async () => ({
      rows: await db.transactions.toArray(),
      accounts: await db.accounts.toArray(),
      statements: await db.statements.toArray(),
      categories: await db.categories.toArray(),
      settings: await db.settings.toArray(),
      rates: await db.fxRates.toArray(),
      proposals: await db.transferProposals.toArray(),
      pots: await db.pots.toArray(),
      valuations: await db.valuations.toArray(),
      closed: await db.monthCloses.get(month),
    }),
    [month],
  );
  const [step, setStep] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [changeId, setChangeId] = useState("");
  const [contributing, setContributing] = useState("");
  const [contributions, setContributions] = useState<Record<string, string>>(
    {},
  );
  if (!data) return <p role="status">Loading monthly review…</p>;
  const [from, to] = reportingPeriod(month, data.settings, data.rows);
  const asOf = reviewDate(to, localToday());
  const potSummary = potsOverview(
    data.pots,
    data.accounts,
    data.statements,
    data.rows,
    currency,
    asOf,
    data.rates,
    data.valuations,
  );
  const priceChanges = reviewPriceChanges(
    data.rows,
    data.settings,
    from,
    to,
    localToday(),
  );
  const nextMonth = monthOffset(month, 1);
  const nextPriceChanges = priceChanges.length
    ? []
    : reviewPriceChanges(
        data.rows,
        data.settings,
        to,
        reportingPeriod(nextMonth, data.settings, data.rows)[1],
        localToday(),
      );
  const planningAsOf = reviewDate(monthBounds(month)[1], localToday());
  const projected = projectedReportingTransactions(
    effectiveTransactions(data.rows),
    currency,
    data.rates,
  ).transactions;
  const current = projected.filter((t) => t.date >= from && t.date < to);
  const flow = cashFlow(current, currency);
  const coverage = reportingCoverage(
    data.accounts,
    data.statements,
    data.rows,
    month,
    currency,
    data.rates,
    data.settings,
    data.proposals,
  );
  const reviewCount = data.rows.filter(
    (t) => t.date >= from && t.date < to && needsReview(t),
  ).length;
  const past = reportingMonthlySeries(
    data.rows,
    data.accounts,
    data.statements,
    monthOffset(month, -1),
    12,
    currency,
    data.rates,
    data.settings,
    data.proposals,
  )
    .filter((p) => p.coverage.complete)
    .slice(-3);
  const average = (field: "income" | "expenses" | "net") =>
    past.length
      ? Math.round(safeSum(past.map((p) => p[field] ?? 0)) / past.length)
      : undefined;
  const categories = categorySpending(current, data.categories, currency);
  const previousStart = reportingPeriod(
    monthOffset(month, -3),
    data.settings,
    data.rows,
  )[0];
  const previousMerchants = new Set(
    data.rows
      .filter((t) => t.date >= previousStart && t.date < from)
      .map((t) => t.merchant),
  );
  const newMerchants = [
    ...new Set(
      current
        .filter((t) => !previousMerchants.has(t.merchant))
        .map((t) => t.merchant),
    ),
  ].slice(0, 5);
  const changes = categories
    .map((category) => {
      const normal = past.map((p) => {
        const bounds = reportingPeriod(p.month, data.settings, data.rows);
        return (
          categorySpending(
            projected.filter((t) => t.date >= bounds[0] && t.date < bounds[1]),
            data.categories,
            currency,
          ).find((c) => c.id === category.id)?.amount ?? 0
        );
      });
      const mean = normal.length
        ? Math.round(safeSum(normal) / normal.length)
        : undefined;
      return {
        ...category,
        difference: mean === undefined ? undefined : category.amount - mean,
        percentage:
          mean === undefined || mean === 0
            ? undefined
            : ((category.amount - mean) / mean) * 100,
      };
    })
    .filter((c) => c.difference !== undefined)
    .sort((a, b) => Math.abs(b.difference!) - Math.abs(a.difference!))
    .slice(0, 3);
  const run = async (operation: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setError("");
    try {
      await operation();
      setNotice(message);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Review could not be saved.");
    } finally {
      setBusy(false);
    }
  };
  const lastBackup = data.settings.find(
    (s) => s.key === "backup:lastExportAt",
  )?.value;
  const latestImport = data.statements
    .map((s) => s.importedAt)
    .sort()
    .at(-1);
  return (
    <div className="month-review-page">
      <div className="page-heading">
        <h1>Review {monthLabel(month)}</h1>
        <Link to="/analysis" className="icon-button" aria-label="Close review">
          <span aria-hidden="true">×</span>
        </Link>
      </div>
      <p className="muted">
        {reportingPeriodLabel(month, data.settings, data.rows)} · Step{" "}
        {step + 1} of 4
      </p>
      <div
        className="review-steps"
        role="group"
        aria-label="Monthly review steps"
      >
        {["Your month", "What changed", "Pots and goals", "Housekeeping"].map(
          (name, i) => (
            <button
              key={name}
              aria-pressed={step === i}
              onClick={() => setStep(i)}
            >
              <span aria-hidden="true">●</span>
              <span className="sr-only">
                {i + 1}. {name}
              </span>
            </button>
          ),
        )}
      </div>
      {step === 0 && (
        <section className="card">
          <div className="context-help-heading">
            <h2>Your month</h2>
            <ContextHelp
              title="Monthly review totals"
              label="About monthly review totals"
              tone={coverage.complete ? "help" : "warning"}
            >
              <p>
                Averages use up to three complete, verified months before this
                review.
              </p>
              <p>
                {coverage.complete
                  ? "This month has complete coverage."
                  : "This month is partial or unverified."}
              </p>
            </ContextHelp>
          </div>
          <dl className="totals">
            {(["income", "expenses", "net"] as const).map((field) => (
              <div key={field}>
                <dt>
                  {field === "expenses"
                    ? "Spending"
                    : field === "net"
                      ? "Net cash flow"
                      : "Income"}
                  <small>
                    {average(field) === undefined
                      ? "No verified comparison yet"
                      : `3-month average ${money(average(field)!, currency)}`}
                  </small>
                </dt>
                <dd>
                  {coverage.missingRates
                    ? "Rates needed"
                    : field !== "expenses" && !coverage.hasIncomeSource
                      ? "No income source imported"
                      : `${current.some((t) => "conversion" in t) ? "≈ " : ""}${money(flow[field], currency)}${coverage.complete ? "" : "*"}`}
                </dd>
              </div>
            ))}
          </dl>
          <p className="muted">
            {past.length} of 3 complete months used.{" "}
            {coverage.complete ? "Complete" : "* Partial or unverified"}
          </p>
        </section>
      )}
      {step === 1 && (
        <section className="card">
          <div className="context-help-heading">
            <h2>What changed</h2>
            <ContextHelp
              title="Monthly comparisons"
              label="About monthly comparisons"
            >
              <p>
                Spending differences compare this complete month with your
                average from up to three previous complete months.
              </p>
            </ContextHelp>
          </div>
          {coverage.complete &&
            changes.map((c) => (
              <Link
                key={c.id}
                className="insight-row"
                to={`/categories/${c.id}?month=${month}`}
              >
                <span>
                  {c.name}
                  <small>vs your 3-month average</small>
                </span>
                <strong
                  className={c.difference! > 0 ? "spending-amount" : "positive"}
                >
                  <span className="amount">
                    {money(c.difference!, currency, true)}
                  </span>
                  <small>
                    {c.percentage === undefined
                      ? "No previous spending"
                      : `${c.percentage < 0 ? "−" : "+"}${Math.abs(c.percentage).toFixed(0)}%`}
                  </small>
                </strong>
              </Link>
            ))}
          {!coverage.complete && (
            <p className="muted">
              Not comparable yet · {monthLabel(month)}{" "}
              {coverage.hasUnverifiedStatements ? "unverified" : "incomplete"}.
            </p>
          )}
          {coverage.complete && !changes.length && (
            <p>Comparisons begin when verified history is available.</p>
          )}
          <p className="muted">{past.length} of 3 complete months used.</p>
          <h3>New merchants</h3>
          <p>
            {newMerchants
              .map((name) =>
                displayMerchant({ merchant: name, description: name }),
              )
              .join(" · ") || "No new merchants this month."}
          </p>
          <h3>Subscription changes</h3>
          {priceChanges.map((subscription) => (
            <div key={subscription.key} className="insight-row">
              <span>
                <strong>
                  {displayMerchant({
                    merchant: subscription.merchant,
                    description: subscription.merchant,
                  })}
                </strong>
                <small>
                  {money(subscription.previousMedian!, subscription.currency)} →{" "}
                  {money(subscription.amount, subscription.currency)} ·{" "}
                  {subscription.currency}
                </small>
              </span>
              <span>
                <strong>
                  +{money(subscription.increase, subscription.currency)} (
                  {subscription.increasePercent?.toFixed(0)}%)
                </strong>
                {subscription.annual !== undefined && (
                  <small>
                    {money(
                      safeSum(
                        Array.from(
                          { length: subscription.annual / subscription.amount },
                          () => subscription.increase,
                        ),
                      ),
                      subscription.currency,
                    )}{" "}
                    more per year
                  </small>
                )}
              </span>
            </div>
          ))}
          {!priceChanges.length && !nextPriceChanges.length && (
            <p className="muted">
              No subscription price increases to review in this period.
            </p>
          )}
          {nextPriceChanges.slice(0, 3).map((subscription) => (
            <p className="muted" key={subscription.key}>
              {displayMerchant({
                merchant: subscription.merchant,
                description: subscription.merchant,
              })}{" "}
              rose on{" "}
              <time
                className="date-value"
                dateTime={subscription.priceChangeDate!}
              >
                {formatUkDate(subscription.priceChangeDate!)}
              </time>
              ; you'll see it in {monthLabel(nextMonth).split(" ")[0]}'s review.
            </p>
          ))}
          <Link to="/subscriptions" className="button">
            Review subscription changes
          </Link>
        </section>
      )}
      {step === 2 && (
        <section className="card">
          <div className="context-help-heading">
            <h2>Pots and goals</h2>
            <ContextHelp
              title="Review pot suggestions"
              label="About review pot suggestions"
            >
              <p>
                Confirmed contributions are already included in each suggestion.
                Pots earmark cash; they never reduce your balance.
              </p>
              {asOf !== planningAsOf && (
                <p>
                  This review follows your month-start setting. Planning uses
                  the calendar month, with suggestions as of{" "}
                  <time className="date-value" dateTime={planningAsOf}>
                    {formatUkDate(planningAsOf)}
                  </time>
                  .
                </p>
              )}
            </ContextHelp>
          </div>
          <p className="muted">
            Suggestions as of{" "}
            <time className="date-value" dateTime={asOf}>
              {formatUkDate(asOf)}
            </time>
            .
          </p>
          {potSummary.items.map(({ pot: p, progress, sourceDate }) => {
            const existing = p.contributions.find(
              (c) => c.month === month,
            )?.amountMinor;
            if (p.linkedAccountId)
              return (
                <ListRow
                  key={p.id}
                  title={p.name}
                  meta={
                    <>
                      Automatic from{" "}
                      {data.accounts.find((a) => a.id === p.linkedAccountId)
                        ?.displayName ?? "linked savings account"}
                      {sourceDate && (
                        <>
                          {" "}
                          · as of{" "}
                          <time className="date-value" dateTime={sourceDate}>
                            {formatUkDate(sourceDate)}
                          </time>
                        </>
                      )}
                    </>
                  }
                  amount={
                    <strong>
                      {progress.linkedUnavailable
                        ? "Balance unavailable"
                        : money(progress.savedMinor, p.currency)}
                    </strong>
                  }
                />
              );
            return (
              <ListRow
                key={p.id}
                title={p.name}
                meta={
                  <>
                    Contribute · Suggested{" "}
                    {money(progress.monthlyMinor, p.currency)} as of{" "}
                    <time className="date-value" dateTime={asOf}>
                      {formatUkDate(asOf)}
                    </time>
                  </>
                }
                amount={
                  <strong>
                    {money(existing ?? progress.monthlyMinor, p.currency)}
                  </strong>
                }
                onClick={() => setContributing(p.id)}
              />
            );
          })}
          {contributing &&
            (() => {
              const item = potSummary.items.find(
                ({ pot }) => pot.id === contributing,
              );
              if (!item || item.pot.linkedAccountId) return null;
              const { pot: p, progress } = item;
              const existing = p.contributions.find(
                (c) => c.month === month,
              )?.amountMinor;
              return (
                <Sheet
                  title={`Contribute to ${p.name}`}
                  onClose={() => {
                    if (!busy) setContributing("");
                  }}
                  footer={
                    <button
                      className="primary"
                      disabled={busy}
                      form="review-contribution-form"
                    >
                      Confirm contribution
                    </button>
                  }
                >
                  <form
                    id="review-contribution-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void run(async () => {
                        const result = await confirmPotContribution(
                          p.id,
                          month,
                          parseMoney(
                            contributions[p.id] ??
                              decimalMoney(
                                existing ?? progress.monthlyMinor,
                                p.currency,
                              ),
                            p.currency,
                          ),
                        );
                        setChangeId(result.changeId);
                        setContributing("");
                      }, "Contribution confirmed. Pots earmark cash; they never reduce your balance.");
                    }}
                  >
                    <label>
                      {p.name} contribution ({p.currency})
                      <input
                        inputMode="decimal"
                        required
                        value={
                          contributions[p.id] ??
                          decimalMoney(
                            existing ?? progress.monthlyMinor,
                            p.currency,
                          )
                        }
                        onChange={(e) =>
                          setContributions({
                            ...contributions,
                            [p.id]: e.target.value,
                          })
                        }
                        aria-describedby="review-contribution-help"
                      />
                    </label>
                    <p id="review-contribution-help">
                      Suggested {money(progress.monthlyMinor, p.currency)} as of{" "}
                      {formatUkDate(asOf)}.
                      {existing !== undefined &&
                        ` This month's confirmed ${money(existing, p.currency)} is shown above.`}
                    </p>
                    {error && <p role="alert">{error}</p>}
                  </form>
                </Sheet>
              );
            })()}
          {!data.pots.length && (
            <p>Create a goal or irregular-cost pot in Planning.</p>
          )}
          <Link to="/planning" className="button">
            Manage pots
          </Link>
        </section>
      )}
      {step === 3 && (
        <section className="card">
          <h2>Housekeeping</h2>
          <SuggestedRules transactions={data.rows} />
          <Link to="/settings#rules" className="button">
            Review learned rules
          </Link>
          {!lastBackup || (!!latestImport && lastBackup < latestImport) ? (
            <p>A new import has been added since your last backup.</p>
          ) : (
            <p>Your backup is newer than the latest import.</p>
          )}
          <Link className="button" to="/settings?section=backup&save=1#backup">
            Save backup
          </Link>
          <h3>{data.closed ? "Month closed" : "Close this month"}</h3>
          <p>
            {reviewCount
              ? `${reviewCount} transaction${reviewCount === 1 ? "" : "s"} still need${reviewCount === 1 ? "s" : ""} review.`
              : coverage.complete
                ? "No transactions need attention and accounts are verified."
                : "Complete verified statement coverage is required to close."}
          </p>
        </section>
      )}
      <div className="actions review-footer">
        <span>Step {step + 1} of 4</span>
        {step > 0 && <button onClick={() => setStep(step - 1)}>Back</button>}
        {step < 3 && (
          <button className="primary" onClick={() => setStep(step + 1)}>
            Continue
          </button>
        )}
        {step === 3 && (
          <>
            {data.closed ? (
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    if (!window.confirm("Reopen this closed month?")) return;
                    const result = await reopenMonths([month]);
                    setChangeId(result.changeId);
                  }, "Month reopened.")
                }
              >
                Reopen month
              </button>
            ) : (
              <button
                className="primary"
                disabled={busy || !coverage.complete || reviewCount > 0}
                onClick={() =>
                  void run(async () => {
                    const result = await closeMonth(month, currency);
                    setChangeId(result.changeId);
                  }, "Month closed. Later edits will ask you to reopen; linked refunds update automatically.")
                }
              >
                Close {monthLabel(month).split(" ")[0]}
              </button>
            )}
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const config = readReminderConfig(
                    data.settings.find((s) => s.key === REMINDER_KEY)?.value,
                  );
                  download(
                    monthReviewCalendar(config, month, localToday()),
                    "text/calendar",
                    "feng-finance-monthly-review.ics",
                  );
                }, "Calendar reminder ready. Open it in your calendar and enable alerts.")
              }
            >
              Remind me next month
            </button>
          </>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
      {notice && (
        <Toast
          id={changeId || notice}
          message={notice}
          undo={
            changeId
              ? async () => {
                  await undoChange(changeId);
                  setChangeId("");
                  setNotice("");
                }
              : undefined
          }
        />
      )}
    </div>
  );
}
