import { File as NodeFile } from "node:buffer";
import { afterEach, describe, expect, it } from "vitest";
import { FinanceDB } from "./database";
import { transaction } from "../tests/helpers";
import {
  addTransactionAttachment,
  attachmentStorageBytes,
  imageDimensions,
  prepareAttachment,
  removeTransactionAttachment,
  saveTransactionNote,
} from "./attachments";
import { undoChange } from "./audit";
const databases: FinanceDB[] = [];
function testDatabase() {
  const database = new FinanceDB(`security-attachments-${crypto.randomUUID()}`);
  databases.push(database);
  return database;
}
function pdfFile(name = "receipt.pdf"): File {
  return new NodeFile(["%PDF-1.7\nsynthetic receipt"], name, {
    type: "application/pdf",
  }) as unknown as File;
}
afterEach(async () => {
  for (const database of databases.splice(0)) {
    database.close();
    await database.delete();
  }
});
describe("private notes and attachments", () => {
  it("compresses only to the permitted long edge without upscaling", () => {
    expect(imageDimensions(4000, 3000)).toEqual({ width: 1600, height: 1200 });
    expect(imageDimensions(800, 1200)).toEqual({ width: 800, height: 1200 });
    expect(imageDimensions(3000, 6000)).toEqual({ width: 800, height: 1600 });
  });
  it("commits attachment references atomically and supports Undo for attachment deletion and notes", async () => {
    const database = testDatabase();
    await database.transactions.add(transaction());
    const added = await addTransactionAttachment("t1", pdfFile(), database);
    expect((await database.transactions.get("t1"))?.attachmentIds).toEqual([
      added.result.id,
    ]);
    expect(await attachmentStorageBytes(database)).toBe(added.result.sizeBytes);
    const removed = await removeTransactionAttachment(
      added.result.id,
      database,
    );
    expect(await database.attachments.count()).toBe(0);
    await undoChange(removed.changeId, database);
    expect(await database.attachments.count()).toBe(1);
    expect((await database.transactions.get("t1"))?.attachmentIds).toEqual([
      added.result.id,
    ]);
    const saved = await saveTransactionNote("t1", "  Trip receipt  ", database);
    expect((await database.transactions.get("t1"))?.note).toBe("Trip receipt");
    await undoChange(saved.changeId, database);
    expect((await database.transactions.get("t1"))?.note).toBeUndefined();
  });
  it("limits each transaction to five attachments and rejects unsafe formats", async () => {
    const database = testDatabase();
    await database.transactions.add(transaction());
    for (let number = 0; number < 5; number++)
      await addTransactionAttachment("t1", pdfFile(`${number}.pdf`), database);
    await expect(
      addTransactionAttachment("t1", pdfFile("sixth.pdf"), database),
    ).rejects.toThrow("up to 5 attachments");
    expect(await database.attachments.count()).toBe(5);
    expect((await database.transactions.get("t1"))?.attachmentIds).toHaveLength(
      5,
    );
    await expect(
      prepareAttachment(
        new NodeFile(["<svg></svg>"], "bad.svg", {
          type: "image/svg+xml",
        }) as unknown as File,
      ),
    ).rejects.toThrow("SVG and HTML");
    await expect(
      prepareAttachment(
        new NodeFile(["fake content"], "bad.pdf", {
          type: "application/pdf",
        }) as unknown as File,
      ),
    ).rejects.toThrow("not a valid PDF");
  });
});
