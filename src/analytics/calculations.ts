import { categoryColor } from "../domain/palette";
import type { Category, Transaction } from "../domain/models";
import { monthOffset, monthBounds } from "../domain/dates";
import { money, safeSum, currencyPrecision } from "../domain/money";
export function cashFlow(transactions: Transaction[], currency: string) {
  const items = transactions.filter(
    (t) => t.currency === currency && !t.isTransfer && t.type !== "transfer",
  );
  const income = safeSum(
    items.filter((t) => t.amount > 0).map((t) => t.amount),
  );
  const expenses = Math.abs(
    safeSum(items.filter((t) => t.amount < 0).map((t) => t.amount)),
  );
  return { income, expenses, net: income - expenses };
}
export function categorySpending(
  transactions: Transaction[],
  categories: Category[],
  currency: string,
) {
  const map = new Map<string, number>();
  for (const t of transactions)
    if (
      t.currency === currency &&
      t.amount < 0 &&
      !t.isTransfer &&
      t.type !== "transfer"
    ) {
      const parent = categories.find((c) => c.id === t.categoryId)?.parentId;
      const key = parent ?? t.categoryId ?? "uncategorized";
      map.set(key, (map.get(key) ?? 0) - t.amount);
    }
  const total = safeSum([...map.values()]);
  return [...map]
    .map(([id, amount]) => ({
      id,
      name: categories.find((c) => c.id === id)?.name ?? "Uncategorized",
      color: categoryColor(id),
      amount,
      percent: total ? (amount / total) * 100 : 0,
    }))
    .sort((a, b) => b.amount - a.amount);
}
export function propertyFlow(transactions: Transaction[], currency: string) {
  return cashFlow(
    transactions.filter(
      (t) =>
        t.categoryId === "property-income" ||
        t.categoryId === "property" ||
        t.categoryId?.startsWith("property-"),
    ),
    currency,
  );
}
export function monthlySeries(
  transactions: Transaction[],
  end: string,
  count: number,
  currency: string,
) {
  return Array.from({ length: count }, (_, i) => {
    const month = monthOffset(end, i - count + 1);
    return {
      month,
      label: new Date(`${month}-01T12:00:00Z`).toLocaleDateString("en-GB", {
        month: "short",
        timeZone: "UTC",
      }),
      ...cashFlow(
        transactions.filter((t) => t.date.startsWith(month)),
        currency,
      ),
      property: propertyFlow(
        transactions.filter((t) => t.date.startsWith(month)),
        currency,
      ).net,
    };
  });
}
export function comparableMonths(
  transactions: Transaction[],
  a: string,
  b: string,
  currency: string,
) {
  const accounts = (month: string) =>
    new Set(
      transactions
        .filter((t) => t.currency === currency && t.date.startsWith(month))
        .map((t) => t.accountId),
    );
  const current = accounts(a),
    previous = accounts(b);
  return (
    current.size > 0 &&
    current.size === previous.size &&
    [...current].every((id) => previous.has(id))
  );
}
export function comparisons(
  transactions: Transaction[],
  categories: Category[],
  month: string,
  currency: string,
) {
  const current = categorySpending(
    transactions.filter((t) => t.date.startsWith(month)),
    categories,
    currency,
  );
  const previous = Array.from({ length: 6 }, (_, i) =>
    monthOffset(month, -i - 1),
  ).filter((m) => comparableMonths(transactions, month, m, currency));
  if (!previous.length)
    return {
      items: [],
      average: 0,
      difference: 0,
      sampleMonths: 0,
      text: "Add previous statements for the same accounts to see a fair spending comparison.",
    };
  const historical = categorySpending(
    transactions.filter((t) => previous.includes(t.date.slice(0, 7))),
    categories,
    currency,
  );
  const comparisonCategories = [
    ...current,
    ...historical
      .filter((h) => !current.some((c) => c.id === h.id))
      .map((h) => ({ ...h, amount: 0, percent: 0 })),
  ];
  const items = comparisonCategories
    .map((c) => {
      const average = Math.round(
        (historical.find((p) => p.id === c.id)?.amount ?? 0) / previous.length,
      );
      const difference = c.amount - average;
      return {
        ...c,
        average,
        difference,
        change: average ? (difference / average) * 100 : undefined,
      };
    })
    .filter(
      (c) =>
        Math.abs(c.difference) >= 25 * 10 ** currencyPrecision(currency) &&
        (c.change === undefined || Math.abs(c.change) >= 10),
    )
    .sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference));
  const average = Math.round(
    safeSum(historical.map((t) => t.amount)) / previous.length,
  );
  const difference = safeSum(current.map((t) => t.amount)) - average;
  const increases = items.filter((c) => c.difference > 0).slice(0, 2);
  const decrease = items.find((c) => c.difference < 0);
  const text = `Your spending is ${money(Math.abs(difference), currency)} ${difference >= 0 ? "higher" : "lower"} than your average across ${previous.length} previous month${previous.length === 1 ? "" : "s"} with data.${increases.length ? " The largest increases are " + increases.map((c) => `${c.name} (${money(c.difference, currency, true)})`).join(" and ") + "." : ""}${decrease ? " Lower " + decrease.name + " spending (" + money(decrease.difference, currency, true) + ") offsets some of the change." : ""}`;
  return { items, average, difference, sampleMonths: previous.length, text };
}
export function recurring(transactions: Transaction[], currency: string) {
  const groups = new Map<string, Transaction[]>();
  for (const t of transactions)
    if (
      t.currency === currency &&
      t.amount < 0 &&
      !t.isTransfer &&
      t.type !== "transfer"
    )
      groups.set(t.merchant, [...(groups.get(t.merchant) ?? []), t]);
  return [...groups]
    .flatMap(([merchant, items]) => {
      const sorted = [...items].sort((a, b) => a.date.localeCompare(b.date));
      const intervals = sorted
        .slice(1)
        .map(
          (t, i) =>
            (Date.parse(t.date) - Date.parse(sorted[i].date)) / 86400000,
        );
      const amounts = sorted.map((t) => -t.amount);
      const average = Math.round(safeSum(amounts) / amounts.length);
      return sorted.length >= 3 &&
        intervals.every((d) => d >= 24 && d <= 38) &&
        amounts.every(
          (a) => Math.abs(a - average) <= Math.max(100, average * 0.1),
        )
        ? [
            {
              merchant,
              amount: average,
              occurrences: sorted.length,
              lastDate: sorted.at(-1)!.date,
            },
          ]
        : [];
    })
    .sort((a, b) => b.amount - a.amount);
}

/** A dated snapshot must reach the month end (or today for a month still in progress). */
export function statementIsCurrent(
  end: string | undefined,
  month: string,
  today = new Date().toISOString().slice(0, 10),
) {
  const lastDay = new Date(Date.parse(monthBounds(month)[1]) - 86400000)
    .toISOString()
    .slice(0, 10);
  const target = lastDay < today ? lastDay : today;
  return !!end && end >= target && end >= monthBounds(month)[0];
}
