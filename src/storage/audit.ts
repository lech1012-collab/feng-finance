import Dexie, { type Transaction as DexieTransaction } from "dexie";
import type { ChangeLog } from "../domain/models";
import { db, type FinanceDB } from "./database";
import { assertUndoReferences } from "./audit-references";
import { assertUndoMonths } from "./audit-month-closes";

const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const readBlob = (blob: Blob): Promise<ArrayBuffer> =>
  typeof blob.arrayBuffer === "function"
    ? blob.arrayBuffer()
    : new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () =>
          reject(new Error("Attachment could not be compared safely."));
        reader.readAsArrayBuffer(blob);
      });
const sameValue = (a: unknown, b: unknown): boolean | Promise<boolean> => {
  const blobs: [Blob, Blob][] = [];
  const compare = (first: unknown, second: unknown): boolean => {
    if (first === second) return true;
    if (first instanceof Blob && second instanceof Blob) {
      if (first.size !== second.size || first.type !== second.type)
        return false;
      blobs.push([first, second]);
      return true;
    }
    if (Array.isArray(first) && Array.isArray(second))
      return (
        first.length === second.length &&
        first.every((value, index) => compare(value, second[index]))
      );
    if (
      first &&
      second &&
      typeof first === "object" &&
      typeof second === "object"
    ) {
      const before = first as Record<string, unknown>,
        after = second as Record<string, unknown>;
      const keys = Object.keys(before);
      return (
        keys.length === Object.keys(after).length &&
        keys.every((key) => compare(before[key], after[key]))
      );
    }
    return false;
  };
  if (!compare(a, b)) return false;
  if (!blobs.length) return true;
  return Dexie.waitFor(
    Promise.all(
      blobs.map(async ([first, second]) => {
        const [aBytes, bBytes] = await Promise.all([
          readBlob(first),
          readBlob(second),
        ]);
        const left = new Uint8Array(aBytes),
          right = new Uint8Array(bBytes);
        return left.every((value, index) => value === right[index]);
      }),
    ).then((results) => results.every(Boolean)),
  );
};
const belongsTo = (transaction: DexieTransaction, parent: DexieTransaction) => {
  let current: DexieTransaction | undefined = transaction;
  while (current) {
    if (current === parent) return true;
    current = current.parent;
  }
  return false;
};

