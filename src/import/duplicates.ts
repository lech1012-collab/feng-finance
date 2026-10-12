import type { Statement, Transaction } from "../domain/models";
import { transactionKey, normalizeDescription } from "../domain/normalize";
function comparableDescription(raw: string) {
  return normalizeDescription(raw)
    .replace(
      /^(?:CARD PURCHASE|CONTACTLESS|FASTER PAYMENT(?: FROM| TO)?|PAYMENT(?: FROM| TO)?|DIRECT DEBIT(?: TO)?|BILL PAYMENT(?: TO)?|RECEIVED FROM|TO|FROM)\s+/,
      "",
    )
    .split(/\s+REF(?:ERENCE)?[:\s]/)[0]
    .trim();
}
function compatibleDate(a: Transaction, b: Transaction) {
  return (
    a.date === b.date ||
    a.bookingDate === b.date ||
    b.bookingDate === a.date ||
    (!!a.bookingDate && a.bookingDate === b.bookingDate)
  );
}
export function duplicateStatus(
  t: Transaction,
  existing: Transaction[],
  samePeriod = false,
): "none" | "certain" | "possible" {
  const occurrence = t.occurrence ?? 0;
  const sameSourceId =
    t.sourceId &&
    existing.find(
      (p) =>
        p.accountId === t.accountId &&
        p.source === t.source &&
        p.sourceId === t.sourceId,
    );
  if (sameSourceId)
    return sameSourceId.amount === t.amount &&
      sameSourceId.currency === t.currency &&
      compatibleDate(sameSourceId, t)
      ? "certain"
      : "possible";
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
  const ownDescription = comparableDescription(t.description);
  const crossFormat = existing.filter((p) => {
    if (
      !t.source ||
      p.source === t.source ||
      p.source === "manual" ||
      p.parentId ||
      p.accountId !== t.accountId ||
      p.currency !== t.currency ||
      p.amount !== t.amount ||
      !compatibleDate(p, t)
    )
      return false;
    const other = comparableDescription(p.description);
    return (
      ownDescription.length >= 5 &&
      other.length >= 5 &&
      (ownDescription === other ||
        ownDescription.startsWith(other + " ") ||
        other.startsWith(ownDescription + " "))
    );
  });
  if (t.balanceAfterTransaction !== undefined) {
    const sameBalanceAcrossFormats = existing.filter(
      (p) =>
        p.accountId === t.accountId &&
        p.currency === t.currency &&
        compatibleDate(p, t) &&
        p.amount === t.amount &&
        p.balanceAfterTransaction === t.balanceAfterTransaction &&
        p.source !== t.source,
    );
    const coveredOccurrence =
      Math.max(
        sameFields.length,
        crossFormat.length,
        sameBalanceAcrossFormats.length,
      ) > occurrence;
    if (sameBalanceAcrossFormats.length === 1 && coveredOccurrence)
      return "certain";
    if (
      coveredOccurrence &&
      sameFields.some(
        (p) => p.balanceAfterTransaction === t.balanceAfterTransaction,
      )
    )
      return "certain";
    // Different known running balances distinguish legitimate identical purchases.
    return sameFields.filter((p) => p.balanceAfterTransaction === undefined)
      .length > occurrence ||
      crossFormat.filter((p) => p.balanceAfterTransaction === undefined)
        .length > occurrence
      ? "possible"
      : "none";
  }
  if (samePeriod && sameFields.some((p) => (p.occurrence ?? 0) === occurrence))
    return "certain";
  // An export with three identical purchases must not lose purchase #3 when
  // only two matching occurrences are already stored.
  return Math.max(sameFields.length, crossFormat.length) > occurrence
    ? "possible"
    : "none";
}
export function statementDuplicate(hash: string, statements: Statement[]) {
  return statements.some((s) => s.sourceFileHash === hash);
}
