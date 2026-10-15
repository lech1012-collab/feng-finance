import { useLiveQuery } from "dexie-react-hooks";
import { recurringReportingTotal } from "../analytics/subscription-summary";
import { Toast } from "../components/Toast";
import { displayMerchant } from "../domain/presentation";
import { localToday } from "../analytics/reminders";
import { sha256 } from "../domain/normalize";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useSubscriptions } from "../components/SubscriptionNotice";
import { useSwipe } from "../components/useSwipe";
import {
  type Subscription,
  type SubscriptionStatus,
  reviewPrefix,
} from "../analytics/subscriptions";
import { db } from "../storage/database";
import { money } from "../domain/money";
import { convertMinor } from "../analytics/fx";
import { formatUkDate } from "../domain/dates";
import { auditedMutation } from "../storage/audit";
import { undoChange } from "../storage/audit";
import "../components/planning-v2.css";
import { ListRow, StatusChip } from "../components/UIPrimitives";
const statuses: [SubscriptionStatus, string][] = [
  ["review", "Review"],
  ["keep", "Keep"],
  ["cancel", "Plan to cancel"],
  ["cancelled", "I cancelled"],
  ["ignore", "Not a subscription"],
];
function SubscriptionCard({
  item: s,
  account,
  onReviewed,
}: {
  item: Subscription;
  account: string;
  onReviewed: (message: string, changeId: string) => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function save(status: SubscriptionStatus) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const key =
        reviewPrefix + (await sha256(new TextEncoder().encode(s.key)));
      const result = await auditedMutation(
        "Review recurring charge",
        ["settings", "recurringSeries"],
        async () => {
          await db.settings.put({
            key,
            value: JSON.stringify({
              status,
              groupKey: s.key,
              date: localToday(),
              amount: s.amount,
            }),
          });
          await db.recurringSeries.toCollection().modify((series) => {
            if (series.matchKey === s.key) {
              series.status =
                status === "ignore"
                  ? "ignored"
                  : status === "cancel"
                    ? "cancel-planned"
                    : "active";
              if (status === "keep") series.lastAcknowledgedAmount = s.amount;
              if (status === "cancelled") series.endDate = localToday();
            }
          });
        },
      );
      onReviewed(
        `${s.merchant}: ${statuses.find(([value]) => value === status)?.[1]}. You can change this under All detected.`,
        result.changeId,
      );
    } catch {
      setError("Could not save your review. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  const swipe = useSwipe((direction) => {
    if (s.status !== "cancelled")
      void save(direction === "left" ? "cancel" : "keep");
  });
  return (
    <article className="card subscription-card" aria-label={s.merchant}>
      <div
        className="subscription-swipe"
        {...swipe.bind}
        style={{ transform: `translateX(${swipe.offset}px)` }}
      >
        <div>
          <p className="eyebrow">
            {s.cadence
              ? `Recurring ${s.cadence} charge`
              : "Possible subscription · unconfirmed"}
          </p>
          <h2>
            {displayMerchant({ merchant: s.merchant, description: s.merchant })}
          </h2>
          <StatusChip tone={s.needsReview ? "warning" : "neutral"}>
            {s.status === "review"
              ? "Needs review"
              : (statuses.find(([value]) => value === s.status)?.[1] ??
                "Needs review")}
          </StatusChip>
          <p className="muted">
            {account} · Last charged{" "}
            <time className="date-value" dateTime={s.charges.at(-1)!.date}>
              {formatUkDate(s.charges.at(-1)!.date)}
            </time>
          </p>
        </div>
        <strong className="subscription-amount">
          {money(s.amount, s.currency)}
          <small>
            {s.cadence
              ? ` / ${{ weekly: "week", monthly: "month", quarterly: "quarter", yearly: "year" }[s.cadence]}`
              : " last charge"}
          </small>
        </strong>
      </div>
      {s.annual !== undefined && (
        <p>{money(s.annual, s.currency)} / year if this rate continues</p>
      )}
      {s.afterCancellation && (
        <p className="notice warning">
          Charged after you marked this cancelled. Check the merchant’s
          confirmation and the charge date.
        </p>
      )}
      {s.increase > 0 && (
        <p className="notice warning">
          Latest charge increased by {money(s.increase, s.currency)}
          {s.increasePercent !== undefined
            ? ` (+${Math.round(s.increasePercent)}%)`
            : ""}{" "}
          compared with the median of the previous three charges.
        </p>
      )}
      {s.status === "keep" && s.needsReview && s.increase === 0 && (
        <p className="notice warning">
          The latest cost is higher than when you chose to keep this service.
        </p>
      )}
      {s.overlap && (
        <p className="notice warning">
          Also charged on another account. Check whether both plans are needed.
        </p>
      )}
      {s.stale && (
        <p className="muted">
          No recent charge in imported data. This does not prove cancellation;
          import newer statements.
        </p>
      )}
      <div
        className="subscription-states"
        aria-label={`Review status for ${s.merchant}`}
      >
        {statuses
          .filter(([status]) => status === "keep" || status === "cancel")
          .map(([status, label]) => (
            <button
              key={status}
              disabled={busy}
              aria-pressed={s.status === status}
              onClick={() => void save(status)}
            >
              {label}
            </button>
          ))}
        <details className="object-menu">
          <summary>More status options</summary>
          {statuses
            .filter(([status]) => status !== "keep" && status !== "cancel")
            .map(([status, label]) => (
              <button
                disabled={busy}
                key={status}
                aria-pressed={s.status === status}
                onClick={() => void save(status)}
              >
                {label}
              </button>
            ))}
        </details>
      </div>
      {s.status === "cancel" && (
        <div className="notice">
          <strong>Finish cancellation with the provider</strong>
          <p>
            Open the service’s account or billing settings. For purchases billed
            through Apple or Google, use that store’s Subscriptions settings.
            Save the confirmation and end date, then mark “I cancelled” here.
            Deleting the app does not cancel a subscription.
          </p>
        </div>
      )}
      {s.status === "cancelled" && (
        <p className="muted">
          Marked cancelled by you. Feng does not contact the provider or cancel
          payments.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      <details>
        <summary>
          View {s.charges.length} charge{s.charges.length === 1 ? "" : "s"} and
          source evidence
        </summary>
        <p className="muted">
          Regular payments are candidates, not proof of a subscription or
          non-use. Bills and essential services can also recur.
        </p>
        <div
          className="subscription-evidence-list"
          role="group"
          aria-label="Charge evidence"
        >
          {s.charges
            .slice()
            .reverse()
            .map((t) => (
              <ListRow
                className="subscription-evidence"
                to={`/transactions/${t.id}`}
                key={t.id}
                title={displayMerchant(t)}
                meta={
                  <>
                    <time dateTime={t.date}>{formatUkDate(t.date)}</time>
                    {s.increase > 0 && t.id === s.charges.at(-1)?.id && (
                      <>
                        {" · "}
                        <StatusChip tone="warning">Price changed</StatusChip>
                      </>
                    )}
                  </>
                }
                amount={<strong>{money(t.amount, t.currency)}</strong>}
              />
            ))}
        </div>
      </details>
    </article>
  );
}
export default function Subscriptions({ currency }: { currency: string }) {
  const data = useSubscriptions(currency);
  const helpSeen = useLiveQuery(() =>
    db.settings.get("subscriptions:helpSeen"),
  );
  const [message, setMessage] = useState("");
  const [changeId, setChange] = useState(""),
    [error, setError] = useState("");
  const [view, setView] = useState("review");
  const [group, setGroup] = useState("subscriptions");
  const [sort, setSort] = useState("review");
  if (!data) return <p role="status">Checking recurring charges…</p>;
  const isBill = (s: Subscription) =>
    s.charges.some((t) =>
      ["utilities", "insurance", "childcare", "property"].includes(
        t.categoryId ?? "",
      ),
    );
  const groupItems = data.items.filter((s) =>
    group === "bills" ? isBill(s) : !isBill(s),
  );
  const review = groupItems.filter((s) => s.needsReview);
  const plans = groupItems.filter(
    (s) => s.status === "cancel" && !s.stale && s.annual !== undefined,
  );
  const today = localToday();
  const inReporting = (amount: number, native: string) =>
    convertMinor(amount, native, currency, today, data.rates)?.amount;
  const potentialTotal = recurringReportingTotal(
    plans.map((s) => ({ annual: s.annual!, currency: s.currency })),
    currency,
    today,
    data.rates,
  );
  const annualSources = groupItems.filter(
    (s) =>
      s.annual !== undefined &&
      !s.stale &&
      !["ignore", "cancelled"].includes(s.status),
  );
  const yearlyTotal = recurringReportingTotal(
    annualSources.map((s) => ({ annual: s.annual!, currency: s.currency })),
    currency,
    today,
    data.rates,
  );
  const visible = (
    view === "all"
      ? groupItems
      : view === "cancel"
        ? data.items.filter(
            (s) => s.status === "cancel" || s.status === "cancelled",
          )
        : review
  )
    .filter((s) => (group === "bills" ? isBill(s) : !isBill(s)))
    .slice()
    .sort((a, b) =>
      sort === "yearly"
        ? (inReporting(b.annual ?? 0, b.currency) ?? -1) -
          (inReporting(a.annual ?? 0, a.currency) ?? -1)
        : sort === "merchant"
          ? a.merchant.localeCompare(b.merchant)
          : Number(b.afterCancellation) - Number(a.afterCancellation) ||
            Number(b.needsReview) - Number(a.needsReview) ||
            (b.annual ?? b.amount) - (a.annual ?? a.amount),
    );
  return (
    <>
      <div className="page-heading">
        <h1>Subscriptions</h1>
      </div>
      <p className="muted">
        Find charges you may have forgotten. Based on up to three years of
        imported statements
        {data.lastDate && (
          <>
            , with transactions through{" "}
            <time dateTime={data.lastDate} className="date-value">
              {formatUkDate(data.lastDate)}
            </time>
          </>
        )}
        . Your data stays on this device.
      </p>
      <section className="card">
        <div className="planning-v2-kpis">
          <div>
            <small>Yearly recurring cost</small>
            <strong>
              {yearlyTotal.missingRates
                ? "Rates needed"
                : yearlyTotal.value === undefined
                  ? "Not detected"
                  : money(
                      yearlyTotal.value,
                      currency,
                      false,
                      yearlyTotal.approximate,
                    )}
            </strong>
            <small>
              At the latest observed prices.{" "}
              {yearlyTotal.missingRates
                ? yearlyTotal.originals
                    .map((item) => money(item.amount, item.currency))
                    .join(" + ") + " · Original yearly amounts"
                : ""}
            </small>
          </div>
          <div>
            <small>Recurring charges</small>
            <strong>{annualSources.length}</strong>
          </div>
        </div>
        <h2>{review.length} to review</h2>
        {!helpSeen && (
          <p>
            Swipe a charge left to plan cancellation, right to keep it. You can
            change its status at any time.
          </p>
        )}
        {plans.length > 0 && (
          <p>
            <strong>
              {potentialTotal.missingRates
                ? "Rates needed"
                : money(
                    potentialTotal.value!,
                    currency,
                    false,
                    potentialTotal.approximate,
                  )}{" "}
              / year
            </strong>{" "}
            in cancellation plans at the latest observed prices. Potential
            avoided charges, not confirmed savings.
            {potentialTotal.missingRates && (
              <small>
                {potentialTotal.originals
                  .map((item) => money(item.amount, item.currency))
                  .join(" + ")}{" "}
                · Original yearly amounts
              </small>
            )}
          </p>
        )}
        <p className="muted">
          Feng cannot tell whether you use a service, and cannot cancel it for
          you. Alerts update when you import statements; there are no background
          bank checks or push notifications.
        </p>
      </section>
      {message && (
        <Toast
          id={changeId || message}
          message={message}
          undo={
            changeId
              ? async () => {
                  await undoChange(changeId);
                  setChange("");
                  setMessage("");
                }
              : undefined
          }
        />
      )}
      {error && <p role="alert">{error}</p>}
      <div className="segmented-control" aria-label="Recurring payment type">
        <button
          aria-pressed={group === "subscriptions"}
          onClick={() => setGroup("subscriptions")}
        >
          Subscriptions
        </button>
        <button
          aria-pressed={group === "bills"}
          onClick={() => setGroup("bills")}
        >
          Bills
        </button>
      </div>
      <div
        className="subscription-tabs"
        role="group"
        aria-label="Subscription view"
      >
        {[
          ["review", "Needs review"],
          ["cancel", "Cancellation plans"],
          ["all", "All detected"],
        ].map(([value, label]) => (
          <button
            key={value}
            aria-pressed={view === value}
            onClick={() => setView(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <label>
        Sort recurring charges
        <select
          aria-label="Sort recurring charges"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
        >
          <option value="review">Needs review first</option>
          <option value="yearly">Yearly cost: highest first</option>
          <option value="merchant">Merchant name</option>
        </select>
      </label>
      {!visible.length && (
        <section className="card">
          <h2>
            {data.items.length
              ? "Nothing in this view"
              : "No recurring charges detected yet"}
          </h2>
          <p>
            Import consecutive statements to find monthly patterns, or at least
            two years for annual renewals. Known service names can appear after
            one charge, clearly marked unconfirmed.
          </p>
          <Link to="/import">Import statements</Link>
        </section>
      )}
      <div className="subscription-list">
        {visible.map((s) => (
          <SubscriptionCard
            key={s.key}
            item={s}
            onReviewed={(message, id) => {
              setMessage(message);
              setChange(id);
              void db.settings
                .put({ key: "subscriptions:helpSeen", value: "true" })
                .catch(() => {});
            }}
            account={
              data.accounts.find((a) => a.id === s.accountId)?.displayName ??
              "Account"
            }
          />
        ))}
      </div>
    </>
  );
}
