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
import { money, parseMoney, decimalMoney, safeSum } from "../domain/money";
import { download, exportBackupFile } from "../storage/backup";
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
    <>
      <div className="page-heading">
        <h1>Review {monthLabel(month)}</h1>
        <Link to="/analysis" className="button">
          Close review
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
              {i + 1}. {name}
            </button>
          ),
        )}
      </div>
      {step === 0 && (
        <section className="card">
          <h2>Your month</h2>
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
            {coverage.complete
              ? "This month has complete coverage."
              : "* This month is partial or unverified."}
          </p>
        </section>
      )}
      {step === 1 && (
        <section className="card">
          <h2>What changed</h2>
          {changes.map((c) => (
            <Link
              key={c.id}
              className="insight-row"
              to={`/categories/${c.id}?month=${month}`}
            >
              <span>{c.name}</span>
              <strong>{money(c.difference!, currency, true)} vs average</strong>
            </Link>
          ))}
          {!changes.length && (
            <p>Comparisons begin when verified history is available.</p>
          )}
          <h3>New merchants</h3>
          <p>{newMerchants.join(" · ") || "No new merchants this month."}</p>
          <h3>Subscription changes</h3>
          {priceChanges.map((subscription) => (
            <Link
              key={subscription.key}
              className="insight-row"
              to="/subscriptions"
            >
              <span>
                <strong>{subscription.merchant}</strong>
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
            </Link>
          ))}
          {!priceChanges.length && (
            <p className="muted">
              No subscription price increases to review in this period.
            </p>
          )}
          <Link to="/subscriptions" className="button">
            Review subscription changes
          </Link>
        </section>
      )}
      {step === 2 && (
        <section className="card">
          <h2>Pots and goals</h2>
          {potSummary.items.map(({ pot: p, progress, sourceDate }) => {
            const existing = p.contributions.find(
              (c) => c.month === month,
            )?.amountMinor;
            if (p.linkedAccountId)
              return (
                <div className="settings-row" key={p.id}>
                  <span>
                    <strong>{p.name}</strong>
                    <small>
                      Automatic from{" "}
                      {data.accounts.find((a) => a.id === p.linkedAccountId)
                        ?.displayName ?? "linked savings account"}
                      {sourceDate ? ` · as of ${formatUkDate(sourceDate)}` : ""}
                    </small>
                  </span>
                  <strong>
                    {progress.linkedUnavailable
                      ? "Balance unavailable"
                      : money(progress.savedMinor, p.currency)}
                  </strong>
                </div>
              );
            return (
              <div className="settings-row" key={p.id}>
                <label>
                  {p.name} contribution ({p.currency})
                  <input
                    inputMode="decimal"
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
                  />
                </label>
                <button
                  disabled={busy}
                  onClick={() =>
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
                    }, "Contribution confirmed. Pots earmark cash; they never reduce your balance.")
                  }
                >
                  Confirm contribution
                </button>
              </div>
            );
          })}
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
          <button
            disabled={busy}
            onClick={() =>
              void run(exportBackupFile, "Backup prepared. Save it in Files.")
            }
          >
            Export backup
          </button>
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
          <h3>{data.closed ? "Month closed" : "Close this month"}</h3>
          <p>
            {reviewCount
              ? `${reviewCount} transaction${reviewCount === 1 ? "" : "s"} still need${reviewCount === 1 ? "s" : ""} review.`
              : coverage.complete
                ? "All transactions reviewed and accounts verified."
                : "Complete verified statement coverage is required to close."}
          </p>
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
              Close month
            </button>
          )}
        </section>
      )}
      <div className="actions">
        {step > 0 && <button onClick={() => setStep(step - 1)}>Back</button>}
        {step < 3 && (
          <button className="primary" onClick={() => setStep(step + 1)}>
            Continue
          </button>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
      {notice && (
        <div className="notice" role="status">
          {notice}
          {changeId && (
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await undoChange(changeId);
                  setChangeId("");
                }, "Change undone.")
              }
            >
              Undo
            </button>
          )}
        </div>
      )}
    </>
  );
}
