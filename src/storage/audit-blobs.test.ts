// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { FinanceDB } from "./database";
import { auditedMutation, undoChange } from "./audit";
import { removeTransactionAttachment } from "./attachments";
import { transaction } from "../tests/helpers";

const databases: FinanceDB[] = [];
function createDatabase() {
  const database = new FinanceDB(`audit-bytes-${crypto.randomUUID()}`);
  databases.push(database);
  return database;
}
afterEach(async () => {
  vi.restoreAllMocks();
  for (const database of databases.splice(0)) await database.delete();
});

it("owns attachment snapshot bytes so deleting the source remains safely undoable", async () => {
  const database = createDatabase();
  await database.transactions.put(transaction({ attachmentIds: ["receipt"] }));
  await database.attachments.put({
    id: "receipt",
    transactionId: "t1",
    mime: "application/pdf",
    sizeBytes: 22,
    blob: new Blob(["synthetic receipt bytes"], { type: "application/pdf" }),
  });
  const read = vi.spyOn(Blob.prototype, "arrayBuffer");
  const removed = await removeTransactionAttachment("receipt", database);
  expect(read).toHaveBeenCalledOnce();
  expect(await database.attachments.count()).toBe(0);
  const change = await database.changeLog.get(removed.changeId);
  const snapshot = change!.changes.find((row) => row.table === "attachments")!
    .before as { blob: Blob };
  expect(await snapshot.blob.text()).toBe("synthetic receipt bytes");
  await undoChange(removed.changeId, database);
  expect(await (await database.attachments.get("receipt"))!.blob.text()).toBe(
    "synthetic receipt bytes",
  );
  expect((await database.transactions.get("t1"))?.attachmentIds).toEqual([
    "receipt",
  ]);
});

it("rolls back deletion and references if independent audit bytes cannot be read", async () => {
  const database = createDatabase();
  const original = transaction({ attachmentIds: ["receipt"] });
  await database.transactions.put(original);
  await database.attachments.put({
    id: "receipt",
    transactionId: "t1",
    mime: "application/pdf",
    sizeBytes: 22,
    blob: new Blob(["synthetic receipt bytes"], { type: "application/pdf" }),
  });
  vi.spyOn(Blob.prototype, "arrayBuffer").mockRejectedValue(
    new Error("Synthetic Blob read failure"),
  );
  await expect(
    removeTransactionAttachment("receipt", database),
  ).rejects.toThrow("Synthetic Blob read failure");
  expect(await database.attachments.count()).toBe(1);
  expect(await database.transactions.get("t1")).toEqual(original);
  expect(await database.changeLog.count()).toBe(0);
});

it("does not read Blob bytes or copy the ledger for an ordinary text edit", async () => {
  const database = createDatabase();
  await database.transactions.put(transaction());
  const read = vi.spyOn(Blob.prototype, "arrayBuffer");
  const changed = await auditedMutation(
    "Edit synthetic note",
    ["transactions"],
    () => database.transactions.update("t1", { note: "Synthetic note" }),
    database,
  );
  expect(read).not.toHaveBeenCalled();
  expect(
    (await database.changeLog.get(changed.changeId))?.changes,
  ).toHaveLength(1);
});