/** Capture touched records through IndexedDB hooks, so an edit does not copy the entire ledger. */
export async function auditedMutation<T>(
  label: string,
  tableNames: string[],
  operation: () => Promise<T>,
  database: FinanceDB = db,
): Promise<{ result: T; changeId: string }> {
  const names = [...new Set(tableNames)].filter((name) => name !== "changeLog");
  if (!label.trim() || names.length === 0)
    throw new Error("An audited change needs a label and at least one table.");
  if (
    names.some((name) => !database.tables.some((table) => table.name === name))
  )
    throw new Error("Unknown table in audited change.");
  return database.transaction(
    "rw",
    [...names.map((name) => database.table(name)), database.changeLog],
    async () => {
      const auditTransaction = Dexie.currentTransaction!;
      const touched = new Map<
        string,
        { table: string; key: string; before: unknown }
      >();
      const subscriptions: (() => void)[] = [];
      for (const name of names) {
        const table = database.table(name);
        const capture = (
          key: unknown,
          before: unknown,
          transaction: DexieTransaction,
        ) => {
          if (!belongsTo(transaction, auditTransaction)) return;
          if (typeof key !== "string")
            throw new Error(
              "Cannot record a change without a stable identifier.",
            );
          if (name === "settings" && key.startsWith("security:")) return;
          const mapKey = JSON.stringify([name, key]);
          if (!touched.has(mapKey))
            touched.set(mapKey, { table: name, key, before });
        };
        const creating = (
          key: unknown,
          object: unknown,
          transaction: DexieTransaction,
        ) => {
          const record = object as Record<string, unknown>;
          capture(
            key ?? record[table.schema.primKey.keyPath as string],
            undefined,
            transaction,
          );
        };
        const updating = (
          _changes: unknown,
          key: unknown,
          object: unknown,
          transaction: DexieTransaction,
        ) => capture(key, object, transaction);
        const deleting = (
          key: unknown,
          object: unknown,
          transaction: DexieTransaction,
        ) => capture(key, object, transaction);
        table.hook("creating", creating);
        table.hook("updating", updating);
        table.hook("deleting", deleting);
        subscriptions.push(() => {
          table.hook("creating").unsubscribe(creating);
          table.hook("updating").unsubscribe(updating);
          table.hook("deleting").unsubscribe(deleting);
        });
      }
      try {
        const result = await operation();
        const changes: ChangeLog["changes"] = [];
        for (const name of names) {
          const records = [...touched.values()].filter(
            (change) => change.table === name,
          );
          const afterRows = await database
            .table(name)
            .bulkGet(records.map((change) => change.key));
          for (let index = 0; index < records.length; index++) {
            const change = records[index],
              after = afterRows[index];
            const comparison = sameValue(change.before, after);
            if (
              !(typeof comparison === "boolean" ? comparison : await comparison)
            )
              changes.push({
                table: change.table,
                key: change.key,
                ...(change.before === undefined
                  ? {}
                  : { before: change.before }),
                ...(after === undefined ? {} : { after }),
              });
          }
        }
        const changeId = changes.length ? crypto.randomUUID() : "";
        if (changes.length)
          await database.changeLog.add({
            id: changeId,
            label: label.trim(),
            createdAt: new Date().toISOString(),
            changes,
          });
        await database.changeLog
          .where("createdAt")
          .below(new Date(Date.now() - RETENTION_MS).toISOString())
          .delete();
        return { result, changeId };
      } finally {
        for (const unsubscribe of subscriptions) unsubscribe();
      }
    },
  );
}
/** Undo refuses to overwrite later edits to a touched record. Undo that newer change first. */
export async function undoChange(
  id: string,
  database: FinanceDB = db,
): Promise<void> {
  const entry = await database.changeLog.get(id);
  if (!entry || entry.undoneAt)
    throw new Error("This change is no longer available to undo.");
  const names = [...new Set(entry.changes.map((change) => change.table))];
  if (
    names.some(
      (name) =>
        name === "changeLog" ||
        !database.tables.some((table) => table.name === name),
    ) ||
    entry.changes.some(
      (change) =>
        change.table === "settings" && change.key.startsWith("security:"),
    )
  )
    throw new Error("This change refers to an unsupported table.");
  await database.transaction("rw", database.tables, async () => {
    const current = await database.changeLog.get(id);
    if (!current || current.undoneAt)
      throw new Error("This change has already been undone.");
    for (const name of names) {
      const records = entry.changes.filter((change) => change.table === name);
      const currentRows = await database
        .table(name)
        .bulkGet(records.map((change) => change.key));
      for (let index = 0; index < records.length; index++) {
        const comparison = sameValue(currentRows[index], records[index].after);
        if (!(typeof comparison === "boolean" ? comparison : await comparison))
          throw new Error(
            "A later edit affects this change. Undo the newer edit first.",
          );
      }
    }
    await assertUndoMonths(entry.changes, database);
    await assertUndoReferences(entry.changes, database);
    for (const name of [...names].reverse()) {
      const records = entry.changes.filter((change) => change.table === name);
      await database
        .table(name)
        .bulkDelete(
          records
            .filter((change) => change.before === undefined)
            .map((change) => change.key),
        );
      await database
        .table(name)
        .bulkPut(
          records
            .filter((change) => change.before !== undefined)
            .map((change) => change.before),
        );
    }
    await database.changeLog.update(id, {
      undoneAt: new Date().toISOString(),
    });
  });
}
export const keepAuditAlive = Dexie.waitFor;
