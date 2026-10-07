import type { Transaction } from "../domain/models";
import { safeSum } from "../domain/money";

/** Statement money movement includes transfers, unlike personal cash-flow analytics. */
export function statementMovements(
  transactions: Pick<Transaction, "amount" | "currency">[],
  currency: string,
) {
  const items = transactions.filter((t) => t.currency === currency);
  return {
    moneyIn: safeSum(items.filter((t) => t.amount > 0).map((t) => t.amount)),
    moneyOut: Math.abs(
      safeSum(items.filter((t) => t.amount < 0).map((t) => t.amount)),
    ),
  };
}
