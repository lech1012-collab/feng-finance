import type { ImportDraft } from "../domain/models";
import { displayMerchant } from "../domain/presentation";
import { sourceReview, type FileReview } from "./review-model";
import {
  rowReviewDecision,
  selectedSourceReading,
} from "./generic/review-decision";
import type { RowCheck } from "./generic/types";

export type ManualReviewRow = {
  id: string;
  description: string;
  date?: string;
  amount?: number;
  needsAttention: boolean;
  label: string;
  source?: RowCheck;
  transaction?: ImportDraft["transactions"][number];
};

/** Navigation and presentation only; never changes source values or proof. */
export function manualReviewRows(entry: FileReview): ManualReviewRow[] {
  const result = sourceReview(entry),
    draft = entry.draft;
  const transactions = new Map(
    draft?.transactions.map((t) => [t.parseRowId, t]),
  );
  if (result && !draft?.parserFallback)
    return result.rowChecks.map((source) => {
      const reading = selectedSourceReading(source);
      const decision = rowReviewDecision(source);
      const transaction = transactions.get(source.rowId);
      return {
        id: source.rowId,
        description: reading?.description || "Unread transaction",
        date: reading?.date,
        amount: reading?.amount,
        source,
        transaction,
        needsAttention: decision.fields.length > 0,
        label:
          source.reviewAction?.kind === "exclude"
            ? "Left out"
            : decision.fields.length
              ? decision.fields.includes("amount")
                ? "Check amount"
                : "Check details"
              : source.reviewAction
                ? "Edited"
                : "Read",
      };
    });
  return (draft?.transactions ?? []).map((transaction) => {
    const needsAttention =
      transaction.include &&
      !transaction.acknowledged &&
      (transaction.extractionConfidence < 0.8 ||
        transaction.duplicate !== "none" ||
        (!!transaction.manualReplacementId &&
          transaction.replaceManual === undefined));
    return {
      id: transaction.id,
      description: displayMerchant(transaction),
      date: transaction.date,
      amount: transaction.amount,
      transaction,
      needsAttention,
      label: !transaction.include
        ? "Left out"
        : needsAttention
          ? "Check amount"
          : "Read",
    };
  });
}
