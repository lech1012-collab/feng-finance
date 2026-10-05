import type { Account, Statement } from "../domain/models";
import { monthBounds, monthOffset } from "../domain/dates";
import { safeSum } from "../domain/money";
export function accountSnapshot(
  account: Account,
  statements: Statement[],
  month: string,
) {
  const cutoff = monthBounds(month)[1];
  const statement = statements
    .filter(
      (s) =>
        s.accountId === account.id &&
        s.currency === account.currency &&
        s.statementPeriodEnd < cutoff,
    )
    .sort(
      (a, b) =>
        b.statementPeriodEnd.localeCompare(a.statementPeriodEnd) ||
        b.importedAt.localeCompare(a.importedAt),
    )[0];
  const balance = statement?.closingBalance;
  const current = statement?.statementPeriodEnd.startsWith(month) ?? false;
  const reliable =
    balance !== undefined &&
    current &&
    statement?.periodSource !== "transaction-coverage" &&
    !["warning", "cannot-reconcile"].includes(statement!.validationStatus);
  return { account, statement, balance, current, reliable };
}
export function balancePercent(current: number, previous: number) {
  return previous === 0
    ? undefined
    : ((current - previous) / Math.abs(previous)) * 100;
}
export function balanceOverview(
  accounts: Account[],
  statements: Statement[],
  month: string,
  currency: string,
) {
  const scoped = accounts.filter((a) => a.currency === currency);
  const items = scoped.map((a) => accountSnapshot(a, statements, month));
  const known = items.filter((item) => item.balance !== undefined);
  const total = known.length
    ? safeSum(known.map((item) => item.balance!))
    : undefined;
  const complete = items.length > 0 && items.every((item) => item.reliable);
  const comparisons = [1, 3, 6, 12].map((months) => {
    const pastMonth = monthOffset(month, -months);
    const previous = scoped.map((a) =>
      accountSnapshot(a, statements, pastMonth),
    );
    const comparable = complete && previous.every((item) => item.reliable);
    const pastTotal = comparable
      ? safeSum(previous.map((item) => item.balance!))
      : undefined;
    return {
      months,
      month: pastMonth,
      percent:
        total !== undefined && pastTotal !== undefined
          ? balancePercent(total, pastTotal)
          : undefined,
    };
  });
  return {
    items: items.map((item) => ({
      ...item,
      changes: [1, 3, 6, 12].map((months) => {
        const previous = accountSnapshot(
          item.account,
          statements,
          monthOffset(month, -months),
        );
        return {
          months,
          percent:
            item.reliable && previous.reliable
              ? balancePercent(item.balance!, previous.balance!)
              : undefined,
        };
      }),
    })),
    total,
    complete,
    comparisons,
  };
}
export function balanceHistory(
  accounts: Account[],
  statements: Statement[],
  month: string,
  currency: string,
  count = 12,
) {
  const scoped = accounts.filter((a) => a.currency === currency);
  return Array.from({ length: count }, (_, i) => {
    const m = monthOffset(month, i - count + 1);
    const snapshots = scoped.map((a) => accountSnapshot(a, statements, m));
    return {
      month: m,
      label: new Date(`${m}-01T12:00:00Z`).toLocaleDateString("en-GB", {
        month: "short",
        timeZone: "UTC",
      }),
      total:
        snapshots.length && snapshots.every((s) => s.reliable)
          ? safeSum(snapshots.map((s) => s.balance!))
          : null,
      balances: Object.fromEntries(
        snapshots.map((s, i) => [`account${i}`, s.reliable ? s.balance : null]),
      ) as Record<string, number | null>,
    };
  });
}
