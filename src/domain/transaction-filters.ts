import type { Transaction } from "./models";
import { financialType } from "./transaction-type";

export type QuickTransactionFilter =
  "groceries" | "income" | "property" | "salary";
export type TransactionCategoryIndex = ReadonlyMap<
  string,
  readonly Transaction[]
>;

/** Explorer rows represent ledger payments, including one row per split parent. */
export function transactionCategoryIndex(
  transactions: readonly Transaction[],
): TransactionCategoryIndex {
  const children = new Map<string, Transaction[]>();
  for (const row of transactions) {
    if (!row.parentId) continue;
    const siblings = children.get(row.parentId) ?? [];
    siblings.push(row);
    children.set(row.parentId, siblings);
  }
  return children;
}

export function matchesTransactionCategory(
  row: Transaction,
  category: string,
  children: TransactionCategoryIndex,
): boolean {
  const matches = (line: Transaction) =>
    line.categoryId === category || line.subcategoryId === category;
  return (
    matches(row) ||
    (!row.parentId && (children.get(row.id)?.some(matches) ?? false))
  );
}

export function matchesTransactionIncome(row: Transaction): boolean {
  return (
    financialType(row) === "income" &&
    row.kind !== "refund" &&
    row.categoryId !== "refund"
  );
}

export function matchesQuickTransactionFilter(
  row: Transaction,
  filter: QuickTransactionFilter,
  children: TransactionCategoryIndex,
): boolean {
  if (filter === "income") return matchesTransactionIncome(row);
  if (filter === "property")
    return (
      matchesTransactionCategory(row, "property", children) ||
      matchesTransactionCategory(row, "property-income", children)
    );
  return matchesTransactionCategory(row, filter, children);
}

export function quickTransactionFilterCounts(
  rows: readonly Transaction[],
  children: TransactionCategoryIndex,
): Record<QuickTransactionFilter, number> {
  const counts = { groceries: 0, income: 0, property: 0, salary: 0 };
  for (const row of rows) {
    if (row.parentId) continue;
    for (const filter of Object.keys(counts) as QuickTransactionFilter[]) {
      if (matchesQuickTransactionFilter(row, filter, children))
        counts[filter]++;
    }
  }
  return counts;
}
