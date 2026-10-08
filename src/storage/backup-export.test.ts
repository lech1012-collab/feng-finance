import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { db } from "./database";
import { clearLocalData, exportBackupFile, validateBackup } from "./backup";
import { loadDemo } from "./demo";

beforeEach(async () => {
  await clearLocalData();
  await loadDemo();
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:synthetic-backup");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());
describe("backup export traceability", () => {
  it("records download handoff date and exact count in settings and the portable backup", async () => {
    const backup = await exportBackupFile();
    expect(validateBackup(backup)).toEqual(backup);
    expect((await db.settings.get("backup:lastExportAt"))?.value).toBe(
      backup.exportedAt,
    );
    expect((await db.settings.get("backup:lastExportCount"))?.value).toBe(
      String(backup.transactions.length),
    );
    expect(backup.settings).toContainEqual({
      key: "backup:lastExportAt",
      value: backup.exportedAt,
    });
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce();
  });
  it("does not update last-backup metadata if download handoff fails", async () => {
    const old = "2026-09-01T09:00:00.000Z";
    await db.settings.put({ key: "backup:lastExportAt", value: old });
    vi.mocked(HTMLAnchorElement.prototype.click).mockImplementation(() => {
      throw new Error("Download blocked");
    });
    await expect(exportBackupFile()).rejects.toThrow("blocked");
    expect((await db.settings.get("backup:lastExportAt"))?.value).toBe(old);
    expect(await db.settings.get("backup:lastExportCount")).toBeUndefined();
  });
});
