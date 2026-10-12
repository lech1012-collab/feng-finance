// @vitest-environment node
import Dexie from "dexie";
import { IDBObjectStore } from "fake-indexeddb";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { FinanceDB, initializeDatabase } from "./database";
import {
  SAFETY_BACKUP_RETENTION_MS,
  SAFETY_BACKUP_STORE,
  MigrationSafetyBackupError,
  previousDataPreview,
  restorePreviousData,
  isExactRecovery,
  expireSafetyBackup,
  type SafetyBackup,
  type SafetyBackupRecord,
} from "./safety-backup";

const now = new Date("2026-10-11T12:00:00.000Z").getTime();
const databases: Dexie[] = [];
const schema1 = {
  accounts: "id,institution,currency",
  statements:
    "id,accountId,sourceFileHash,statementPeriodEnd,[accountId+statementPeriodStart+statementPeriodEnd]",
  transactions:
    "id,date,accountId,statementId,categoryId,transactionFingerprint,[currency+date],[accountId+date]",
  categories: "id,parentId",
  rules: "id,priority",
  transferLinks: "id",
  settings: "key",
};
const schema3 = {
  accounts: "id,institution,currency,accountType,tracking",
  transactions:
    "id,date,accountId,statementId,categoryId,transactionFingerprint,[currency+date],[accountId+date],merchant,parentId,kind,source,*tags",
  valuations: "id,accountId,date,[accountId+date]",
  pots: "id,type,linkedAccountId,linkedCategoryId",
  budgets: "id,month,categoryId,[currency+month],[categoryId+month]",
  tags: "id,name",
  recurringSeries: "id,accountId,nextDue,status,matchKey",
  monthCloses: "month,closedAt",
  attachments: "id,transactionId",
  fxRates: "id,date,[base+quote+date]",
  transferProposals: "id,debitTxId,creditTxId,status",
  savedViews: "id,name",
  savedReports: "id,name",
  scenarios: "id,createdAt",
  changeLog: "id,createdAt,undoneAt",
};

async function rawRecords(database: Dexie) {
  return database.transaction("r", database.tables, async (transaction) => {
    const entries = await Dexie.Promise.all(
      database.tables
        .filter((table) => table.name !== SAFETY_BACKUP_STORE)
        .map(
          (table) =>
            new Dexie.Promise<[string, unknown[]]>((resolve, reject) => {
              const values: unknown[] = [];
              const request = transaction.idbtrans
                .objectStore(table.name)
                .openCursor();
              request.onerror = () => reject(request.error);
              request.onsuccess = () => {
                const cursor = request.result;
                if (!cursor) return resolve([table.name, values]);
                values.push({
                  key: cursor.primaryKey,
                  value: cursor.value as unknown,
                });
                cursor.continue();
              };
            }),
        ),
    );
    return Object.fromEntries(entries);
  });
}
async function createLegacy(version: 1 | 2 | 3) {
  const name = `safety-v${version}-${crypto.randomUUID()}`;
  const database = new Dexie(name);
  database.version(1).stores(schema1);
  if (version >= 2)
    database
      .version(2)
      .stores({ transactions: schema1.transactions + ",merchant" });
  if (version >= 3) database.version(3).stores(schema3);
  databases.push(database);
  await database.table("accounts").put({
    id: "account",
    institution: "Other",
    currency: "GBP",
    missingValue: undefined,
  });
  await database.table("transactions").put({
    id: "transaction",
    accountId: "account",
    date: "2026-10-01",
    amount: -12345,
    description: "SYNTHETIC SHOP",
    merchant: "SYNTHETIC SHOP",
    sourcePage: 2,
    isTransfer: false,
    rawMetadata: new Map([["synthetic-key", new Date("2026-01-02")]]),
    rawBytes: new Uint8Array([3, 1, 4]),
  });
  await database.table("settings").bulkPut([
    { key: "security:pinHash", value: "synthetic-original-pin-hash" },
    { key: "security:credentialId", value: "synthetic-original-credential" },
    { key: "transferMatching", value: "automatic" },
  ]);
  await database.table("categories").put({
    id: "custom",
    name: "User category",
    kind: "expense",
    archived: false,
    color: "#ffffff",
  });
  if (version >= 3)
    await database.table("attachments").put({
      id: "receipt",
      transactionId: "transaction",
      blob: new Blob(["synthetic local receipt"], { type: "image/png" }),
    });
  const records = await rawRecords(database);
  database.close();
  const current = new FinanceDB(name);
  databases.push(current);
  return { current, name, records };
}

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(now);
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const database of databases.splice(0).reverse()) {
    database.close();
    await database.delete();
  }
});

