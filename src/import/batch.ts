import type { ImportDraft, Statement } from "../domain/models";
import { commitDraft, refreshReviewedDraft, validateDraft } from "./pipeline";

export interface ReviewedStatement {
  id: string;
  draft: ImportDraft;
  overrideValidation: boolean;
}
export interface BatchOutcome {
  id: string;
  draft: ImportDraft;
  imported: number;
  skipped: number;
  duplicatesSkipped: number;
  excludedUnique: number;
  statementSkipped: boolean;
}

/** Preflight every statement, then commit sequentially. Each statement is atomic;
 * a failure returns control with earlier successful outcomes already reported.
 */
export async function commitReviewedBatch(
  statements: ReviewedStatement[],
  onOutcome: (outcome: BatchOutcome) => void,
  onProgress: (id: string) => void = () => undefined,
) {
  for (const item of statements) {
    if (item.draft.exactDuplicate && !item.draft.duplicateOverride) continue;
    validateDraft(item.draft, item.overrideValidation);
  }
  for (const item of statements) {
    onProgress(item.id);
    const draft = await refreshReviewedDraft(item.draft);
    if (draft.exactDuplicate && !draft.duplicateOverride) {
      onOutcome({
        id: item.id,
        draft,
        imported: 0,
        skipped: draft.transactions.length,
        duplicatesSkipped: draft.transactions.length,
        excludedUnique: 0,
        statementSkipped: true,
      });
      continue;
    }
    const excluded = draft.transactions.filter((row) => !row.include);
    const duplicatesSkipped = excluded.filter(
      (row) => row.duplicate !== "none",
    ).length;
    const excludedUnique = excluded.length - duplicatesSkipped;
    // A regenerated/unchecked document with no selected rows must not replace
    // the evidence for an existing reconciled balance with an empty statement.
    // A genuinely printed balance-only statement (zero extracted rows) is valid.
    if (
      draft.transactions.length > 0 &&
      !draft.transactions.some((row) => row.include)
    ) {
      onOutcome({
        id: item.id,
        draft,
        imported: 0,
        skipped: draft.transactions.length,
        duplicatesSkipped,
        excludedUnique,
        statementSkipped: true,
      });
      continue;
    }
    const imported = await commitDraft(draft, item.overrideValidation);
    onOutcome({
      id: item.id,
      draft,
      imported,
      skipped: draft.transactions.length - imported,
      duplicatesSkipped,
      excludedUnique,
      statementSkipped: false,
    });
  }
}

export interface PeriodNotice {
  kind: "gap" | "overlap";
  start: string;
  end: string;
}
const shift = (date: string, offset: number) =>
  new Date(Date.parse(`${date}T12:00:00Z`) + offset * 86400000)
    .toISOString()
    .slice(0, 10);

/** Only report known gaps between statements; never invent missing history. */
export function statementPeriodNotices(
  draft: ImportDraft,
  history: Pick<
    Statement,
    "accountId" | "statementPeriodStart" | "statementPeriodEnd"
  >[],
): PeriodNotice[] {
  const start = draft.statement.statementPeriodStart;
  const end = draft.statement.statementPeriodEnd;
  const sameAccount = history.filter((s) => s.accountId === draft.account.id);
  const notices: PeriodNotice[] = [];
  for (const s of sameAccount) {
    if (s.statementPeriodEnd >= start && s.statementPeriodStart <= end)
      notices.push({
        kind: "overlap",
        start: s.statementPeriodStart > start ? s.statementPeriodStart : start,
        end: s.statementPeriodEnd < end ? s.statementPeriodEnd : end,
      });
  }
  const previous = sameAccount
    .filter((s) => s.statementPeriodEnd < start)
    .sort((a, b) =>
      b.statementPeriodEnd.localeCompare(a.statementPeriodEnd),
    )[0];
  if (previous && shift(previous.statementPeriodEnd, 1) < start)
    notices.push({
      kind: "gap",
      start: shift(previous.statementPeriodEnd, 1),
      end: shift(start, -1),
    });
  const next = sameAccount
    .filter((s) => s.statementPeriodStart > end)
    .sort((a, b) =>
      a.statementPeriodStart.localeCompare(b.statementPeriodStart),
    )[0];
  if (next && shift(end, 1) < next.statementPeriodStart)
    notices.push({
      kind: "gap",
      start: shift(end, 1),
      end: shift(next.statementPeriodStart, -1),
    });
  return notices;
}
