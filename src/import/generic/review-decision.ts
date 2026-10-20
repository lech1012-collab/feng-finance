import { parseDate } from "../../domain/dates";
import type { RowCheck } from "./types";

export type ReviewField =
  "amount" | "direction" | "date" | "bookingDate" | "description" | "balance";

export function selectedSourceReading(row: RowCheck) {
  return (
    row.readings.find((r) => r.id === row.selectedReadingId) ?? row.readings[0]
  );
}

function validDate(date: string | undefined) {
  try {
    return !!date && parseDate(date) === date;
  } catch {
    return false;
  }
}

/** Extraction validity is independent of the statement's mathematical proof. */
export function rowReviewDecision(row: RowCheck) {
  const reading = selectedSourceReading(row);
  const fields = new Set<ReviewField>();
  if (row.reviewAction?.kind === "exclude")
    return {
      fields: [] as ReviewField[],
      reason: "",
      extraction: "read" as const,
      proof: "unverified" as const,
    };
  if (!Number.isSafeInteger(reading?.amount)) fields.add("amount");
  if (!validDate(reading?.date)) fields.add("date");
  if (reading?.bookingDate !== undefined && !validDate(reading.bookingDate))
    fields.add("bookingDate");
  if (!reading?.description.trim()) fields.add("description");
  if (
    reading?.rawBalance?.trim() &&
    !Number.isSafeInteger(reading.balanceAfterTransaction)
  )
    fields.add("balance");
  if (!row.reviewAction && row.issues.includes("outside-period"))
    fields.add(reading?.bookingDate ? "bookingDate" : "date");
  if (!row.reviewAction && row.issues.includes("balance-difference"))
    fields.add("amount");
  if (
    !row.reviewAction &&
    row.issues.includes("ambiguous-reading") &&
    reading
  ) {
    for (const other of row.readings) {
      if (other.id === reading.id) continue;
      if (other.amount !== reading.amount)
        fields.add(
          other.amount !== undefined &&
            reading.amount !== undefined &&
            Math.abs(other.amount) === Math.abs(reading.amount)
            ? "direction"
            : "amount",
        );
      if (other.date !== reading.date) fields.add("date");
      if (other.bookingDate !== reading.bookingDate) fields.add("bookingDate");
      if (other.description !== reading.description) fields.add("description");
      if (other.balanceAfterTransaction !== reading.balanceAfterTransaction)
        fields.add("balance");
    }
    if (!fields.size) fields.add("amount");
  }
  const reason =
    !reading || !Number.isSafeInteger(reading.amount)
      ? "The amount could not be read. Copy it from the original row."
      : !validDate(reading.date) ||
          (reading.bookingDate !== undefined && !validDate(reading.bookingDate))
        ? "The date could not be read. The amount has been kept."
        : !reading.description.trim()
          ? "The description is missing. The date and amount have been kept."
          : row.issues.includes("balance-difference")
            ? "This amount and the running balance do not agree. Check the original row."
            : row.issues.includes("outside-period")
              ? "This date is outside the statement period. Check the date and statement dates."
              : row.issues.includes("ambiguous-reading")
                ? "The source has conflicting readings. Check the highlighted field."
                : fields.has("balance")
                  ? "The printed running balance could not be read."
                  : "";
  return {
    fields: [...fields],
    reason,
    extraction: fields.size ? ("uncertain" as const) : ("read" as const),
    proof:
      row.checkLevel === "balance"
        ? ("running-balance" as const)
        : row.checkLevel === "total"
          ? ("statement-totals" as const)
          : ("unverified" as const),
  };
}

export function fieldCorrections(rows: RowCheck[]) {
  return rows.filter((row) => rowReviewDecision(row).fields.length > 0);
}
