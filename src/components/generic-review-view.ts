import { money } from "../domain/money";
import { parseDate } from "../domain/dates";
import type {
  ColumnRole,
  GenericParseResult,
  LayoutMapping,
  ParserMethod,
  RowCheck,
  RowReading,
  RowReviewAction,
  SourceRect,
} from "../import/generic/types";
/** The caller owns the PDF session and disposes it when the file is discarded. */
export interface CropSession {
  crop(rect: SourceRect, options?: { signal?: AbortSignal }): Promise<Blob>;
}
export interface GenericImportReviewProps {
  result: GenericParseResult;
  session?: CropSession;
  currency?: string;
  method?: ParserMethod;
  busy: boolean;
  onAction: (rowId: string, action: RowReviewAction) => void;
  onMapping: (mapping: LayoutMapping) => void;
  onSaveTemplate: (name: string, mapping: LayoutMapping) => void;
  /** Called only after the explicit unverified-import confirmation. */
  onImportAnyway: () => void;
  canImportAnyway?: boolean;
  /** The containing statement owns the shared acceptance sheet when false. */
  showImportAnyway?: boolean;
}
export const roles: { value: ColumnRole; label: string }[] = [
  { value: "date", label: "Date" },
  { value: "description", label: "Description" },
  { value: "in", label: "Money in" },
  { value: "out", label: "Money out" },
  { value: "amount", label: "Signed amount" },
  { value: "balance", label: "Balance" },
  { value: "ignore", label: "Ignore" },
];
export const issueCopy: Record<RowCheck["issues"][number], string> = {
  "invalid-date": "The date is missing or is not a valid calendar date.",
  "outside-period":
    "The printed date is outside the statement period. Check it against the PDF; keeping it requires an Unverified import.",
  "invalid-amount": "The amount could not be read.",
  "missing-description": "The description is missing.",
  "missing-balance": "There is no complete running-balance check for this row.",
  "balance-difference": "The amount does not match the running balance.",
  "ambiguous-reading": "More than one reading is possible.",
  "unread-page": "This page has not been read.",
};
export function displayMoney(
  value: number | undefined,
  currency?: string,
  signed = false,
) {
  if (value === undefined) return "Not read";
  if (currency) {
    try {
      return money(value, currency, signed);
    } catch {
      /* Unknown precision stays explicit. */
    }
  }
  return `${value} minor units${currency ? ` (${currency})` : ""}`;
}
export function validReading(
  reading?: RowReading,
): reading is RowReading & { date: string; amount: number } {
  if (
    !reading?.date ||
    !Number.isSafeInteger(reading.amount) ||
    !reading.description.trim()
  )
    return false;
  try {
    return (
      parseDate(reading.date) === reading.date &&
      (reading.bookingDate === undefined ||
        parseDate(reading.bookingDate) === reading.bookingDate)
    );
  } catch {
    return false;
  }
}
export function selectedReading(row: RowCheck) {
  return (
    row.readings.find((reading) => reading.id === row.selectedReadingId) ??
    row.readings[0]
  );
}
export function initialMapping(result: GenericParseResult): LayoutMapping {
  return (
    result.mapping ??
    result.candidates.find(
      (candidate) => candidate.id === result.selectedCandidateId,
    )?.mapping ?? {
      columnRoles: result.table.columns.map((column) => ({
        columnId: column.id,
        role: column.inferredRole ?? "ignore",
      })),
      signConvention: "in_out_columns",
      dateFormat: "auto",
    }
  );
}
export function completeMapping(mapping: LayoutMapping) {
  const values = mapping.columnRoles.map((column) => column.role);
  return (
    values.includes("date") &&
    values.includes("description") &&
    (mapping.signConvention === "in_out_columns"
      ? values.includes("in") || values.includes("out")
      : values.includes("amount"))
  );
}
export function methodLabel(
  method: ParserMethod | undefined,
  result: GenericParseResult,
) {
  if (method === "template") return "Read with a saved layout";
  if (method === "user_mapping") return "Read with your column mapping";
  const sources = new Set(result.rowChecks.map((row) => row.parseSource));
  if (method === "text+ocr" || (sources.has("ocr") && sources.has("text")))
    return "Read from text and images";
  if (method === "ocr" || sources.has("ocr"))
    return "Read from images on this device";
  return "Read from text";
}
