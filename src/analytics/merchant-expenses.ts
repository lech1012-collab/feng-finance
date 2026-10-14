import type { Transaction } from "../domain/models";
import { displayMerchant } from "../domain/presentation";
import { financialType } from "../domain/transaction-type";
import { safeSum } from "../domain/money";

/** Group display names only for presentation; original rows remain traceable. */
export function merchantExpenses(transactions: Transaction[], limit = 5) {
  const groups = new Map<string, Transaction[]>();
  for (const row of transactions) {
    if (row.amount >= 0 || financialType(row) === "transfer") continue;
    const key = `${row.currency}:${displayMerchant(row).toLocaleLowerCase()}`;
    const rows = groups.get(key) ?? [];
    rows.push(row);
    groups.set(key, rows);
  }
  return [...groups.values()]
    .map((rows) => ({
      name: displayMerchant(rows[0]),
      currency: rows[0].currency,
      amount: safeSum(rows.map((row) => row.amount)),
      count: rows.length,
      ids: rows.map((row) => row.id),
    }))
    .sort((a, b) => a.amount - b.amount)
    .slice(0, limit);
}
