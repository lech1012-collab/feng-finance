import { importBlockers, type FileReview } from "./review-model";
import type { ImportDraft } from "../domain/models";

type ReviewedRow = ImportDraft["transactions"][number];

/** Preserve a person's choices while allowing fresh duplicate checks to take effect. */
export function reviewedRowSelection(
  previous: ReviewedRow,
  refreshed: ReviewedRow,
  inclusionWasReviewed: boolean,
): Partial<ReviewedRow> {
  if (previous.transactionFingerprint !== refreshed.transactionFingerprint)
    return {};
  const newlyDuplicate =
    previous.duplicate === "none" && refreshed.duplicate !== "none";
  const noLongerDuplicate =
    previous.duplicate !== "none" && refreshed.duplicate === "none";
  return {
    include: newlyDuplicate
      ? false
      : noLongerDuplicate && !inclusionWasReviewed
        ? refreshed.include
        : previous.include,
    acknowledged: newlyDuplicate
      ? false
      : refreshed.duplicate !== "none"
        ? previous.acknowledged
        : previous.acknowledged || refreshed.acknowledged,
    replaceManual: previous.replaceManual,
  };
}

export type StatementPresentationState =
  "checking" | "attention" | "ready" | "skipped" | "saved";

/** Display state only: the existing review service owns every import gate. */
export function statementPresentation(entry: FileReview) {
  const blockers = importBlockers(entry);
  const state: StatementPresentationState =
    entry.state === "saved"
      ? "saved"
      : entry.skip
        ? "skipped"
        : entry.state === "queued" || entry.state === "checking"
          ? "checking"
          : blockers.length
            ? "attention"
            : entry.draft?.exactDuplicate && !entry.draft.duplicateOverride
              ? "skipped"
              : "ready";
  return { entry, state, blockers };
}

export function batchPresentation(entries: FileReview[]) {
  const statements = entries.map(statementPresentation);
  const attention = statements.filter((item) => item.state === "attention");
  return {
    statements,
    attention,
    readyCount: statements.filter((item) => item.state === "ready").length,
    skippedCount: statements.filter((item) => item.state === "skipped").length,
    savedCount: statements.filter((item) => item.state === "saved").length,
    completedCount: statements.filter((item) => item.state !== "checking")
      .length,
    sorted: [
      ...attention,
      ...statements.filter((item) => item.state !== "attention"),
    ].map((item) => item.entry),
  };
}

/** Keep source sessions, drafts and row decisions by retaining existing objects. */
export function appendBatchEntries(
  current: FileReview[],
  added: FileReview[],
): FileReview[] {
  return [...current, ...added];
}

export function expandBatchStatement(
  entries: FileReview[],
  entryId?: string,
): FileReview[] {
  return entries.map((entry) =>
    entry.open === (entry.id === entryId)
      ? entry
      : { ...entry, open: entry.id === entryId },
  );
}

export function nextAttentionStatement(entries: FileReview[]) {
  const attention = batchPresentation(entries).attention;
  const current = attention.findIndex((item) => item.entry.open);
  return attention[(current + 1) % attention.length]?.entry;
}
