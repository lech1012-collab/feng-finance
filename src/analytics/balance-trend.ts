import type { Account } from "../domain/models";
import { monthBounds, monthOffset } from "../domain/dates";
import { safeSum } from "../domain/money";
import { liabilityTypes } from "./net-worth";
import type { reportingBalanceHistory } from "./reporting-balance-history";

type History = ReturnType<typeof reportingBalanceHistory>;
export interface BalanceTrendScope {
  id: string;
  kind: "cash" | "net" | "account";
  accounts: Account[];
  debt: boolean;
}
export interface BalanceTrendPoint {
  date: string;
  value: number | null;
  verified: boolean;
  daily: boolean;
}

export function balanceTrendScopes(accounts: Account[]): BalanceTrendScope[] {
  const cash = accounts.filter((a) =>
    ["current", "savings"].includes(a.accountType),
  );
  return [
    ...(cash.length
      ? [{ id: "cash", kind: "cash" as const, accounts: cash, debt: false }]
      : []),
    ...(cash.length && cash.length < accounts.length
      ? [{ id: "net", kind: "net" as const, accounts, debt: false }]
      : []),
    ...accounts.map((account) => ({
      id: `account:${account.id}`,
      kind: "account" as const,
      accounts: [account],
      debt: liabilityTypes.has(account.accountType),
    })),
  ];
}

/** Display the same verified facts as the balance engine; never fill missing days. */
export function balanceTrendPoints(
  history: History,
  scope: BalanceTrendScope,
): BalanceTrendPoint[] {
  return history.data.map((point) => {
    const verified =
      scope.accounts.length > 0 &&
      scope.accounts.every((a) => point.verified[a.id]);
    let value: number | null;
    if (scope.kind === "net") value = point.complete ? point.total : null;
    else if (scope.kind === "cash") {
      const amounts = scope.accounts.map((a) => point.values[a.id]);
      value =
        verified && amounts.every((amount) => amount != null)
          ? safeSum(amounts as number[])
          : null;
    } else value = point.values[scope.accounts[0].id] ?? null;
    return {
      date: point.date,
      value: value === null ? null : scope.debt ? -value : value,
      verified: value !== null && verified,
      daily: scope.accounts.every((account) => point.daily[account.id]),
    };
  });
}

export function balanceTrendStart(end: string, months: number) {
  const target = monthOffset(end.slice(0, 7), -months);
  // monthBounds ends at the first of the following month.
  const last = new Date(
    Date.parse(`${monthBounds(target)[1]}T00:00:00Z`) - 86400000,
  ).getUTCDate();
  return `${target}-${String(Math.min(Number(end.slice(8)), last)).padStart(2, "0")}`;
}

export function trendWindow(
  points: BalanceTrendPoint[],
  end: string,
  period: number,
) {
  return points.filter(
    (point) =>
      point.date >= balanceTrendStart(end, period) && point.date <= end,
  );
}

export function defaultBalanceTrendScope(
  history: History,
  scopes: BalanceTrendScope[],
) {
  const has = (scope: BalanceTrendScope, verified: boolean) =>
    balanceTrendPoints(history, scope).some(
      (p) => p.value !== null && (!verified || p.verified),
    );
  return (
    scopes.find((scope) => scope.kind === "cash" && has(scope, true)) ??
    scopes.find((scope) => scope.kind === "account" && has(scope, true)) ??
    scopes.find((scope) => scope.kind === "account" && has(scope, false)) ??
    scopes[0]
  );
}

export function recommendedBalancePeriod(
  points: BalanceTrendPoint[],
  end: string,
) {
  const ranges = [1, 3, 6, 12];
  return (
    ranges.find(
      (n) => trendWindow(points, end, n).filter((p) => p.verified).length >= 2,
    ) ??
    ranges.find((n) =>
      trendWindow(points, end, n).some((p) => p.value !== null),
    ) ??
    1
  );
}

/** Longer ranges must reveal additional recorded dates, not only empty space. */
export function availableBalanceRanges(
  points: BalanceTrendPoint[],
  end: string,
  selected: number,
) {
  let previousCount = 0;
  return [1, 3, 6, 12].filter((period) => {
    const count = trendWindow(points, end, period).filter(
      (point) => point.verified,
    ).length;
    const include =
      period === 1 || period === selected || count > previousCount;
    previousCount = Math.max(previousCount, count);
    return include;
  });
}

export function balanceTrendSummary(points: BalanceTrendPoint[]) {
  const observations = points.filter(
    (p): p is BalanceTrendPoint & { value: number } => p.value !== null,
  );
  const first = observations[0],
    latest = observations.at(-1);
  const change =
    first &&
    latest &&
    first.date !== latest.date &&
    first.verified &&
    latest.verified
      ? {
          amount: safeSum([latest.value, -first.value]),
          percent:
            first.value > 0 && latest.value >= 0
              ? ((latest.value - first.value) / first.value) * 100
              : undefined,
          start: first.date,
          end: latest.date,
        }
      : undefined;
  const segments: BalanceTrendPoint[][] = [];
  for (const point of points) {
    if (point.value === null || !point.verified) continue;
    const previous = segments.at(-1);
    if (
      previous &&
      point.daily &&
      previous.at(-1)!.daily &&
      Date.parse(point.date) - Date.parse(previous.at(-1)!.date) === 86400000
    )
      previous.push(point);
    else segments.push([point]);
  }
  const gaps: { start: string; end: string }[] = [];
  for (const point of points) {
    if (point.value !== null && point.verified) continue;
    const previous = gaps.at(-1);
    if (
      previous &&
      Date.parse(point.date) - Date.parse(previous.end) === 86400000
    )
      previous.end = point.date;
    else gaps.push({ start: point.date, end: point.date });
  }
  return { observations, latest, change, segments, gaps };
}
