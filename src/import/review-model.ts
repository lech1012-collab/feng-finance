import type { ImportDraft, Institution } from "../domain/models";
import type { ExtractedFile } from "./pipeline";
import { draftReconciliation, type PdfReviewOptions } from "./pipeline";
import { parseDate } from "../domain/dates";
import type { Account } from "../domain/models";
import type { CsvMapping } from "./formats";
import type { ImportProgress } from "./pdf-session-types";
import type { GenericParseResult } from "./generic/types";
import { outsideStatementPeriod } from "./statement-period";

export interface FileReview {
  id: string;
  file: File;
  state: "queued" | "checking" | "review" | "saved" | "error";
  progress: string;
  extracted?: ExtractedFile;
  draft?: ImportDraft;
  error: string;
  bank: Institution | "";
  accountId: string;
  csvMapping?: CsvMapping;
  accountOverride?: Account;
  manualPeriod: boolean;
  periodStart: string;
  periodEnd: string;
  optionsChanged: boolean;
  override: boolean;
  skip: boolean;
  open: boolean;
  showAll: boolean;
  invalidAmounts: string[];
  imported?: number;
  skipped?: number;
  duplicatesSkipped?: number;
  excludedUnique?: number;
  statementSkipped?: boolean;
  duplicateInBatch?: boolean;
  requiresBatchRecheck?: boolean;
  pdfReviewOptions?: PdfReviewOptions;
  detailedProgress?: ImportProgress;
  cancelled?: boolean;
}

/** Raw source rows must remain reviewable even when normalization failed. */
export function sourceReview(
  entry: FileReview,
): GenericParseResult | undefined {
  return entry.draft?.parserReview ?? entry.extracted?.generic;
}

/** Date correction keeps any dates already read, including recovery-only source metadata. */
export function statementReviewDates(entry: FileReview) {
  const parsed = sourceReview(entry)?.parsed;
  return {
    start:
      entry.periodStart ||
      entry.draft?.statement.statementPeriodStart ||
      parsed?.periodStart ||
      "",
    end:
      entry.periodEnd ||
      entry.draft?.statement.statementPeriodEnd ||
      parsed?.periodEnd ||
      "",
  };
}

export function invalidSourceRows(result: GenericParseResult) {
  return result.rowChecks.filter((row) => {
    if (row.reviewAction?.kind === "exclude") return false;
    const reading =
      row.readings.find((item) => item.id === row.selectedReadingId) ??
      row.readings[0];
    if (
      !reading?.date ||
      !Number.isSafeInteger(reading.amount) ||
      !reading.description.trim()
    )
      return true;
    try {
      return (
        parseDate(reading.date) !== reading.date ||
        (reading.bookingDate !== undefined &&
          parseDate(reading.bookingDate) !== reading.bookingDate)
      );
    } catch {
      return true;
    }
  });
}

export function needsRowCheck(
  row: ImportDraft["transactions"][number],
  draft: ImportDraft,
) {
  return (
    (draft.parserReview && !draft.parserFallback
      ? row.checkLevel === "review" || row.checkLevel === "manual_override"
      : row.extractionConfidence < 0.8) ||
    row.duplicate !== "none" ||
    !!row.manualReplacementId ||
    outsideStatementPeriod(
      row,
      draft.statement.statementPeriodStart,
      draft.statement.statementPeriodEnd,
    )
  );
}

export function importBlockers(entry: FileReview): string[] {
  if (entry.skip || entry.state === "saved") return [];
  if (!entry.draft)
    return [entry.error || "This statement is still being checked."];
  const draft = entry.draft;
  if (
    draft.exactDuplicate &&
    !draft.duplicateOverride &&
    !entry.requiresBatchRecheck
  )
    return [];
  const blockers: string[] = [];
  if (entry.requiresBatchRecheck)
    blockers.push(
      "Recheck this statement because another selected file was skipped or changed.",
    );
  if (draftReconciliation(draft).status === "warning" && !entry.override)
    blockers.push("Review or explicitly accept the balance difference.");
  if (draft.parserReview && !draft.parserFallback) {
    if (invalidSourceRows(draft.parserReview).length)
      blockers.push(
        "Correct or exclude unread dates, descriptions and amounts.",
      );
    if (
      draft.parserReview.status === "identity-required" ||
      !draft.parserReview.mapping
    )
      blockers.push("Confirm the account, dates and column mapping.");
    if (
      (!draft.parserReview.checks.reconciledExactly ||
        draft.parserReview.checks.needsReviewRows > 0) &&
      !entry.override
    )
      blockers.push(
        "Review source rows or explicitly accept an unverified statement.",
      );
  }
  if (entry.optionsChanged)
    blockers.push("Parse again to apply the bank, account or statement dates.");
  if (entry.invalidAmounts.length)
    blockers.push("Correct the invalid amounts.");
  if (
    draft.transactions.some((row) => {
      try {
        parseDate(row.date);
        return false;
      } catch {
        return true;
      }
    })
  )
    blockers.push("Correct the transaction dates.");
  if (
    !draft.reviewedWarnings &&
    draft.transactions.some((row) =>
      outsideStatementPeriod(
        row,
        draft.statement.statementPeriodStart,
        draft.statement.statementPeriodEnd,
      ),
    )
  )
    blockers.push("Verify transactions dated outside the statement period.");
  if (draft.warnings.length && !draft.reviewedWarnings)
    blockers.push(
      "Compare the extracted rows with the source file and confirm the warning.",
    );
  if (
    draft.transactions.some(
      (t) =>
        t.include &&
        (((!draft.parserReview || draft.parserFallback) &&
          t.extractionConfidence < 0.8) ||
          t.duplicate !== "none") &&
        !t.acknowledged,
    )
  )
    blockers.push("Verify the highlighted amounts or kept duplicates.");
  if (
    draft.transactions.some(
      (t) =>
        t.include && t.manualReplacementId && t.replaceManual === undefined,
    )
  )
    blockers.push(
      "Choose whether to replace the matching manual transactions or keep both.",
    );
  return blockers;
}
