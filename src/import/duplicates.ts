import type { Statement, Transaction } from "../domain/models";
import { transactionKey } from "../domain/normalize";
export function duplicateStatus(
  t: Transaction,
  existing: Transaction[],
  samePeriod = false,
): "none" | "certain" | "possible" {
  const match = existing.find(
    (p) => p.transactionFingerprint === t.transactionFingerprint,
  );
  if (match)
    return t.balanceAfterTransaction !== undefined || samePeriod
      ? "certain"
      : "possible";
  const sameFields = existing.filter(
    (p) => transactionKey(p) === transactionKey(t),
  );
  if (t.balanceAfterTransaction !== undefined) {
    if (
      sameFields.some(
        (p) => p.balanceAfterTransaction === t.balanceAfterTransaction,
      )
    )
      return "certain";
    // Different known running balances distinguish legitimate identical purchases.
    return sameFields.some((p) => p.balanceAfterTransaction === undefined)
      ? "possible"
      : "none";
  }
  return sameFields.length ? "possible" : "none";
}
export function statementDuplicate(hash: string, statements: Statement[]) {
  return statements.some((s) => s.sourceFileHash === hash);
}
