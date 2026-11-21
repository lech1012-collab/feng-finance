import { recurringReportingTotal } from "../analytics/subscription-summary";
import { ImportButton } from "../components/ImportPicker";
import { Toast } from "../components/Toast";
import { ContextHelp } from "../components/ContextHelp";
import { Sheet } from "../components/Sheet";
import { UKDateInput } from "../components/UKDateInput";
import { recurringSubscriptionKeys } from "../analytics/recurring-identity";
import { displayMerchant } from "../domain/presentation";
import { localToday } from "../analytics/reminders";
import { sha256 } from "../domain/normalize";
import { useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { useSubscriptions } from "../components/SubscriptionNotice";
import { useSwipe } from "../components/useSwipe";
import {
  type Subscription,
  type SubscriptionStatus,
  readReview,
  reviewPrefix,
} from "../analytics/subscriptions";
import { db } from "../storage/database";
import { money } from "../domain/money";
import { convertMinor } from "../analytics/fx";
import { formatUkDate, parseDate } from "../domain/dates";
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
  const location = useLocation();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dateDraft, setDateDraft] = useState<string>();
  const lastCharge = s.charges.at(-1)!;
  const editCancellation = () => {
    setError("");
    setDateDraft(s.cancellationEffectiveDate ?? localToday());
  };
  async function save(status: SubscriptionStatus, effectiveDate?: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (
        status === "cancelled" &&
        (!effectiveDate || parseDate(effectiveDate) !== effectiveDate)
      )
        throw new Error("Invalid cancellation date.");
      const key =
        reviewPrefix + (await sha256(new TextEncoder().encode(s.key)));
      const result = await auditedMutation(
        "Review recurring charge",
        ["settings", "recurringSeries"],
        async () => {
          const previous = readReview((await db.settings.get(key))?.value);
          const linkedSeries = new Set(previous?.linkedSeriesIds ?? []);
          for (const charge of s.charges) {
            if (charge.recurringSeriesId)
              linkedSeries.add(charge.recurringSeriesId);
          }
          const identities = await db.settings
            .where("key")
            .startsWith("recurring:match:")
            .toArray();
          await db.settings.put({
            key,
            value: JSON.stringify({
              status,
              groupKey: s.key,
              date: localToday(),
              effectiveDate: status === "cancelled" ? effectiveDate : undefined,
              linkedSeriesIds:
                status === "cancelled" && linkedSeries.size
                  ? [...linkedSeries]
                  : undefined,
              amount: s.amount,
            }),
          });
          await db.recurringSeries.toCollection().modify((series) => {
            const matches =
              recurringSubscriptionKeys(series, identities).includes(s.key) ||
              linkedSeries.has(series.id);
            if (
              matches &&
              series.accountId === s.accountId &&
              series.currency === s.currency &&
              !!series.isDemo === !!lastCharge.isDemo &&
              series.expectedAmountMinor < 0
            ) {
              series.status =
                status === "ignore"
                  ? "ignored"
                  : status === "cancel"
                    ? "cancel-planned"
                    : "active";
              if (status === "keep") series.lastAcknowledgedAmount = s.amount;
              // Older versions copied the review date to the exact-match series.
              // New cancellations are applied alongside the separate calendar end date.
              if (
                previous?.status === "cancelled" &&
                !previous.effectiveDate &&
                series.matchKey === s.key &&
                series.endDate === previous.date
              ) {
                delete series.endDate;
              }
            }
          });
        },
      );
      setDateDraft(undefined);
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
      {(s.afterCancellation ||
        s.increase > 0 ||
        (s.status === "keep" && s.needsReview && s.increase === 0) ||
        s.overlap ||
        s.stale) && (
        <div className="context-help-heading">
          <div className="context-help-row">
            {s.afterCancellation && (
              <Link
                to={`/transactions/${lastCharge.id}`}
                state={{ returnTo: location.pathname + location.search }}
              >
                Charge after cancellation ·{" "}
                {money(lastCharge.amount, lastCharge.currency)} ·{" "}
                {formatUkDate(lastCharge.date)} · {account}
              </Link>
            )}
            {s.increase > 0 && (
              <StatusChip tone="warning">
                Latest charge increased by {money(s.increase, s.currency)}
                {s.increasePercent !== undefined
                  ? ` (+${Math.round(s.increasePercent)}%)`
                  : ""}
              </StatusChip>
            )}
            {s.status === "keep" && s.needsReview && s.increase === 0 && (
              <StatusChip tone="warning">Cost increased since Keep</StatusChip>
            )}
            {(s.overlap || s.stale) && (
              <StatusChip tone="warning">
                {[
                  s.overlap ? "Possible duplicate" : "",
                  s.stale ? "No recent charge" : "",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </StatusChip>
            )}
          </div>
          <ContextHelp
            title="Recurring charge warnings"
            label={`About charge warnings for ${s.merchant}`}
            tone="warning"
          >
            {s.afterCancellation && (
              <p>
                Check the charge against the effective date in the provider’s
                confirmation. All later payments are marked in the charge
                history.
              </p>
            )}
            {s.increase > 0 && (
              <p>
                The latest charge is compared with the median of the previous
                three charges.
              </p>
            )}
            {s.status === "keep" && s.needsReview && s.increase === 0 && (
              <p>
                The latest cost is higher than when you chose to keep this
                service.
              </p>
            )}
            {s.overlap && (
              <p>
                Also charged on another account. Check whether both plans are
                needed.
              </p>
            )}
            {s.stale && (
              <p>
                No recent charge in imported data. This does not prove
                cancellation; import newer statements.
              </p>
            )}
          </ContextHelp>
        </div>
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
            .filter(
              ([status]) =>
                status !== "keep" &&
                status !== "cancel" &&
                !(status === "cancelled" && s.status === "cancelled"),
            )
            .map(([status, label]) => (
              <button
                disabled={busy}
                key={status}
                aria-pressed={s.status === status}
                onClick={() =>
                  status === "cancelled"
                    ? editCancellation()
                    : void save(status)
                }
              >
                {label}
              </button>
            ))}
        </details>
      </div>
      {s.status === "cancel" && (
        <div className="notice">
          <div className="context-help-heading">
            <strong>Finish cancellation with the provider</strong>
            <ContextHelp
              title="Cancelling with the provider"
              label={`Help cancelling ${s.merchant}`}
            >
              <p>
                Open the service’s account or billing settings. For purchases
                billed through Apple or Google, use that store’s Subscriptions
                settings.
              </p>
            </ContextHelp>
          </div>
          <p>
            Feng cannot cancel it for you. Save the provider’s confirmation and
            end date, then mark “I cancelled” here. Deleting the app does not
            cancel a subscription.
          </p>
        </div>
      )}
      {s.cancellationEffectiveDate && (
        <div>
          <p className="muted">Marked cancelled by you.</p>
          <button
            type="button"
            className="link-button"
            disabled={busy}
            onClick={editCancellation}
          >
            Edit effective cancellation date ·{" "}
            <time dateTime={s.cancellationEffectiveDate}>
              {formatUkDate(s.cancellationEffectiveDate)}
            </time>
          </button>
        </div>
      )}
      {dateDraft !== undefined && (
        <Sheet
          title="Record cancellation"
          onClose={() => {
            if (!busy) setDateDraft(undefined);
          }}
          footer={
            <button
              className="primary"
              disabled={busy || !dateDraft}
              onClick={() => void save("cancelled", dateDraft)}
            >
              Save cancellation
            </button>
          }
        >
          <p>
            {displayMerchant({ merchant: s.merchant, description: s.merchant })}{" "}
            · {account}
          </p>
          <label htmlFor="cancellation-effective-date">
            Effective cancellation date
          </label>
          <UKDateInput
            id="cancellation-effective-date"
            value={dateDraft}
            onChange={setDateDraft}
            disabled={busy}
            required
          />
          <p className="muted">
            Use the end date on your provider’s confirmation. Feng flags
            payments dated after that day.
          </p>
          {error && <p role="alert">{error}</p>}
        </Sheet>
      )}
      {dateDraft === undefined && error && <p role="alert">{error}</p>}
      <details>
        <summary>
          View {s.charges.length} charge{s.charges.length === 1 ? "" : "s"} and
          source evidence
        </summary>
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
                className="recurring-charge-row"
                state={{ returnTo: location.pathname + location.search }}
                to={`/transactions/${t.id}`}
                key={t.id}
                title={displayMerchant(t)}
                meta={
                  <>
                    <time dateTime={t.date}>{formatUkDate(t.date)}</time>
                    {s.cancellationEffectiveDate &&
                      t.date > s.cancellationEffectiveDate && (
                        <>
                          {" "}
                          ·{" "}
                          <StatusChip tone="warning">
                            After cancellation
                          </StatusChip>
                        </>
                      )}
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
  const [message, setMessage] = useState("");
  const [changeId, setChange] = useState(""),
    [error, setError] = useState("");
  const [params, setParams] = useSearchParams();
  const group = params.get("group") ?? "all";
  const view = params.get("view") ?? "review";
  const sort = params.get("sort") ?? "review";
  const setFilters = (changes: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) next.set(key, value);
    setParams(next, { replace: true });
  };
  if (!data) return <p role="status">Checking recurring charges…</p>;
  const isBill = (s: Subscription) =>
    s.charges.some((t) =>
      ["utilities", "insurance", "childcare", "property"].includes(
        t.categoryId ?? "",
      ),
    );
  const groupItems = data.items.filter(
    (s) => group === "all" || (group === "bills" ? isBill(s) : !isBill(s)),
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
        ? groupItems.filter(
            (s) => s.status === "cancel" || s.status === "cancelled",
          )
        : review
  )
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
        <div className="context-help-heading">
          <h1>Subscriptions</h1>
          <ContextHelp title="Recurring charge detection">
            <p>
              Find charges you may have forgotten. Based on up to three years of
              imported statements. Your data stays on this device.
            </p>
            <p>
              Import consecutive statements to find monthly patterns, or at
              least two years for annual renewals. Known service names can
              appear after one charge, clearly marked unconfirmed.
            </p>
            <p>
              Regular payments are candidates, not proof of a subscription or
              non-use. Bills and essential services can also recur.
            </p>
            <p>
              Alerts update when you import statements; there are no background
              bank checks or push notifications.
            </p>
          </ContextHelp>
        </div>
      </div>
      {data.lastDate && (
        <p className="muted">
          Transactions through{" "}
          <time dateTime={data.lastDate} className="date-value">
            {formatUkDate(data.lastDate)}
          </time>
        </p>
      )}
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
        <div className="context-help-heading">
          <h2>{review.length} to review</h2>
          <ContextHelp title="Reviewing recurring charges">
            <p>
              Swipe a charge left to plan cancellation, right to keep it. You
              can also use the status buttons and change your choice at any
              time.
            </p>
            <p>
              Feng cannot tell whether you use a service. Review the charge
              history before deciding which services to keep.
            </p>
          </ContextHelp>
        </div>
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
          Cancellation must be completed with the provider.
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
      <div
        className="segmented-control"
        role="group"
        aria-label="Recurring payment type"
      >
        <button
          aria-pressed={group === "all"}
          onClick={() => setFilters({ group: "all" })}
        >
          All charges
        </button>
        <button
          aria-pressed={group === "subscriptions"}
          onClick={() => setFilters({ group: "subscriptions" })}
        >
          Subscriptions
        </button>
        <button
          aria-pressed={group === "bills"}
          onClick={() => setFilters({ group: "bills" })}
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
            onClick={() => setFilters({ view: value })}
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
          onChange={(e) => setFilters({ sort: e.target.value })}
        >
          <option value="review">Needs review first</option>
          <option value="yearly" aria-label="Yearly cost: highest first">
            Highest cost
          </option>
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
          {data.items.length ? (
            <button
              onClick={() => {
                setFilters({ group: "all", view: "all" });
              }}
            >
              View all detected charges
            </button>
          ) : (
            <ImportButton>Import statements</ImportButton>
          )}
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
