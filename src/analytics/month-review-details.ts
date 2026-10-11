import type { Setting, Transaction } from "../domain/models";
import { detectSubscriptions } from "./subscriptions";

export function reviewDate(periodEndExclusive: string, today: string) {
  const last = new Date(
    Date.parse(`${periodEndExclusive}T12:00:00Z`) - 86400000,
  )
    .toISOString()
    .slice(0, 10);
  return last < today ? last : today;
}

/** Review historical native charges as they stood at the end of this period. */
export function reviewPriceChanges(
  transactions: Transaction[],
  settings: Setting[],
  from: string,
  to: string,
  today: string,
) {
  const date = reviewDate(to, today);
  return [...new Set(transactions.map((t) => t.currency))]
    .flatMap((currency) =>
      detectSubscriptions(transactions, settings, currency, date),
    )
    .filter(
      (s) =>
        s.needsReview &&
        s.increase > 0 &&
        !!s.priceChangeDate &&
        s.priceChangeDate >= from &&
        s.priceChangeDate < to,
    );
}
