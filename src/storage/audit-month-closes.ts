import type {
  ChangeLog,
  MonthClose,
  Setting,
  Transaction,
} from "../domain/models";
import { reportingPeriod } from "../domain/period";
import type { FinanceDB } from "./database";

/** Undo obeys the same closed-period boundary as a normal edit. Refund linking
 * can restore the snapshots captured alongside the transaction in one Undo. */
export async function assertUndoMonths(
  changes: ChangeLog["changes"],
  database: FinanceDB,
): Promise<void> {
  const transactionChanges = changes.filter(
    (change) => change.table === "transactions",
  );
  if (!transactionChanges.length) return;
  const currentCloses = await database.monthCloses.toArray();
  if (!currentCloses.length) return;
  const [currentRows, currentSettings] = await Promise.all([
    database.transactions.toArray(),
    database.settings.toArray(),
  ]);
  const currentById = new Map(currentRows.map((row) => [row.id, row]));
  const nextById = new Map(currentById);
  for (const change of transactionChanges) {
    if (change.before === undefined) nextById.delete(change.key);
    else nextById.set(change.key, change.before as Transaction);
  }
  const nextSettings = new Map(
    currentSettings.map((setting) => [setting.key, setting]),
  );
  for (const change of changes.filter(
    (change) => change.table === "settings",
  )) {
    if (change.before === undefined) nextSettings.delete(change.key);
    else nextSettings.set(change.key, change.before as Setting);
  }
  const nextCloses = new Map(
    currentCloses.map((close) => [close.month, close]),
  );
  const restoredSnapshots = new Set<string>();
  for (const change of changes.filter(
    (change) => change.table === "monthCloses",
  )) {
    if (change.before === undefined) nextCloses.delete(change.key);
    else {
      nextCloses.set(change.key, change.before as MonthClose);
      restoredSnapshots.add(change.key);
    }
  }
  const dates = new Set<string>();
  for (const change of transactionChanges) {
    for (const snapshot of [change.before, change.after]) {
      if (!snapshot) continue;
      const row = snapshot as Transaction;
      dates.add(row.date);
      // The credit may be in an open month while its original purchase belongs
      // to a closed month. Both versions of the allocation affect that month.
      for (const allocation of row.refundAllocations ?? []) {
        const currentPurchase = currentById.get(allocation.transactionId);
        const nextPurchase = nextById.get(allocation.transactionId);
        if (currentPurchase) dates.add(currentPurchase.date);
        if (nextPurchase) dates.add(nextPurchase.date);
      }
    }
  }
  const nextRows = [...nextById.values()];
  const settings = [...nextSettings.values()];
  for (const close of currentCloses) {
    if (!nextCloses.has(close.month) || restoredSnapshots.has(close.month))
      continue;
    const currentRange = reportingPeriod(
      close.month,
      currentSettings,
      currentRows,
    );
    const nextRange = reportingPeriod(close.month, settings, nextRows);
    const boundariesChange =
      currentRange[0] !== nextRange[0] || currentRange[1] !== nextRange[1];
    const rowChanges = [...dates].some(
      (date) =>
        (date >= currentRange[0] && date < currentRange[1]) ||
        (date >= nextRange[0] && date < nextRange[1]),
    );
    if (boundariesChange || rowChanges)
      throw new Error(
        "This change affects a closed month. Reopen it before using Undo.",
      );
  }
}
