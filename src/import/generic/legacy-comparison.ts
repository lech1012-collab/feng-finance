import type { ParsedTransaction } from "../../domain/models";
import { normalizeDescription } from "../../domain/normalize";
import type {
  BankProfile,
  GenericParseResult,
  ParserComparison,
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