describe("atomic pre-migration safety backup", () => {
  it.each([1, 2, 3] as const)(
    "captures native schema %s before defaults, even when opened implicitly by app lock",
    async (version) => {
      const { current, records } = await createLegacy(version);
      const [pin] = await current.settings.bulkGet(["security:pinHash"]);
      expect(pin?.value).toBe("synthetic-original-pin-hash");
      const snapshot = await current
        .table<SafetyBackup>(SAFETY_BACKUP_STORE)
        .get("latest");
      expect(snapshot?.sourceNativeVersion).toBe(version * 10);
      expect(snapshot?.targetNativeVersion).toBe(40);
      expect(
        snapshot?.tables.some((table) => table.name === SAFETY_BACKUP_STORE),
      ).toBe(false);
      expect(
        Object.fromEntries(
          snapshot!.tables.map((table) => [table.name, table.rows]),
        ),
      ).toEqual(records);
      expect((await current.settings.get("transferMatching"))?.value).toBe(
        version < 3 ? "manual" : "automatic",
      );
      expect(await current.table(SAFETY_BACKUP_STORE).count()).toBe(1);
      const first = snapshot?.capturedAt;
      current.close();
      await current.open();
      expect(
        (await current.table<SafetyBackup>(SAFETY_BACKUP_STORE).get("latest"))
          ?.capturedAt,
      ).toBe(first);
    },
  );

  it("stops the migration on snapshot quota failure and can retry the same instance", async () => {
    const { current, name, records } = await createLegacy(1);
    const originalPut = IDBObjectStore.prototype.put;
    const put = vi
      .spyOn(IDBObjectStore.prototype, "put")
      .mockImplementation(function (
        this: IDBObjectStore,
        value: unknown,
        key?: IDBValidKey,
      ) {
        if (this.name === SAFETY_BACKUP_STORE)
          throw new DOMException(
            "Synthetic quota failure",
            "QuotaExceededError",
          );
        return originalPut.call(this, value, key);
      });
    await expect(current.settings.get("security:pinHash")).rejects.toThrow(
      "Feng could not save a local safety backup",
    );
    put.mockRestore();
    const native = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    expect(native.version).toBe(10);
    expect(native.objectStoreNames.contains(SAFETY_BACKUP_STORE)).toBe(false);
    native.close();
    await current.open();
    const snapshot = await current
      .table<SafetyBackup>(SAFETY_BACKUP_STORE)
      .get("latest");
    expect(
      Object.fromEntries(
        snapshot!.tables.map((table) => [table.name, table.rows]),
      ),
    ).toEqual(records);
  });

  it("rolls back a later upgrade failure along with its snapshot and earlier defaults", async () => {
    const { current, name } = await createLegacy(1);
    const originalPut = IDBObjectStore.prototype.put;
    const put = vi
      .spyOn(IDBObjectStore.prototype, "put")
      .mockImplementation(function (
        this: IDBObjectStore,
        value: unknown,
        key?: IDBValidKey,
      ) {
        if (
          this.name === "settings" &&
          (value as { key?: string }).key === "transferMatching"
        )
          throw new Error("Synthetic content failure");
        return originalPut.call(this, value, key);
      });
    await expect(current.open()).rejects.toThrow("Synthetic content failure");
    put.mockRestore();
    const old = new Dexie(name);
    old.version(1).stores(schema1);
    databases.push(old);
    expect(
      (await old.table("transactions").get("transaction")).tags,
    ).toBeUndefined();
    expect((await old.table("settings").get("transferMatching")).value).toBe(
      "automatic",
    );
    expect(old.backendDB().objectStoreNames.contains(SAFETY_BACKUP_STORE)).toBe(
      false,
    );
  });

  it("does not fabricate a previous-data snapshot on a new installation", async () => {
    const database = new FinanceDB(`safety-empty-${crypto.randomUUID()}`);
    databases.push(database);
    await initializeDatabase(database);
    expect(await previousDataPreview(database)).toBeUndefined();
    expect(await database.categories.count()).toBeGreaterThan(0);
  });

  it.each([1, 2, 3] as const)(
    "does not offer empty recovery for an existing but empty schema %s",
    async (version) => {
      const name = `safety-empty-legacy-${version}-${crypto.randomUUID()}`;
      const old = new Dexie(name);
      old.version(1).stores(schema1);
      if (version >= 2)
        old
          .version(2)
          .stores({ transactions: schema1.transactions + ",merchant" });
      if (version >= 3) old.version(3).stores(schema3);
      databases.push(old);
      await old.open();
      old.close();
      const current = new FinanceDB(name);
      databases.push(current);
      await initializeDatabase(current);
      expect(await previousDataPreview(current)).toBeUndefined();
      expect(await isExactRecovery(current)).toBe(false);
      expect(await current.categories.count()).toBeGreaterThan(0);
    },
  );
});

