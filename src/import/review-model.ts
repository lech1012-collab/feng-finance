import type { ImportDraft, Institution } from "../domain/models";
import type { ExtractedFile } from "./pipeline";
import { reconcile } from "../domain/reconcile";
import { parseDate } from "../domain/dates";

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
}

export function needsRowCheck(
  row: ImportDraft["transactions"][number],
  draft: ImportDraft,
) {
  return (
    row.extractionConfidence < 0.8 ||
    row.duplicate !== "none" ||
    row.date < draft.statement.statementPeriodStart ||
    row.date > draft.statement.statementPeriodEnd
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
  if (
    reconcile(
      draft.statement.openingBalance,
      draft.statement.closingBalance,
      draft.transactions.map((t) => t.amount),
    ).status === "warning" &&
    !entry.override
  )
    blockers.push("Review or explicitly accept the balance difference.");
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
    draft.transactions.some(
      (row) =>
        row.date < draft.statement.statementPeriodStart ||
        row.date > draft.statement.statementPeriodEnd,
    )
  )
    blockers.push("Verify transactions dated outside the statement period.");
  if (draft.warnings.length && !draft.reviewedWarnings)
    blockers.push(
      "Compare the extracted rows with the PDF and confirm the warning.",
    );
  if (
    draft.transactions.some(
      (t) =>
        t.include &&
        (t.extractionConfidence < 0.8 || t.duplicate !== "none") &&
        !t.acknowledged,
    )
  )
    blockers.push("Verify the highlighted amounts or kept duplicates.");
  return blockers;
}
