import type { Setting, Transaction } from "../domain/models";
import { normalizeMerchant } from "../domain/normalize";
import { currencyPrecision } from "../domain/money";
export type SubscriptionStatus =
  "review" | "keep" | "cancel" | "cancelled" | "ignore";
export interface SubscriptionReview {
  status: SubscriptionStatus;
  groupKey: string;
  date: string;
  amount: number;
}
export interface Subscription {
  key: string;
  merchant: string;
  accountId: string;
  currency: string;
  charges: Transaction[];
  amount: number;
  cadence?: string;
  annual?: number;
  increase: number;
  overlap: boolean;
  stale: boolean;
  afterCancellation: boolean;
  status: SubscriptionStatus;
  needsReview: boolean;
  known: boolean;
}
export const reviewPrefix = "subscription:";
export function readReview(value?: string): SubscriptionReview | undefined {
  try {
    const r: unknown = JSON.parse(value ?? "null");
    if (!r || typeof r !== "object") return;
    const v = r as Record<string, unknown>;
    if (
      !["review", "keep", "cancel", "cancelled", "ignore"].includes(
        String(v.status),
      ) ||
      typeof v.groupKey !== "string" ||
      typeof v.date !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(v.date) ||
      !Number.isSafeInteger(v.amount) ||
      Number(v.amount) < 0
    )
      return;
    return v as unknown as SubscriptionReview;
  } catch {
    return;
  }
}
const knownService =
  /\b(NETFLIX|SPOTIFY|ADOBE|DISNEY|AUDIBLE|APPLE\.COM\/BILL|APPLE MUSIC|ICLOUD|YOUTUBE PREMIUM|MICROSOFT 365|DROPBOX|AMAZON PRIME|OPENAI|CHATGPT)\b/;
const day = (date: string) => Date.parse(date) / 86400000;
export function detectSubscriptions(
  transactions: Transaction[],
  settings: Setting[],
  currency: string,
  today = new Date().toISOString().slice(0, 10),
): Subscription[] {
  const groups = new Map<string, Transaction[]>();
  for (const t of transactions) {
    if (
      t.currency !== currency ||
      t.amount >= 0 ||
      t.isTransfer ||
      t.type === "transfer" ||
      t.transferPairId ||
      t.date > today
    )
      continue;
    const merchant = normalizeMerchant(t.merchant || t.description);
    if (!merchant) continue;
    const key = JSON.stringify([t.accountId, currency, merchant, !!t.isDemo]);
    const group = groups.get(key) ?? [];
    group.push(t);
    groups.set(key, group);
  }
  const reviews = new Map(
    settings.map((s) => {
      const review = readReview(s.value);
      return [review?.groupKey, review] as const;
    }),
  );
  const candidates: Subscription[] = [];
  for (const [key, all] of groups) {
    const charges = [...all].sort(
      (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
    );
    const last = charges.at(-1)!;
    const merchant = normalizeMerchant(last.merchant || last.description);
    // Inspect the recent sequence: older plan changes should not conceal a current recurring charge.
    const recent = charges.slice(-6);
    const intervals = recent
      .slice(1)
      .map((t, i) => day(t.date) - day(recent[i].date));
    const pattern = [
      { name: "weekly", min: 5, max: 9, count: 4, yearly: 52 },
      { name: "monthly", min: 24, max: 38, count: 3, yearly: 12 },
      { name: "quarterly", min: 80, max: 100, count: 3, yearly: 4 },
      { name: "yearly", min: 350, max: 380, count: 2, yearly: 1 },
    ].find(
      (p) =>
        recent.length >= p.count &&
        intervals.every((d) => d >= p.min && d <= p.max),
    );
    const amounts = recent.map((t) => -t.amount);
    const largeChanges = amounts
      .slice(1)
      .filter(
        (amount, i) =>
          Math.abs(amount - amounts[i]) >
          Math.max(10 ** currencyPrecision(currency), amounts[i] * 0.35),
      ).length;
    const stable = largeChanges <= 1;
    const known =
      knownService.test(merchant) || last.categoryId === "subscriptions";
    const everydayCategory =
      [
        "groceries",
        "shopping",
        "restaurants",
        "takeaway",
        "transport",
        "travel",
        "childcare",
        "property",
        "cleaning",
        "household",
        "cash-withdrawal",
        "fees",
      ].includes(last.categoryId ?? "") ||
      last.categoryId?.startsWith("property-");
    if (!known && (everydayCategory || !(pattern && stable))) continue;
    const cadence = pattern && stable ? pattern : undefined;
    const amount = -last.amount;
    const previous =
      recent.length > 1 ? -recent[recent.length - 2].amount : amount;
    const increase =
      cadence &&
      amount - previous >=
        Math.max(10 ** currencyPrecision(currency), previous * 0.05)
        ? amount - previous
        : 0;
    const review = reviews.get(key);
    const status = review?.status ?? "review";
    const afterCancellation =
      status === "cancelled" &&
      !!review &&
      charges.some((t) => t.date > review.date);
    const stale = day(today) - day(last.date) > (cadence?.max ?? 45) * 1.5;
    const needsReview =
      status === "review" ||
      status === "cancel" ||
      afterCancellation ||
      (status === "keep" &&
        !!review &&
        amount - review.amount >=
          Math.max(10 ** currencyPrecision(currency), review.amount * 0.05));
    candidates.push({
      key,
      merchant,
      accountId: last.accountId,
      currency,
      charges,
      amount,
      cadence: cadence?.name,
      annual:
        cadence && Number.isSafeInteger(amount * cadence.yearly)
          ? amount * cadence.yearly
          : undefined,
      increase,
      overlap: false,
      stale,
      afterCancellation,
      status,
      needsReview,
      known,
    });
  }
  for (const c of candidates)
    c.overlap = candidates.some(
      (other) =>
        other.key !== c.key &&
        other.merchant === c.merchant &&
        other.accountId !== c.accountId &&
        !other.stale &&
        !c.stale &&
        !!other.charges[0].isDemo === !!c.charges[0].isDemo,
    );
  return candidates.sort(
    (a, b) =>
      Number(b.afterCancellation) - Number(a.afterCancellation) ||
      Number(b.needsReview) - Number(a.needsReview) ||
      (b.annual ?? b.amount) - (a.annual ?? a.amount),
  );
}
