import type {
  Account,
  Category,
  Setting,
  Statement,
  Transaction,
} from "../domain/models";
import { monthBounds, monthOffset, parseDate } from "../domain/dates";
import { safeSum } from "../domain/money";
import { normalizeMerchant } from "../domain/normalize";
import { completeMonth } from "./category";
import { datedBalanceHistory } from "./balances";
import { readReview } from "./subscriptions";

export const budgetKey = (currency: string, category: string) =>
  `budget:${currency}:${category}`;
export function readBudget(value?: string): number | undefined {
  try {
    const parsed: unknown = JSON.parse(value ?? "null");
    if (
      typeof parsed === "number" &&
      Number.isSafeInteger(parsed) &&
      parsed >= 0
    )
      return parsed;
  } catch {
    /* Invalid settings never become a financial limit. */
  }
}
const external = (t: Transaction) =>
  !t.isTransfer && t.type !== "transfer" && !t.transferPairId;
const day = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86400000;
const dateAt = (stamp: number) =>
  new Date(stamp * 86400000).toISOString().slice(0, 10);
function verifiedDocuments(
  transactions: Transaction[],
  statements: Statement[],
  today: string,
) {
  const grouped = new Map<string, Transaction[]>();
  for (const t of transactions) {
    const rows = grouped.get(t.statementId) ?? [];
    rows.push(t);
    grouped.set(t.statementId, rows);
  }
  return statements.filter((s) => {
    const rows = grouped.get(s.id) ?? [];
    return (
      s.statementPeriodEnd <= today &&
      s.validationStatus === "reconciled" &&
      s.openingBalance !== undefined &&
      s.closingBalance !== undefined &&
      rows.length === s.transactionCount &&
      rows.every(
        (t) =>
          t.accountId === s.accountId &&
          t.currency === s.currency &&
          t.date >= s.statementPeriodStart &&
          t.date <= s.statementPeriodEnd,
      ) &&
      Math.abs(
        safeSum([s.openingBalance, ...rows.map((t) => t.amount)]) -
          s.closingBalance,
      ) <= 1
    );
  });
}
export function shiftPlannedDate(date: string, months: number) {
  const month = monthOffset(date.slice(0, 7), months);
  const last = day(monthBounds(month)[1]) - day(`${month}-01`);
  return `${month}-${String(Math.min(Number(date.slice(8)), last)).padStart(2, "0")}`;
}
export function budgetOverview(
  transactions: Transaction[],
  accounts: Account[],
  statements: Statement[],
  categories: Category[],
  settings: Setting[],
  month: string,
  currency: string,
  today: string,
) {
  const eligible = transactions.filter(
    (t) => t.currency === currency && external(t) && t.date <= today,
  );
  const verified = verifiedDocuments(transactions, statements, today);
  const previous = Array.from({ length: 6 }, (_, i) =>
    monthOffset(month, -i - 1),
  ).filter((m) =>
    completeMonth(
      m,
      accounts.filter((a) => a.currency === currency),
      verified,
      today,
    ),
  );
  const current = eligible.filter(
    (t) => t.date.startsWith(month) && t.amount < 0,
  );
  const items = categories
    .filter((c) => !c.parentId && c.kind === "expense" && !c.archived)
    .map((category) => {
      const spend = (rows: Transaction[]) =>
        -safeSum(
          rows
            .filter((t) => t.categoryId === category.id && t.amount < 0)
            .map((t) => t.amount),
        );
      const spent = spend(current);
      const limit = readBudget(
        settings.find((s) => s.key === budgetKey(currency, category.id))?.value,
      );
      const average =
        previous.length >= 3
          ? Math.round(
              safeSum(
                previous.map((m) =>
                  spend(eligible.filter((t) => t.date.startsWith(m))),
                ),
              ) / previous.length,
            )
          : undefined;
      return {
        category,
        spent,
        limit,
        average,
        remaining: limit === undefined ? undefined : limit - spent,
      };
    });
  const configured = items.filter((i) => i.limit !== undefined);
  return {
    items,
    historyMonths: previous.length,
    totalLimit: safeSum(configured.map((i) => i.limit!)),
    budgetedSpending: safeSum(configured.map((i) => i.spent)),
    unbudgetedSpending: -safeSum(
      current
        .filter((t) => !configured.some((i) => i.category.id === t.categoryId))
        .map((t) => t.amount),
    ),
  };
}
export interface PlannedPayment {
  id: string;
  group: string;
  accountId: string;
  merchant: string;
  date: string;
  amount: number;
  cadence: string;
  evidence: number;
}
interface Pattern {
  group: string;
  rows: Transaction[];
  cadence: string;
  months: number;
  days: number;
  amount: number;
}
const billCategories = new Set([
  "subscriptions",
  "utilities",
  "insurance",
  "childcare",
  "property",
  "healthcare",
  "cleaning",
  "fees",
]);
/** Conservative recurrence: same account, merchant, direction and recent intervals.
 * Uses calendar months, preserving the original day across short months. */
