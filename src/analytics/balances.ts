import type { Account, Statement, Transaction } from "../domain/models";
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
  transactions?: Transaction[],
) {
  const scoped = accounts.filter((a) => a.currency === currency);
  const items = scoped.map((a) => accountSnapshot(a, statements, month));
  const known = items.filter((item) => item.balance !== undefined);
  const total = known.length
    ? safeSum(known.map((item) => item.balance!))
    : undefined;
  const complete = items.length > 0 && items.every((item) => item.reliable);
  const dated = transactions
    ? [1, 3, 6, 12].map((months) => ({
        months,
        history: datedBalanceHistory(
          scoped,
          statements,
          transactions,
          month,
          currency,
          months,
        ),
      }))
    : undefined;
  const comparisons = [1, 3, 6, 12].map((months) => {
    const pastMonth = monthOffset(month, -months);
    const previous = scoped.map((a) =>
      accountSnapshot(a, statements, pastMonth),
    );
    const comparable = complete && previous.every((item) => item.reliable);
    const pastTotal = comparable
      ? safeSum(previous.map((item) => item.balance!))
      : undefined;
    const history = dated?.find((d) => d.months === months)?.history;
    const beginning = history?.data[0].total;
    const ending = history?.data.at(-1)?.total;
    return {
      months,
      month: pastMonth,
      percent: history
        ? complete && beginning != null && ending != null
          ? balancePercent(ending, beginning)
          : undefined
        : total !== undefined && pastTotal !== undefined
          ? balancePercent(total, pastTotal)
          : undefined,
    };
  });
  return {
    items: items.map((item, index) => ({
      ...item,
      changes: [1, 3, 6, 12].map((months) => {
        const previous = accountSnapshot(
          item.account,
          statements,
          monthOffset(month, -months),
        );
        const history = dated?.find((d) => d.months === months)?.history;
        const beginning = history?.data[0].balances[`account${index}`];
        const ending = history?.data.at(-1)?.balances[`account${index}`];
        return {
          months,
          percent: history
            ? item.reliable &&
              beginning != null &&
              ending != null &&
              item.statement?.statementPeriodEnd === history.end
              ? balancePercent(ending, beginning)
              : undefined
            : item.reliable && previous.reliable
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

const dayMilliseconds = 86_400_000;
const dateStamp = (date: string) => Date.parse(`${date}T00:00:00Z`);
const dateString = (stamp: number) =>
  new Date(stamp).toISOString().slice(0, 10);

/** Daily balances are reconstructed only when every stored row reconciles.
 * Transfers move account balances and must be included here. Missing or
 * conflicting coverage stays null rather than carrying a balance forward.
 */
export function datedBalanceHistory(
  accounts: Account[],
  statements: Statement[],
  transactions: Transaction[],
  month: string,
  currency: string,
  period: number,
) {
  const scoped = accounts.filter((a) => a.currency === currency);
  const accountIds = new Set(scoped.map((a) => a.id));
  const documents = statements.filter(
    (s) =>
      accountIds.has(s.accountId) &&
      s.currency === currency &&
      s.statementPeriodEnd < monthBounds(month)[1] &&
      s.closingBalance !== undefined &&
      s.periodSource !== "transaction-coverage" &&
      !["warning", "cannot-reconcile"].includes(s.validationStatus),
  );
  const end = documents.length
    ? Math.max(...documents.map((s) => dateStamp(s.statementPeriodEnd)))
    : dateStamp(monthBounds(month)[1]) - dayMilliseconds;
  const endDate = new Date(end);
  const startMonth = new Date(
    Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth() - period, 1),
  );
  const lastDay = new Date(
    Date.UTC(startMonth.getUTCFullYear(), startMonth.getUTCMonth() + 1, 0),
  ).getUTCDate();
  const start = Date.UTC(
    startMonth.getUTCFullYear(),
    startMonth.getUTCMonth(),
    Math.min(endDate.getUTCDate(), lastDay),
  );
  const rows = new Map<string, Transaction[]>();
  for (const t of transactions) {
    if (!accountIds.has(t.accountId) || t.currency !== currency) continue;
    const existing = rows.get(t.statementId) ?? [];
    existing.push(t);
    rows.set(t.statementId, existing);
  }
  const values = new Map<string, Map<number, number | null>>();
  const record = (account: string, stamp: number, amount: number) => {
    if (stamp < start || stamp > end) return;
    const points = values.get(account) ?? new Map<number, number | null>();
    const previous = points.get(stamp);
    points.set(
      stamp,
      previous === null ||
        (previous !== undefined && Math.abs(previous - amount) > 1)
        ? null
        : amount,
    );
    values.set(account, points);
  };
  for (const s of documents) {
    const statementRows = rows.get(s.id) ?? [];
    const canReconstruct =
      s.validationStatus === "reconciled" &&
      s.openingBalance !== undefined &&
      statementRows.length === s.transactionCount &&
      statementRows.every(
        (t) =>
          t.accountId === s.accountId &&
          t.date >= s.statementPeriodStart &&
          t.date <= s.statementPeriodEnd,
      ) &&
      Math.abs(
        s.openingBalance +
          safeSum(statementRows.map((t) => t.amount)) -
          s.closingBalance!,
      ) <= 1;
    if (canReconstruct) {
      const changes = new Map<number, number>();
      for (const t of statementRows) {
        const stamp = dateStamp(t.date);
        changes.set(stamp, safeSum([changes.get(stamp) ?? 0, t.amount]));
      }
      let balance = s.openingBalance!;
      for (
        let stamp = dateStamp(s.statementPeriodStart) - dayMilliseconds;
        stamp <= dateStamp(s.statementPeriodEnd);
        stamp += dayMilliseconds
      ) {
        balance = safeSum([balance, changes.get(stamp) ?? 0]);
        record(
          s.accountId,
          stamp,
          stamp === dateStamp(s.statementPeriodEnd)
            ? s.closingBalance!
            : balance,
        );
      }
    } else {
      record(s.accountId, dateStamp(s.statementPeriodEnd), s.closingBalance!);
    }
  }
  const data = [];
  for (let stamp = start; stamp <= end; stamp += dayMilliseconds) {
    const balances = Object.fromEntries(
      scoped.map((a, i) => [
        `account${i}`,
        values.get(a.id)?.get(stamp) ?? null,
      ]),
    ) as Record<string, number | null>;
    const known = Object.values(balances);
    data.push({
      stamp,
      date: dateString(stamp),
      balances,
      total:
        known.length && known.every((v) => v !== null)
          ? safeSum(known as number[])
          : null,
    });
  }
  return { data, start: dateString(start), end: dateString(end) };
}
