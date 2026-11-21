import type { RecurringSeries, Setting, Transaction } from "../domain/models";
import { displayMerchant } from "../domain/presentation";
import { normalizeMerchant, sha256 } from "../domain/normalize";
import { cancellationEndDate, readReview, reviewPrefix } from "./subscriptions";

export interface RecurringMatchDecision {
  seriesId: string;
  matchKey: string;
  accountId: string;
  currency: string;
  cadence: RecurringSeries["cadence"];
  direction: number;
  choice: "same" | "separate";
}

export const recurringDecisionKey = async (
  seriesId: string,
  matchKey: string,
) =>
  `recurring:match:${await sha256(new TextEncoder().encode(JSON.stringify([seriesId, matchKey])))}`;

const displayName = (s: RecurringSeries) =>
  displayMerchant({ merchant: s.name, description: s.name }).toLocaleLowerCase(
    "en-GB",
  );

/** Similar names propose a choice; they never establish identity on their own. */
export function compatibleRecurringBills(
  a: RecurringSeries,
  b: RecurringSeries,
) {
  return (
    a.matchKey !== b.matchKey &&
    a.accountId === b.accountId &&
    a.currency === b.currency &&
    a.cadence === b.cadence &&
    Math.sign(a.expectedAmountMinor) === Math.sign(b.expectedAmountMinor) &&
    displayName(a) === displayName(b)
  );
}

export function recurringDecisions(
  series: RecurringSeries,
  settings: Setting[],
): RecurringMatchDecision[] {
  const result: RecurringMatchDecision[] = [];
  for (const setting of settings) {
    if (!/^recurring:match:[a-f0-9]{64}$/.test(setting.key)) continue;
    try {
      const d: unknown = JSON.parse(setting.value);
      if (!d || typeof d !== "object") continue;
      const r = d as Partial<RecurringMatchDecision>;
      if (
        r.seriesId === series.id &&
        typeof r.matchKey === "string" &&
        r.accountId === series.accountId &&
        r.currency === series.currency &&
        r.direction === Math.sign(series.expectedAmountMinor) &&
        (r.choice === "same" || r.choice === "separate")
      )
        result.push(r as RecurringMatchDecision);
    } catch {
      /* An invalid local decision cannot combine bills. */
    }
  }
  return result;
}

export function subscriptionGroupKey(t: Transaction) {
  return JSON.stringify([
    t.accountId,
    t.currency,
    normalizeMerchant(t.merchant || t.description),
    !!t.isDemo,
  ]);
}

/** Legacy calendar entries can use a five-part directional key or a manual UUID. */
function subscriptionKeyForSeries(series: RecurringSeries, key: string) {
  if (series.expectedAmountMinor >= 0) return;
  try {
    const parts: unknown = JSON.parse(key);
    if (
      Array.isArray(parts) &&
      (parts.length === 4 || (parts.length === 5 && parts[4] === false)) &&
      parts[0] === series.accountId &&
      parts[1] === series.currency &&
      typeof parts[2] === "string" &&
      parts[3] === !!series.isDemo
    )
      return JSON.stringify(parts.slice(0, 4));
  } catch {
    // Manual UUIDs identify a calendar object but do not identify a merchant.
  }
}

export function recurringSubscriptionKeys(
  series: RecurringSeries,
  settings: Setting[],
) {
  const keys = [
    series.matchKey,
    ...recurringDecisions(series, settings)
      .filter((decision) => decision.choice === "same")
      .map((decision) => decision.matchKey),
  ];
  return keys
    .map((key) => subscriptionKeyForSeries(series, key))
    .filter((key) => key !== undefined);
}

function cancelledSubscriptions(settings: Setting[]) {
  return settings.flatMap((setting) => {
    if (!setting.key.startsWith(reviewPrefix)) return [];
    const review = readReview(setting.value);
    const endDate = cancellationEndDate(review);
    return review && endDate ? [{ review, endDate }] : [];
  });
}

export function subscriptionEndDates(settings: Setting[]) {
  return new Map(
    cancelledSubscriptions(settings).map(({ review, endDate }) => [
      review.groupKey,
      endDate,
    ]),
  );
}

export function subscriptionEndsBySeries(
  series: RecurringSeries[],
  settings: Setting[],
  transactions: Transaction[] = [],
) {
  const reviews = cancelledSubscriptions(settings);
  const endDates = new Map<string, string>();
  if (!reviews.length || !series.length) return endDates;
  const endsByKey = new Map(
    reviews.map(({ review, endDate }) => [review.groupKey, endDate]),
  );
  const linkedKeys = new Map<string, Set<string>>();
  function link(id: string, key: string) {
    const keys = linkedKeys.get(id) ?? new Set<string>();
    keys.add(key);
    linkedKeys.set(id, keys);
  }
  for (const { review } of reviews)
    for (const id of review.linkedSeriesIds ?? []) link(id, review.groupKey);
  for (const t of transactions) {
    if (
      !t.recurringSeriesId ||
      t.amount >= 0 ||
      t.type === "transfer" ||
      t.isTransfer ||
      t.transferPairId ||
      t.parentId
    )
      continue;
    const key = subscriptionGroupKey(t);
    if (endsByKey.has(key)) link(t.recurringSeriesId, key);
  }
  for (const s of series) {
    let endDate: string | undefined;
    const keys = recurringSubscriptionKeys(s, settings);
    for (const linked of linkedKeys.get(s.id) ?? []) {
      const validated = subscriptionKeyForSeries(s, linked);
      if (validated) keys.push(validated);
    }
    for (const key of keys) {
      const end = endsByKey.get(key);
      if (end && (!endDate || end < endDate)) endDate = end;
    }
    if (endDate) endDates.set(s.id, endDate);
  }
  return endDates;
}

/** Calendar end dates and subscription cancellations are independent bounds. */
export function withSubscriptionEndDates(
  series: RecurringSeries[],
  settings: Setting[],
  transactions: Transaction[] = [],
) {
  const ends = subscriptionEndsBySeries(series, settings, transactions);
  if (!ends.size) return series;
  return series.map((s) => {
    const endDate = ends.get(s.id);
    return endDate && (!s.endDate || endDate < s.endDate)
      ? { ...s, endDate }
      : s;
  });
}

export function resolveRecurringSeries(
  confirmed: RecurringSeries[],
  detected: RecurringSeries[],
  settings: Setting[],
) {
  const series = [...confirmed];
  const proposals: { confirmed: RecurringSeries; detected: RecurringSeries }[] =
    [];
  for (const candidate of detected) {
    if (
      confirmed.some(
        (s) =>
          s.accountId === candidate.accountId &&
          s.currency === candidate.currency &&
          (s.matchKey === candidate.matchKey ||
            recurringDecisions(s, settings).some(
              (d) => d.matchKey === candidate.matchKey && d.choice === "same",
            )),
      )
    )
      continue;
    series.push(candidate);
    const match = confirmed.find(
      (s) =>
        s.status !== "ignored" &&
        compatibleRecurringBills(s, candidate) &&
        !recurringDecisions(s, settings).some(
          (d) => d.matchKey === candidate.matchKey,
        ),
    );
    if (match) proposals.push({ confirmed: match, detected: candidate });
  }
  return { series, proposals };
}
