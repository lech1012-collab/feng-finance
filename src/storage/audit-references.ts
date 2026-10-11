import type { ChangeLog } from "../domain/models";
import type { FinanceDB } from "./database";

type Row = Record<string, unknown>;
const keyOf = (table: string, row: Row) =>
  String(
    row[
      table === "settings" ? "key" : table === "monthCloses" ? "month" : "id"
    ],
  );
const objects = (value: unknown): Row[] =>
  Array.isArray(value)
    ? (value.filter((item) => !!item && typeof item === "object") as Row[])
    : [];
const includes = (value: unknown, id: string) =>
  value === id || (Array.isArray(value) && value.includes(id));
const conditionReferences = (row: Row, field: string, id: string) =>
  objects(row.conditions).some(
    (condition) => condition.field === field && includes(condition.value, id),
  );
const actionReferences = (row: Row, field: string, id: string) =>
  objects(row.actions).some(
    (action) =>
      includes(action[field], id) ||
      objects(action.splits).some((split) => includes(split[field], id)),
  );

const sources: Record<string, string[]> = {
  accounts: [
    "statements",
    "transactions",
    "valuations",
    "pots",
    "recurringSeries",
    "rules",
    "savedViews",
    "savedReports",
  ],
  categories: [
    "transactions",
    "categories",
    "pots",
    "budgets",
    "rules",
    "savedViews",
    "savedReports",
  ],
  tags: ["transactions", "rules", "savedViews", "savedReports"],
  statements: ["transactions"],
  transactions: [
    "transactions",
    "attachments",
    "transferLinks",
    "transferProposals",
  ],
  attachments: ["transactions"],
  recurringSeries: ["transactions", "rules", "scenarios"],
};
const refersTo = (
  source: string,
  row: Row,
  target: string,
  id: string,
): boolean => {
  if (target === "accounts")
    return (
      row.accountId === id ||
      row.linkedAccountId === id ||
      conditionReferences(row, "accountId", id)
    );
  if (target === "categories")
    return (
      row.categoryId === id ||
      row.subcategoryId === id ||
      (source === "categories" && row.parentId === id) ||
      row.linkedCategoryId === id ||
      actionReferences(row, "categoryId", id) ||
      actionReferences(row, "subcategoryId", id) ||
      conditionReferences(row, "categoryId", id)
    );
  if (target === "tags")
    return (
      includes(row.tags, id) ||
      actionReferences(row, "tagIds", id) ||
      conditionReferences(row, "tag", id)
    );
  if (target === "statements") return row.statementId === id;
  if (target === "attachments") return includes(row.attachmentIds, id);
  if (target === "recurringSeries")
    return (
      row.recurringSeriesId === id ||
      actionReferences(row, "recurringSeriesId", id) ||
      objects(row.changes).some((change) => change.recurringSeriesId === id)
    );
  if (target === "transactions")
    return (
      (source === "transactions" &&
        (row.parentId === id ||
          objects(row.refundAllocations).some(
            (allocation) => allocation.transactionId === id,
          ))) ||
      row.transactionId === id ||
      includes(row.transactionIds, id) ||
      row.debitTxId === id ||
      row.creditTxId === id
    );
  return false;
};

/** Check the result of the whole Undo, so related records removed together do not falsely block it. */
export async function assertUndoReferences(
  changes: ChangeLog["changes"],
  database: FinanceDB,
): Promise<void> {
  if (
    changes.some(
      (change) => change.table === "settings" && change.key === "period:start",
    ) &&
    (await database.monthCloses.count())
  )
    throw new Error(
      "Undo the newer month close first before restoring the previous reporting period.",
    );
  const removed = changes.filter(
    (change) => change.before === undefined && sources[change.table],
  );
  if (!removed.length) return;
  const prospective = new Map<string, Map<string, Row>>();
  for (const table of new Set(
    removed.flatMap((change) => sources[change.table]),
  )) {
    const rows = new Map<string, Row>(
      (await database.table(table).toArray()).map((row: Row) => [
        keyOf(table, row),
        row,
      ]),
    );
    for (const change of changes.filter((change) => change.table === table)) {
      if (change.before === undefined) rows.delete(change.key);
      else rows.set(change.key, change.before as Row);
    }
    prospective.set(table, rows);
  }
  for (const change of removed)
    for (const source of sources[change.table]) {
      if (
        [...prospective.get(source)!.values()].some((row) =>
          refersTo(source, row, change.table, change.key),
        )
      )
        throw new Error(
          "Later records depend on this change. Undo those changes first.",
        );
    }
}