export function paymentPatterns(
  transactions: Transaction[],
  settings: Setting[],
  currency: string,
  today: string,
): Pattern[] {
  const groups = new Map<string, Transaction[]>();
  for (const t of transactions) {
    if (t.currency !== currency || t.date > today || !external(t) || !t.amount)
      continue;
    if (
      t.amount > 0
        ? ["refund", "interest"].includes(t.categoryId ?? "")
        : !billCategories.has(t.categoryId ?? "") &&
          !t.categoryId?.startsWith("property-")
    )
      continue;
    const merchant = normalizeMerchant(t.merchant || t.description);
    if (!merchant) continue;
    const key = JSON.stringify([
      t.accountId,
      currency,
      merchant,
      !!t.isDemo,
      t.amount > 0,
    ]);
    const grouped = groups.get(key) ?? [];
    grouped.push(t);
    groups.set(key, grouped);
  }
  const cancelled = new Set(
    settings
      .map((s) => readReview(s.value))
      .filter((r) => r?.status === "cancelled")
      .map((r) => r!.groupKey),
  );
  const patterns: Pattern[] = [];
  for (const [group, all] of groups) {
    const rows = all.sort((a, b) => a.date.localeCompare(b.date)).slice(-6);
    const last = rows.at(-1)!;
    if (
      cancelled.has(
        JSON.stringify([
          last.accountId,
          currency,
          normalizeMerchant(last.merchant || last.description),
          !!last.isDemo,
        ]),
      )
    )
      continue;
    const gaps = rows.slice(1).map((t, i) => day(t.date) - day(rows[i].date));
    const pattern = [
      { cadence: "weekly", min: 6, max: 8, count: 4, months: 0, days: 7 },
      {
        cadence: "fortnightly",
        min: 12,
        max: 16,
        count: 4,
        months: 0,
        days: 14,
      },
      { cadence: "monthly", min: 24, max: 38, count: 3, months: 1, days: 0 },
      { cadence: "quarterly", min: 80, max: 100, count: 3, months: 3, days: 0 },
      { cadence: "yearly", min: 350, max: 380, count: 2, months: 12, days: 0 },
    ].find(
      (p) =>
        rows.length >= p.count && gaps.every((g) => g >= p.min && g <= p.max),
    );
    if (!pattern) continue;
    const amounts = rows.slice(-3).map((t) => Math.abs(t.amount));
    const smallest = Math.min(...amounts),
      largest = Math.max(...amounts);
    if (largest - smallest > Math.max(1, smallest * 0.35)) continue;
    const next = pattern.months
      ? shiftPlannedDate(last.date, pattern.months)
      : dateAt(day(last.date) + pattern.days);
    // Do not resurrect an old bill/income sequence after several missed cycles.
    if (day(today) - day(next) > (pattern.months ? 38 : pattern.days + 3))
      continue;
    patterns.push({
      group,
      rows,
      cadence: pattern.cadence,
      months: pattern.months,
      days: pattern.days,
      amount: last.amount > 0 ? smallest : last.amount,
    });
  }
  return patterns;
}
function paymentEvents(
  patterns: Pattern[],
  start: string,
  end: string,
  observed: Transaction[],
): PlannedPayment[] {
  const events: PlannedPayment[] = [];
  for (const p of patterns) {
    const last = p.rows.at(-1)!;
    for (let i = 1; i <= 400; i++) {
      const date = p.months
        ? shiftPlannedDate(last.date, p.months * i)
        : dateAt(day(last.date) + p.days * i);
      if (date > end) break;
      if (date <= start) continue;
      const settled = observed.some(
        (t) =>
          t.accountId === last.accountId &&
          Math.sign(t.amount) === Math.sign(p.amount) &&
          normalizeMerchant(t.merchant || t.description) ===
            normalizeMerchant(last.merchant || last.description) &&
          Math.abs(day(t.date) - day(date)) <= 5,
      );
      if (settled) continue;
      events.push({
        id: `${p.group}:${date}`,
        group: p.group,
        accountId: last.accountId,
        merchant: last.merchant || last.description,
        date,
        amount: p.amount,
        cadence: p.cadence,
        evidence: p.rows.length,
      });
    }
  }
  return events.sort(
    (a, b) =>
      a.date.localeCompare(b.date) || a.merchant.localeCompare(b.merchant),
  );
}
export function planningForecast(
  transactions: Transaction[],
  accounts: Account[],
  statements: Statement[],
  settings: Setting[],
  currency: string,
  today: string,
  horizon: 30 | 60 | 90,
) {
  parseDate(today);
  const scoped = accounts.filter((a) => a.currency === currency);
  const accountIds = new Set(scoped.map((a) => a.id));
  const observed = transactions.filter(
    (t) =>
      accountIds.has(t.accountId) && t.currency === currency && t.date <= today,
  );
  const patterns = paymentPatterns(observed, settings, currency, today);
  const end = dateAt(day(today) + horizon);
  const upcoming = paymentEvents(patterns, today, end, observed);
  const validStatements = verifiedDocuments(observed, statements, today);
  const history = datedBalanceHistory(
    scoped,
    validStatements,
    observed,
    today.slice(0, 7),
    currency,
    3,
  );
  const anchor = [...history.data].reverse().find((p) => p.total !== null);
  const baseline = Array.from({ length: 6 }, (_, i) =>
    monthOffset(today.slice(0, 7), -i - 1),
  ).filter((m) => completeMonth(m, scoped, validStatements, today));
  const recurringRows = new Set(
    patterns.flatMap((p) => p.rows.map((t) => t.id)),
  );
  // All historical occurrences of an established recurring merchant are excluded,
  // including rows older than the recent six used to establish its cadence.
  const recurring = (t: Transaction) =>
    recurringRows.has(t.id) ||
    patterns.some(
      (p) =>
        p.rows[0].accountId === t.accountId &&
        Math.sign(p.amount) === Math.sign(t.amount) &&
        normalizeMerchant(p.rows[0].merchant || p.rows[0].description) ===
          normalizeMerchant(t.merchant || t.description),
    );
  const cancelledGroups = new Set(
    settings
      .map((s) => readReview(s.value))
      .filter((r) => r?.status === "cancelled")
      .map((r) => r!.groupKey),
  );
  const cancelled = (t: Transaction) =>
    cancelledGroups.has(
      JSON.stringify([
        t.accountId,
        currency,
        normalizeMerchant(t.merchant || t.description),
        !!t.isDemo,
      ]),
    );
  const variableRows = observed.filter(
    (t) =>
      external(t) &&
      t.amount < 0 &&
      !recurring(t) &&
      !cancelled(t) &&
      baseline.includes(t.date.slice(0, 7)),
  );
  const baselineDays = safeSum(
    baseline.map((m) => day(monthBounds(m)[1]) - day(monthBounds(m)[0])),
  );
  const dailyVariable = baselineDays
    ? -safeSum(variableRows.map((t) => t.amount)) / baselineDays
    : undefined;
  const reason = !anchor
    ? "A shared verified balance is needed for every account."
    : day(today) - day(anchor.date) > 35
      ? "Account balances are more than 35 days old. Import recent statements."
      : baseline.length < 3
        ? "Import at least three complete previous months for a spending baseline."
        : undefined;
  if (reason || !anchor || dailyVariable === undefined)
    return {
      upcoming,
      reason,
      anchor,
      baselineMonths: baseline.length,
      points: [],
      income: safeSum(
        upcoming.filter((p) => p.amount > 0).map((p) => p.amount),
      ),
      bills: Math.abs(
        safeSum(upcoming.filter((p) => p.amount < 0).map((p) => p.amount)),
      ),
    };
  const gapRows = observed.filter((t) => t.date > anchor.date);
  const gapVariable = gapRows.filter(
    (t) => external(t) && t.amount < 0 && !recurring(t),
  );
  const estimates = paymentEvents(patterns, anchor.date, end, observed);
  let movement = 0;
  const points = [
    {
      date: anchor.date,
      balance: anchor.total!,
      lower: anchor.total!,
      upper: anchor.total!,
    },
  ];
  let observedVariable = 0;
  for (let stamp = day(anchor.date) + 1; stamp <= day(end); stamp++) {
    const date = dateAt(stamp);
    movement = safeSum([
      movement,
      ...gapRows.filter((t) => t.date === date).map((t) => t.amount),
      ...estimates.filter((p) => p.date === date).map((p) => p.amount),
    ]);
    observedVariable = safeSum([
      observedVariable,
      ...gapVariable.filter((t) => t.date === date).map((t) => -t.amount),
    ]);
    const days = stamp - day(anchor.date);
    const base = safeSum([anchor.total!, movement]);
    const projected = (factor: number) =>
      safeSum([
        base,
        -Math.max(
          0,
          Math.round(dailyVariable * days * factor) - observedVariable,
        ),
      ]);
    points.push({
      date,
      balance: projected(1),
      lower: projected(1.25),
      upper: projected(0.75),
    });
  }
  return {
    upcoming,
    reason,
    anchor,
    baselineMonths: baseline.length,
    points,
    dailyVariable,
    income: safeSum(upcoming.filter((p) => p.amount > 0).map((p) => p.amount)),
    bills: Math.abs(
      safeSum(upcoming.filter((p) => p.amount < 0).map((p) => p.amount)),
    ),
  };
}
