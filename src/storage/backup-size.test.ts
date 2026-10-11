import { Blob as NativeBlob } from "node:buffer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "./database";
import {
  clearLocalData,
  createBackup,
  exportBackupFile,
  validateBackup,
} from "./backup";
import { MAX_BACKUP_FILE_BYTES } from "./backup-limits";
import { accounts, transaction } from "../tests/helpers";

// Exercise the real serialization/download boundary with a small quota instead
// of allocating a 100 MB fixture in every CI worker. Production uses 100 MB.
vi.mock("./backup-limits", async (original) => ({
  ...(await original<typeof import("./backup-limits")>()),
  MAX_BACKUP_FILE_BYTES: 32_768,
}));

beforeEach(async () => {
  vi.stubGlobal("Blob", NativeBlob);
  await clearLocalData();
  await db.accounts.put(accounts[0]);
  await db.transactions.put(
    transaction({
      source: "manual",
      statementId: "",
      sourcePage: 0,
      attachmentIds: ["receipt"],
      categoryId: "shopping",
    }),
  );
  const blob = new Blob(["%PDF-1.7\n", "Fictitious receipt\n".repeat(4000)], {
    type: "application/pdf",
  });
  await db.attachments.put({
    id: "receipt",
    transactionId: "t1",
    mime: "application/pdf",
    sizeBytes: blob.size,
    blob,
    name: "synthetic-receipt.pdf",
  });
  await db.settings.bulkPut([
    { key: "backup:lastExportAt", value: "2026-09-01T09:00:00.000Z" },
    { key: "backup:importsSinceExport", value: "2" },
  ]);
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:synthetic-backup");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("restorable plaintext backup size", () => {
  it("rejects oversized serialized attachment backups before download or metadata changes", async () => {
    const full = await createBackup();
    expect(new Blob([JSON.stringify(full, null, 2)]).size).toBeGreaterThan(
      MAX_BACKUP_FILE_BYTES,
    );
    const before = await db.settings.toArray();
    await expect(exportBackupFile()).rejects.toThrow(
      "Turn off Include attachments",
    );
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
    expect(await db.settings.toArray()).toEqual(before);
    expect(await db.attachments.count()).toBe(1);
  });
  it("exports a validated financial backup without attachments while keeping the originals locally", async () => {
    const backup = await exportBackupFile({ includeAttachments: false });
    expect(validateBackup(backup)).toEqual(backup);
    expect(backup.attachments).toEqual([]);
    expect(backup.transactions[0].attachmentIds).toEqual([]);
    expect(await db.attachments.count()).toBe(1);
    expect((await db.transactions.get("t1"))?.attachmentIds).toEqual([
      "receipt",
    ]);
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce();
    expect((await db.settings.get("backup:importsSinceExport"))?.value).toBe(
      "0",
    );
  });
});
