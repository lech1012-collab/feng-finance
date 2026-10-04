import { useLiveQuery } from "dexie-react-hooks";
import { Link } from "react-router-dom";
import { Bell, ChevronRight } from "lucide-react";
import { db } from "../storage/database";
import { detectSubscriptions, reviewPrefix } from "../analytics/subscriptions";
export function useSubscriptions(currency: string) {
  return useLiveQuery(async () => {
    const today = new Date().toISOString().slice(0, 10);
    const from = `${Number(today.slice(0, 4)) - 3}${today.slice(4)}`;
    const transactions = await db.transactions
      .where("[currency+date]")
      .between([currency, from], [currency, today], true, true)
      .toArray();
    const settings = await db.settings
      .where("key")
      .startsWith(reviewPrefix)
      .toArray();
    return {
      items: detectSubscriptions(transactions, settings, currency, today),
      accounts: await db.accounts.toArray(),
      lastDate: transactions
        .map((t) => t.date)
        .sort()
        .at(-1),
    };
  }, [currency]);
}
export function SubscriptionNotice({ currency }: { currency: string }) {
  const data = useSubscriptions(currency);
  const count = data?.items.filter((s) => s.needsReview).length ?? 0;
  return (
    <Link className="card subscription-notice" to="/subscriptions">
      <Bell size={24} />
      <span>
        <strong>Subscription review</strong>
        <small>
          {count
            ? `${count} recurring charges to review`
            : "Find recurring charges you may no longer need"}
        </small>
      </span>
      <ChevronRight size={20} />
    </Link>
  );
}