describe("exact previous-data restoration", () => {
  it.each([1, 2, 3] as const)(
    "restores native schema %s raw values/security and clears later/new tables without defaults or audit",
    async (version) => {
      const { current, records } = await createLegacy(version);
      const preview = await previousDataPreview(current);
      expect(preview?.includesSecuritySettings).toBe(true);
      expect(preview?.includesAttachments).toBe(version === 3);
      await initializeDatabase(current);
      await current
        .table("transactions")
        .put({ id: "post-update", amount: 199 });
      await current.settings.put({
        key: "security:pinHash",
        value: "synthetic-new-pin-hash",
      });
      await current.table("layoutTemplates").put({ id: "later-layout" });
      await current.table("importDiagnostics").put({ id: "later-diagnostic" });
      await restorePreviousData(current, preview!.capturedAt);
      const after = await rawRecords(current);
      for (const [name, values] of Object.entries(records))
        expect(after[name]).toEqual(values);
      for (const [name, values] of Object.entries(after))
        if (!(name in records)) expect(values).toEqual([]);
      expect(await isExactRecovery(current)).toBe(true);
      await initializeDatabase(current);
      expect(await rawRecords(current)).toEqual(after);
      if (version === 3)
        expect(
          await (await current.table("attachments").get("receipt")).blob.text(),
        ).toBe("synthetic local receipt");
      current.close();
      await current.open();
      await initializeDatabase(current);
      expect(await rawRecords(current)).toEqual(after);
    },
  );

  it.each(["after-clear", "after-first-write"] as const)(
    "rolls back all records if restoration fails %s",
    async (failure) => {
      const { current } = await createLegacy(3);
      const preview = await previousDataPreview(current);
      await current
        .table("transactions")
        .put({ id: "post-update", amount: -299 });
      const before = await rawRecords(current);
      const originalClear = IDBObjectStore.prototype.clear;
      const originalPut = IDBObjectStore.prototype.put;
      let writes = 0;
      if (failure === "after-clear")
        vi.spyOn(IDBObjectStore.prototype, "clear").mockImplementation(
          function (this: IDBObjectStore) {
            if (this.name === "transactions")
              throw new Error("Synthetic restore clear failure");
            return originalClear.call(this);
          },
        );
      else
        vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
          this: IDBObjectStore,
          value: unknown,
          key?: IDBValidKey,
        ) {
          if (this.name !== SAFETY_BACKUP_STORE && ++writes > 1)
            throw new Error("Synthetic restore write failure");
          return originalPut.call(this, value, key);
        });
      await expect(
        restorePreviousData(current, preview!.capturedAt),
      ).rejects.toThrow("Synthetic restore");
      vi.restoreAllMocks();
      expect(await rawRecords(current)).toEqual(before);
      expect(await isExactRecovery(current)).toBe(false);
    },
  );

  it("expires precisely after 14 days and retains only a nonfinancial recovery marker", async () => {
    const { current } = await createLegacy(2);
    const preview = await previousDataPreview(current);
    await restorePreviousData(current, preview!.capturedAt);
    expect(
      await previousDataPreview(current, now + SAFETY_BACKUP_RETENTION_MS - 1),
    ).toBeDefined();
    await expireSafetyBackup(current, now + SAFETY_BACKUP_RETENTION_MS);
    expect(
      await previousDataPreview(current, now + SAFETY_BACKUP_RETENTION_MS),
    ).toBeUndefined();
    expect(await isExactRecovery(current)).toBe(true);
    const rows = await current
      .table<SafetyBackupRecord>(SAFETY_BACKUP_STORE)
      .toArray();
    expect(rows).toEqual([
      {
        key: "recovery-state",
        format: "feng-native-recovery-state",
        recoveredAt: new Date(now).toISOString(),
        capturedAt: preview!.capturedAt,
        sourceNativeVersion: 20,
      },
    ]);
    await expect(
      restorePreviousData(
        current,
        preview!.capturedAt,
        now + SAFETY_BACKUP_RETENTION_MS,
      ),
    ).rejects.toThrow("expired or changed");
  });

  it("refuses a stale preview without changing any live record", async () => {
    const { current } = await createLegacy(3);
    await previousDataPreview(current);
    const before = await rawRecords(current);
    await expect(
      restorePreviousData(current, "2025-01-01T00:00:00.000Z"),
    ).rejects.toThrow("expired or changed");
    expect(await rawRecords(current)).toEqual(before);
  });
});
