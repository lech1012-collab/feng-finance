import type { ParsedStatement, ParsedTransaction } from "../../domain/models";
import { parseDate } from "../../domain/dates";
import { normalizeDescription } from "../../domain/normalize";
import { reconcileWithPolicy } from "../../domain/reconcile";
import { outsideStatementPeriod } from "../statement-period";
import { statementMovements } from "../movements";
import type {
  BankProfile,
  GenericParseResult,
  ParserComparison,
  RowCheck,
  RowReading,
} from "./types";

function nativeReading(transaction: ParsedTransaction | undefined) {
  if (!transaction) return null;
  return [
    transaction.date,
    transaction.bookingDate ?? null,
    normalizeDescription(transaction.description),
    transaction.amount,
    transaction.currency,
    transaction.balanceAfterTransaction ?? null,
  ];
}
/** Compare local, occurrence-preserving rows. Never send this evidence to an external service. */
export function compareLegacyTransactions(
  result: GenericParseResult,
  profileId: BankProfile["id"],
  legacyTransactions?: ParsedTransaction[],
): ParserComparison {
  if (!legacyTransactions)
    return { profileId, legacyStatus: "legacy-failed", differingRows: [] };
  const actual = result.parsed?.transactions ?? [];
  const differingRows: number[] = [];
  for (
    let index = 0;
    index < Math.max(actual.length, legacyTransactions.length);
    index++
  ) {
    if (
      JSON.stringify(nativeReading(actual[index])) !==
      JSON.stringify(nativeReading(legacyTransactions[index]))
    )
      differingRows.push(index);
  }
  return {
    profileId,
    legacyStatus: differingRows.length ? "different" : "matched",
    differingRows,
    legacyTransactions,
  };
}

/** The draft transfer matcher handles this hint; it is not an extraction error. */
export const BANK_ADAPTER_PAYMENT_NOTICE =
  "A payment to Amex was marked as a transfer. Confirm it pays your own credit card; otherwise change its type before importing.";
/** Identity/coverage and transfer notices are not failed transaction extraction. */
function adapterExtractionWarning(warning: string) {
  return !(
    /issue date but no period start/i.test(warning) ||
    warning === BANK_ADAPTER_PAYMENT_NOTICE
  );
}
function selected(row: RowCheck) {
  return (
    row.readings.find((reading) => reading.id === row.selectedReadingId) ??
    row.readings[0]
  );
}
function sameFinancialReading(
  reading: RowReading,
  transaction: ParsedTransaction,
  row: RowCheck,
) {
  return (
    !!reading.description.trim() &&
    // Current-account statements can print a card's purchase date in its
    // description while the Date column is the booking date. Compare the
    // ledger dates and retain both original dates from the bank adapter.
    (reading.bookingDate ?? reading.date) ===
      (transaction.bookingDate ?? transaction.date) &&
    (reading.bookingDate === undefined || reading.date === transaction.date) &&
    reading.amount === transaction.amount &&
    row.rect.page === transaction.sourcePage &&
    (reading.balanceAfterTransaction === undefined ||
      reading.balanceAfterTransaction === transaction.balanceAfterTransaction)
  );
}

export interface BankAdapterProof {
  /** Source row IDs preserve repeated, identical transactions as separate occurrences. */
  sourceRows: RowCheck[];
}

/**
 * A known issuer alone cannot bypass review. Prefer its digital adapter only
 * when independent totals and every reconstructed financial occurrence agree.
 * Generic candidate ambiguity can then be resolved without asking the user to
 * verify the same printed amount again. Descriptive/reference formatting may
 * differ between readers; the financial facts and occurrence counts may not.
 */
export function proveBankAdapter(
  legacy: ParsedStatement | undefined,
  generic: GenericParseResult,
  profile: BankProfile | undefined,
): BankAdapterProof | undefined {
  if (
    !legacy ||
    !profile ||
    profile.institution !== legacy.institution ||
    legacy.institution === "Other" ||
    !legacy.accountIdentifier ||
    !legacy.transactions.length ||
    legacy.warnings.some(adapterExtractionWarning) ||
    generic.checks.unreadPages.length ||
    generic.rowChecks.some(
      (row) => row.reviewAction || row.parseSource !== "text",
    )
  )
    return undefined;
  if (
    generic.parsed &&
    (generic.parsed.currency !== legacy.currency ||
      generic.parsed.periodStart !== legacy.periodStart ||
      generic.parsed.periodEnd !== legacy.periodEnd ||
      (generic.parsed.accountIdentifier !== undefined &&
        generic.parsed.accountIdentifier !== legacy.accountIdentifier))
  )
    return undefined;
  const reconciliation = reconcileWithPolicy(
    legacy.openingBalance,
    legacy.closingBalance,
    legacy.transactions.map((row) => row.amount),
    "exact-v2.2",
  );
  if (reconciliation.status !== "reconciled") return undefined;
  const movements = statementMovements(legacy.transactions, legacy.currency);
  if (
    (generic.checks.printedMoneyIn !== undefined &&
      movements.moneyIn !== generic.checks.printedMoneyIn) ||
    (generic.checks.printedMoneyOut !== undefined &&
      movements.moneyOut !== generic.checks.printedMoneyOut)
  )
    return undefined;
  // Balance/sign errors that happen to cancel must not pass a net-total check.
  let balance = legacy.openingBalance!;
  for (const transaction of legacy.transactions) {
    try {
      if (
        parseDate(transaction.date) !== transaction.date ||
        (transaction.bookingDate !== undefined &&
          parseDate(transaction.bookingDate) !== transaction.bookingDate)
      )
        return undefined;
    } catch {
      return undefined;
    }
    if (
      transaction.currency !== legacy.currency ||
      !Number.isSafeInteger(transaction.amount) ||
      !transaction.description.trim() ||
      transaction.extractionConfidence < 0.8 ||
      outsideStatementPeriod(transaction, legacy.periodStart, legacy.periodEnd)
    )
      return undefined;
    balance += transaction.amount;
    if (
      !Number.isSafeInteger(balance) ||
      (transaction.balanceAfterTransaction !== undefined &&
        transaction.balanceAfterTransaction !== balance)
    )
      return undefined;
  }
  if (generic.rowChecks.length !== legacy.transactions.length) return undefined;
  const remaining = [...generic.rowChecks];
  const sourceRows: RowCheck[] = [];
  for (const transaction of legacy.transactions) {
    const index = remaining.findIndex((row) => {
      const proved = row.difference === 0 && !row.issues.length;
      // A proved source balance always outranks another candidate reading.
      const readings = proved ? [selected(row)].filter(Boolean) : row.readings;
      return readings.some(
        (reading) =>
          reading !== undefined &&
          sameFinancialReading(reading, transaction, row),
      );
    });
    if (index < 0) return undefined;
    sourceRows.push(remaining.splice(index, 1)[0]);
  }
  return { sourceRows };
}
