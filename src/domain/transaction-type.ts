import type { Transaction, TransactionType } from "./models";
export function amountType(amount: number): "income" | "expense" {
  return amount >= 0 ? "income" : "expense";
}
/** Amounts are the ledger's authority. Categories never reverse a debit/credit.
 * Any transfer marker takes precedence, including older inconsistent records. */
export function financialType(
  t: Pick<Transaction, "amount" | "type" | "isTransfer" | "transferPairId">,
): TransactionType {
  return t.isTransfer || t.type === "transfer" || t.transferPairId
    ? "transfer"
    : amountType(t.amount);
}
