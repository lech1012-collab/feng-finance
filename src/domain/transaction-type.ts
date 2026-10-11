import type { Transaction, TransactionType } from "./models";
export function amountType(amount: number): "income" | "expense" {
  return amount >= 0 ? "income" : "expense";
}
/** Amounts are the ledger's authority. Categories never reverse a debit/credit.
 * Any transfer marker takes precedence, including older inconsistent records. */
export function financialType(
  t: Pick<Transaction, "amount" | "type" | "isTransfer" | "transferPairId"> &
    Pick<Partial<Transaction>, "kind">,
): TransactionType {
  return t.isTransfer ||
    t.type === "transfer" ||
    t.transferPairId ||
    t.kind === "transfer" ||
    t.kind === "card_repayment"
    ? "transfer"
    : amountType(t.amount);
}
