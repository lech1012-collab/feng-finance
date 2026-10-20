import type { ParsedStatement } from "../../domain/models";
import { normalizeDescription } from "../../domain/normalize";
import type { GenericParseResult } from "./types";
import { selectedSourceReading } from "./review-decision";

/** One-to-one corroboration from this PDF's native reader; never guess between
 * repeated merchants or replace a valid/conflicting generic amount. */
export function recoverNativeAmounts(
  result: GenericParseResult,
  native?: ParsedStatement,
) {
  const parsed = result.parsed;
  if (
    !native ||
    !parsed ||
    parsed.institution !== native.institution ||
    parsed.currency !== native.currency ||
    parsed.accountType !== native.accountType ||
    parsed.periodStart !== native.periodStart ||
    parsed.periodEnd !== native.periodEnd ||
    (parsed.accountIdentifier &&
      native.accountIdentifier &&
      parsed.accountIdentifier !== native.accountIdentifier)
  )
    return {};
  const key = (
    page: number,
    date: string | undefined,
    booking: string | undefined,
    description: string,
  ) => JSON.stringify([page, date, booking, normalizeDescription(description)]);
  const source = new Map<string, typeof native.transactions>();
  for (const row of native.transactions) {
    const id = key(row.sourcePage, row.date, row.bookingDate, row.description);
    source.set(id, [...(source.get(id) ?? []), row]);
  }
  const occurrences = new Map<string, number>();
  for (const row of result.rowChecks) {
    const value = selectedSourceReading(row);
    if (!value) continue;
    const id = key(
      row.rect.page,
      value.date,
      value.bookingDate,
      value.description,
    );
    occurrences.set(id, (occurrences.get(id) ?? 0) + 1);
  }
  const amounts: Record<string, number> = {};
  for (const row of result.rowChecks) {
    const reading = selectedSourceReading(row);
    if (
      !reading?.date ||
      row.reviewAction ||
      row.readings.some((r) => r.amount !== undefined)
    )
      continue;
    const id = key(
      row.rect.page,
      reading.date,
      reading.bookingDate,
      reading.description,
    );
    const matches = source.get(id);
    if (
      occurrences.get(id) === 1 &&
      matches?.length === 1 &&
      matches[0].extractionConfidence >= 0.8 &&
      Number.isSafeInteger(matches[0].amount)
    )
      amounts[row.rowId] = matches[0].amount;
  }
  return amounts;
}
