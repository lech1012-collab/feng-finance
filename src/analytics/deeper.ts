import type {
  Account,
  Category,
  Setting,
  Statement,
  Transaction,
} from "../domain/models";
import { monthOffset } from "../domain/dates";
import { money, currencyPrecision } from "../domain/money";
import { normalizeMerchant } from "../domain/normalize";
import { cashFlow } from "./calculations";
import { completeMonth } from "./category";
import { detectSubscriptions, readReview } from "./subscriptions";

export interface FinancialInsight {
  id: string;
  title: string;
  detail: string;
  href: string;
  priority: number;
}
const mean = (values: number[]) =>
  values.reduce((sum, v) => sum + v, 0) / values.length;
const deviation = (values: number[]) =>
  Math.sqrt(
    values.reduce((sum, v) => sum + (v - mean(values)) ** 2, 0) /
      (values.length - 1),
  );
export function deeperInsights(
  transactions: Transaction[],
  accounts: Account[],
  statements: Statement[],
  categories: Category[],
  settings: Setting[],
  month: string,
  currency: string,
  today: string,
  isComplete?: (month: string) => boolean,
) {
  const scopedAccounts = accounts.filter((a) => a.currency === currency);
  const eligible = transactions.filter(
    (t) =>
      t.currency === currency &&
      !t.isTransfer &&
      t.type !== "transfer" &&
      !t.transferPairId &&
      t.date <= today,
  );
  const current = eligible.filter((t) => t.date.startsWith(month));
  const floor = 25 * 10 ** currencyPrecision(currency);
  const history = Array.from({ length: 6 }, (_, i) =>
    monthOffset(month, -i - 1),
  ).filter((m) =>
    isComplete
      ? isComplete(m)
      : completeMonth(m, scopedAccounts, statements, today),
  );
  const insights: FinancialInsight[] = [];
  const complete = isComplete
    ? isComplete(month)
    : completeMonth(month, scopedAccounts, statements, today);
  if (complete && history.length >= 3) {
    const flows = history.map((m) =>
      cashFlow(
        eligible.filter((t) => t.date.startsWith(m)),
        currency,
      ),
    );
    const now = cashFlow(current, currency);
    const expenses = flows.map((f) => f.expenses),
      income = flows.map((f) => f.income);
    const change = now.expenses - mean(expenses);
    if (Math.abs(change) >= Math.max(floor * 2, mean(expenses) * 0.1)) {
      const drivers = categories
        .filter((c) => !c.parentId && c.kind === "expense")
        .map((c) => {
          const spending = (items: Transaction[]) =>
            -items
              .filter((t) => t.categoryId === c.id && t.amount < 0)
              .reduce((sum, t) => sum + t.amount, 0);
          return {
            category: c,
            change:
              spending(current) -
              mean(
                history.map((m) =>
                  spending(eligible.filter((t) => t.date.startsWith(m))),
                ),
              ),
          };
        })
        .filter((c) => Math.abs(c.change) >= floor)
        .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
        .slice(0, 3);
      insights.push({
        id: "spending-drivers",
        title: `Spending ${change > 0 ? "rose" : "fell"} by ${money(Math.round(Math.abs(change)), currency)}`,
        detail: `Compared with ${history.length} verified previous months. Largest category changes: ${drivers.map((d) => `${d.category.name} ${money(Math.round(d.change), currency, true)}`).join(", ") || "spread across categories"}.`,
        href: `/analysis`,
        priority: 85,
      });
    }
    if (
      mean(income) - now.income >=
      Math.max(floor * 2, mean(income) * 0.2, deviation(income))
    )
      insights.push({
        id: "income-fall",
        title: "Income is lower than usual",
        detail: `${money(now.income, currency)} compared with an average of ${money(Math.round(mean(income)), currency)} across ${history.length} verified months. Transfers are excluded.`,
        href: `/transactions?month=${month}&type=income`,
        priority: 95,
      });
    if (
      now.expenses >
      mean(expenses) +
        Math.max(2 * deviation(expenses), mean(expenses) * 0.2, floor * 2)
    )
      insights.push({
        id: "unusual-spending",
        title: "Spending is outside your usual range",
        detail: `Above the previous-month average plus two sample standard deviations (${money(Math.round(mean(expenses) + 2 * deviation(expenses)), currency)}). Based on ${history.length} verified months.`,
        href: "/analysis",
        priority: 90,
      });
  }
  const groups = new Map<string, Transaction[]>();
  for (const t of eligible)
    if (t.amount < 0 && t.date < `${month}-01`) {
      const key = JSON.stringify([
        t.accountId,
        normalizeMerchant(t.merchant),
        !!t.isDemo,
      ]);
      const values = groups.get(key) ?? [];
      values.push(t);
      groups.set(key, values);
    }
  for (const t of current) {
    const merchant = normalizeMerchant(t.merchant);
    const prior =
      groups.get(JSON.stringify([t.accountId, merchant, !!t.isDemo])) ?? [];
    if (t.amount >= 0 || !merchant || prior.length < 3) continue;
    const amounts = prior.map((p) => -p.amount).sort((a, b) => a - b);
    const median =
      (amounts[Math.floor((amounts.length - 1) / 2)] +
        amounts[Math.floor(amounts.length / 2)]) /
      2;
    if (-t.amount >= median * 2 && -t.amount - median >= floor * 2)
      insights.push({
        id: `purchase-${t.id}`,
        title: `Larger payment to ${t.merchant}`,
        detail: `${money(-t.amount, currency)} versus a typical ${money(Math.round(median), currency)} from ${prior.length} previous payments in this account. Review the transaction; this is not a fraud determination.`,
        href: `/transactions/${t.id}`,
        priority: 80,
      });
  }
  const seen = new Set<string>();
  const reviews = new Map(
    settings.map((setting) => {
      const review = readReview(setting.value);
      return [review?.groupKey, review] as const;
    }),
  );
  for (const s of detectSubscriptions(eligible, settings, currency, today)) {
    if (s.status === "ignore") continue;
    if (s.increase && s.charges.at(-1)!.date.startsWith(month))
      insights.push({
        id: `rise-${s.key}`,
        title: `${s.merchant}: recurring price increase`,
        detail: `The latest charge rose by ${money(s.increase, currency)} to ${money(s.amount, currency)}. At the observed ${s.cadence} cadence, review whether this service is still needed.`,
        href: "/subscriptions",
        priority: 100,
      });
    const cancellationDate = reviews.get(s.key)?.date;
    if (
      s.afterCancellation &&
      cancellationDate &&
      s.charges.some(
        (charge) =>
          charge.date.startsWith(month) && charge.date > cancellationDate,
      )
    )
      insights.push({
        id: `cancel-${s.key}`,
        title: "Charge after a cancellation was recorded",
        detail: `${s.merchant} has a payment after your recorded cancellation date. Check with the provider.`,
        href: "/subscriptions",
        priority: 110,
      });
    if (
      s.overlap &&
      !seen.has(s.merchant) &&
      s.charges.at(-1)!.date.startsWith(month)
    ) {
      seen.add(s.merchant);
      insights.push({
        id: `overlap-${s.merchant}`,
        title: `Possible overlapping ${s.merchant} charges`,
        detail:
          "Recent charges appear in more than one account. They may be separate legitimate plans; compare the underlying payments before canceling anything.",
        href: "/subscriptions",
        priority: 105,
      });
    }
  }
  return {
    items: insights.sort((a, b) => b.priority - a.priority).slice(0, 10),
    baselineCount: history.length,
    complete,
  };
}
