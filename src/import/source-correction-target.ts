import type { ImportDraft } from "../domain/models";
import { normalizeDescription } from "../domain/normalize";
import type { GenericParseResult } from "./generic/types";

export type SourceCorrectionTarget = Pick<
  ImportDraft["transactions"][number],
  "date" | "description" | "sourcePage" | "amount"
>;

/** Navigation only. Never pick between identical purchases or change a source reading. */
export function sourceCorrectionRow(
  result: GenericParseResult,
  target: SourceCorrectionTarget,
) {
  const matches = result.rowChecks.filter(
    (row) =>
      row.rect.page === target.sourcePage &&
      row.readings.some(
        (reading) =>
          (reading.date === target.date ||
            reading.bookingDate === target.date) &&
          normalizeDescription(reading.description) ===
            normalizeDescription(target.description),
      ),
  );
  if (matches.length === 1) return matches[0].rowId;
  const amounts = matches.filter((row) =>
    row.readings.some((reading) => reading.amount === target.amount),
  );
  return amounts.length === 1 ? amounts[0].rowId : undefined;
}
