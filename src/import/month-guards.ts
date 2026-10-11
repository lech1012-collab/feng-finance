import type { ImportDraft, Transaction } from "../domain/models";
import { reportingPeriod } from "../domain/period";
import { db } from "../storage/database";

/** Statement anchors change financial history even when there are no rows.
 * These dates only authorize edits; they are never stored as transactions. */
export async function importMonthGuardDates(
  drafts: ImportDraft[],
): Promise<Pick<Transaction, "date">[]> {
  const committed = drafts.filter(
    (draft) =>
      !(draft.exactDuplicate && !draft.duplicateOverride) &&
      (!draft.transactions.length ||
        draft.transactions.some((row) => row.include)),
  );
  const dates: Pick<Transaction, "date">[] = committed.flatMap((draft) =>
    draft.transactions
      .filter((row) => row.include)
      .map((row) => ({ date: row.date })),
  );
  const [closes, settings, transactions] = await Promise.all([
    db.monthCloses.toArray(),
    db.settings.toArray(),
    db.transactions.toArray(),
  ]);
  for (const draft of committed) {
    if (draft.statement.statementDate)
      dates.push({ date: draft.statement.statementDate });
    for (const close of closes) {
      const [from, to] = reportingPeriod(close.month, settings, transactions);
      const intersection =
        from > draft.statement.statementPeriodStart
          ? from
          : draft.statement.statementPeriodStart;
      if (
        intersection <= draft.statement.statementPeriodEnd &&
        intersection < to
      )
        dates.push({ date: intersection });
    }
  }
  return dates;
}
