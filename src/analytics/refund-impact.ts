import type { Setting, Transaction } from "../domain/models";
import { periodMonth } from "../domain/period";
import { financialType } from "../domain/transaction-type";
import { safeSum } from "../domain/money";
import { effectiveTransactions } from "./effective-transactions";

export interface RefundImpact {
  month: string;
  categoryId: string;
  /** Signed change to spending: a reduction is negative. */
  amount: number;
}

export function refundMonthName(month: string, withYear = false) {
  return new Date(`${month}-01T12:00:00Z`).toLocaleDateString("en-GB", {
    month: "long",
    ...(withYear ? { year: "numeric" as const } : {}),
    timeZone: "UTC",
  });
}

export function refundCountedMonths(
  refund: Transaction,
  transactions: Transaction[],
  settings: Setting[] = [],
  periodRows: Transaction[] = transactions,
): string[] {
  const byId = new Map(transactions.map((row) => [row.id, row]));
  return [
    ...new Set(
      (refund.refundAllocations ?? []).flatMap((line) => {
        const purchase = byId.get(line.transactionId);
        return purchase
          ? [periodMonth(purchase.date, settings, periodRows)]
          : [];
      }),
    ),
  ].sort();
}

/** Compare the existing allocation with an edited allocation, using complete
 * purchase/split rows so the preview has the same penny arithmetic as reports. */
export function refundAllocationImpact(
  refund: Transaction,
  purchases: Transaction[],
  refunds: Transaction[],
  allocations: NonNullable<Transaction["refundAllocations"]>,
  settings: Setting[] = [],
  periodRows: Transaction[] = purchases,
): RefundImpact[] {
  const base = [...purchases, ...refunds.filter((row) => row.id !== refund.id)];
  const amounts = (rows: Transaction[]) => {
    const result = new Map<string, number>();
    for (const row of effectiveTransactions(rows)) {
      if (row.amount >= 0 || financialType(row) === "transfer") continue;
      const key = `${periodMonth(row.date, settings, periodRows)}|${row.categoryId ?? "uncategorized"}`;
      result.set(key, safeSum([result.get(key) ?? 0, -row.amount]));
    }
    return result;
  };
  const before = amounts([...base, refund]);
  const after = amounts([
    ...base,
    {
      ...refund,
      kind: "refund",
      categoryId: undefined,
      refundAllocations: allocations,
    },
  ]);
  return [...new Set([...before.keys(), ...after.keys()])]
    .flatMap((key) => {
      const amount = (after.get(key) ?? 0) - (before.get(key) ?? 0);
      const [month, categoryId] = key.split("|");
      return amount ? [{ month, categoryId, amount }] : [];
    })
    .sort(
      (a, b) =>
        a.month.localeCompare(b.month) ||
        a.categoryId.localeCompare(b.categoryId),
    );
}
