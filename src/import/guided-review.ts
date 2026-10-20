import {
  importBlockers,
  invalidSourceRows,
  sourceReview,
  type FileReview,
} from "./review-model";
import { draftReconciliation } from "./pipeline";
import type { RowCheck } from "./generic/types";
import { outsideStatementPeriod } from "./statement-period";

export type GuidedReviewStep =
  | { kind: "identity" }
  | { kind: "mapping" }
  | { kind: "recheck" }
  | { kind: "source-row"; row: RowCheck; remaining: number }
  | {
      kind: "transaction";
      row: NonNullable<FileReview["draft"]>["transactions"][number];
    }
  | { kind: "warnings" }
  | { kind: "account-confirmation" }
  | { kind: "validation" }
  | { kind: "error" }
  | { kind: "complete" };

/** Presentation only. All financial gates still belong to importBlockers/commitReviewedBatch. */
export function guidedReviewStep(entry: FileReview): GuidedReviewStep {
  if (entry.skip || entry.state === "saved") return { kind: "complete" };
  const result = sourceReview(entry);
  const d = entry.draft;
  if (entry.requiresBatchRecheck || entry.optionsChanged)
    return { kind: "recheck" };
  if (!d) {
    if (
      entry.extracted?.accountSelection ||
      result?.status === "identity-required" ||
      entry.extracted?.format === "qif"
    )
      return { kind: "identity" };
    if (result && (!result.mapping || !result.parsed))
      return { kind: "mapping" };
    return { kind: "error" };
  }
  if (d.exactDuplicate && !d.duplicateOverride) return { kind: "complete" };
  if (result?.status === "identity-required" && !d.parserFallback)
    return { kind: "identity" };
  if (result && !d.parserFallback) {
    if (!result.mapping) return { kind: "mapping" };
    const invalid = new Set(invalidSourceRows(result).map((row) => row.rowId));
    // Show each row once after a valid manual correction. Unequal totals still
    // reach the separate financial warning; a correction never verifies money.
    const rows = result.rowChecks.filter(
      (row) =>
        row.reviewAction?.kind !== "exclude" &&
        (invalid.has(row.rowId) || (!row.resolved && !row.reviewAction)),
    );
    if (rows.length) {
      // One unread amount can invalidate a whole card total. Fix the concrete
      // source errors first, then recompute: the other rows may reconcile
      // without asking the person to re-enter every readable transaction.
      const unread = rows.filter((row) => invalid.has(row.rowId));
      const questions = unread.length ? unread : rows;
      return {
        kind: "source-row",
        row: questions[0],
        remaining: questions.length,
      };
    }
  }
  const row = d.transactions.find(
    (t) =>
      t.include &&
      ((!!t.manualReplacementId && t.replaceManual === undefined) ||
        (t.duplicate !== "none" && !t.acknowledged) ||
        ((!d.parserReview || d.parserFallback) &&
          t.extractionConfidence < 0.8 &&
          !t.acknowledged)),
  );
  if (row) return { kind: "transaction", row };
  // Choosing an account does not make an unread printed identifier verified.
  // Confirm this once at statement level; do not retype valid native amounts.
  if (d.bankSource && !d.bankSource.parsed.accountIdentifier && !entry.override)
    return { kind: "account-confirmation" };
  if (
    !d.reviewedWarnings &&
    (d.warnings.length ||
      d.transactions.some((t) =>
        outsideStatementPeriod(
          t,
          d.statement.statementPeriodStart,
          d.statement.statementPeriodEnd,
        ),
      ))
  )
    return { kind: "warnings" };
  if (importBlockers(entry).length) {
    if (
      draftReconciliation(d).status === "warning" ||
      (result && !d.parserFallback)
    )
      return { kind: "validation" };
    return { kind: "error" };
  }
  return { kind: "complete" };
}

export function guidedReviewCopy(entry: FileReview) {
  const step = guidedReviewStep(entry);
  switch (step.kind) {
    case "identity":
      return "Identify the account to continue. Transactions will be checked next.";
    case "mapping":
      return "Identify the transaction columns to continue.";
    case "recheck":
      return "Recheck this statement after your changes.";
    case "source-row":
      return `${step.remaining} transaction${step.remaining === 1 ? " needs" : "s need"} checking. Review one at a time.`;
    case "transaction":
      return "Check a transaction before importing this statement.";
    case "warnings":
      return "Check the statement notice before continuing.";
    case "account-confirmation":
      return "Confirm the linked account. This statement will remain unverified.";
    case "validation":
      return "The statement figures still need checking.";
    case "error":
      return (
        entry.error || "This statement needs help before it can be imported."
      );
    case "complete":
      return entry.skip
        ? "This statement will be left out."
        : "No further checks needed.";
  }
}
