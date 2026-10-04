import type {
  Account,
  Category,
  Statement,
  Transaction,
} from "../domain/models";
import { monthBounds, monthOffset } from "../domain/dates";
import { cashFlow, propertyFlow } from "./calculations";
import { safeSum } from "../domain/money";
const day = (s: string) => Date.parse(s) / 86400000;
export function completeMonth(
  month: string,
  accounts: Account[],
  statements: Statement[],
  today = new Date().toISOString().slice(0, 10),
) {
  const [start, end] = monthBounds(month);
  if (end > today || !accounts.length) return false;
  return accounts.every((account) => {
    let cursor = day(start);
    const ranges = statements
      .filter(
        (s) =>
          s.accountId === account.id &&
          s.currency === account.currency &&
          s.periodSource !== "transaction-coverage" &&
          !["warning", "cannot-reconcile"].includes(s.validationStatus),
      )
      .sort((a, b) =>
        a.statementPeriodStart.localeCompare(b.statementPeriodStart),
      );
    for (const s of ranges) {
      const from = day(s.statementPeriodStart),
        to = day(s.statementPeriodEnd) + 1;
      if (from > cursor) break;
      if (to > cursor) cursor = to;
      if (cursor >= day(end)) return true;
    }
    return false;
  });
}
export function categoryMatches(t: Transaction, id: string) {
  return id === "uncategorized"
    ? !t.categoryId
    : t.categoryId === id || t.subcategoryId === id;
}
export function categoryOverview(
  transactions: Transaction[],
  accounts: Account[],
  statements: Statement[],
  categories: Category[],
  id: string,
  month: string,
  currency: string,
  window = 6,
  today = new Date().toISOString().slice(0, 10),
) {
  const incomeCategory = categories.find((c) => c.id === id)?.kind === "income";
  const eligible = transactions.filter(
    (t) =>
      t.currency === currency &&
      !t.isTransfer &&
      t.type !== "transfer" &&
      !t.transferPairId,
  );
  const relevant = eligible.filter((t) => categoryMatches(t, id));
  const amountFor = (items: Transaction[]) =>
    safeSum(
      items
        .filter((t) => (incomeCategory ? t.amount > 0 : t.amount < 0))
        .map((t) => Math.abs(t.amount)),
    );
  const monthly = (m: string) => {
    const items = eligible.filter((t) => t.date.startsWith(m));
    const flow = cashFlow(items, currency);
    const amount = amountFor(items.filter((t) => categoryMatches(t, id)));
    return {
      month: m,
      amount,
      income: flow.income,
      incomePercent: flow.income > 0 ? (amount / flow.income) * 100 : undefined,
      complete: completeMonth(
        m,
        accounts.filter((a) => a.currency === currency),
        statements,
        today,
      ),
    };
  };
  const history = Array.from({ length: window }, (_, i) =>
    monthly(monthOffset(month, i - window)),
  );
  const baseline = history.filter((m) => m.complete);
  const mean = baseline.length
    ? safeSum(baseline.map((m) => m.amount)) / baseline.length
    : undefined;
  const std =
    mean !== undefined && baseline.length >= 3
      ? Math.sqrt(
          baseline.reduce((sum, m) => sum + (m.amount - mean) ** 2, 0) /
            (baseline.length - 1),
        )
      : undefined;
  const current = monthly(month);
  const selected = relevant.filter((t) => t.date.startsWith(month));
  const difference = mean === undefined ? undefined : current.amount - mean;
  return {
    current,
    history,
    baseline,
    mean,
    std,
    difference,
    change:
      mean && difference !== undefined ? (difference / mean) * 100 : undefined,
    aboveUsual:
      current.complete &&
      mean !== undefined &&
      std !== undefined &&
      current.amount > mean + std,
    incomeCategory,
    transactions: selected,
    property: propertyFlow(
      eligible.filter((t) => t.date.startsWith(month)),
      currency,
    ),
    children: categories
      .filter((c) => c.parentId === id)
      .map((c) => ({
        ...c,
        amount: amountFor(selected.filter((t) => t.subcategoryId === c.id)),
      })),
    series: [...history, current],
  };
}
