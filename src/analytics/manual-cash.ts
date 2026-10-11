import type { Account, ManualValuation, Transaction } from "../domain/models";
import { safeSum } from "../domain/money";
import { ledgerTransactions } from "./effective-transactions";

/** A dated opening amount is required. An explicit later valuation is a closing
 * observation: only subsequent payments move it. Split children never move cash
 * twice; refunds and transfers still move its real balance on arrival. */
export function manualCashBalance(
  account: Account,
  valuations: ManualValuation[],
  transactions: Transaction[],
  asOf: string,
): {
  valueMinor?: number;
  date?: string;
  valuationDate?: string;
  hasEntries: boolean;
} {
  const valuation = valuations
    .filter((value) => value.accountId === account.id && value.date <= asOf)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  if (!valuation) return { hasEntries: false };
  const opening = valuation.note === "Cash opening balance";
  const entries = ledgerTransactions(transactions).filter(
    (transaction) =>
      transaction.accountId === account.id &&
      transaction.source === "manual" &&
      transaction.date <= asOf &&
      (opening
        ? transaction.date >= valuation.date
        : transaction.date > valuation.date),
  );
  return {
    valueMinor: safeSum([
      valuation.valueMinor,
      ...entries.map((entry) => entry.amount),
    ]),
    date:
      entries
        .map((entry) => entry.date)
        .sort()
        .at(-1) ?? valuation.date,
    valuationDate: valuation.date,
    hasEntries: entries.length > 0,
  };
}
