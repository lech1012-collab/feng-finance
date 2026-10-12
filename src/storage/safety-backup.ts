import Dexie, { type Transaction as DexieTransaction } from "dexie";

/** Local structured-clone data; deliberately never portable or audited. */
export const SAFETY_BACKUP_STORE = "safetyBackups";
export const SAFETY_BACKUP_KEY = "latest";
export const SAFETY_RECOVERY_STATE_KEY = "recovery-state";
export const SAFETY_BACKUP_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

export interface SafetyBackupIndex {
  name: string;
  keyPath: string | string[];
  unique: boolean;
  multiEntry: boolean;
}
export interface SafetyBackupRow {
  key: IDBValidKey;
  value: unknown;
}
export interface SafetyBackupTable {
  name: string;
  keyPath: string | string[] | null;
  autoIncrement: boolean;
  indexes: SafetyBackupIndex[];
  rows: SafetyBackupRow[];
}
export interface SafetyBackup {
  key: typeof SAFETY_BACKUP_KEY;
  format: "feng-native-migration-safety";
  version: 1;
  databaseName: string;
  sourceNativeVersion: number;
  targetNativeVersion: number;
  targetAppVersion: string;
  capturedAt: string;
  expiresAt: string;
  tables: SafetyBackupTable[];
}
export interface SafetyRecoveryState {
  key: typeof SAFETY_RECOVERY_STATE_KEY;
  format: "feng-native-recovery-state";
  recoveredAt: string;
  capturedAt: string;
  sourceNativeVersion: number;
}
export type SafetyBackupRecord = SafetyBackup | SafetyRecoveryState;
export interface SafetyBackupPreview {
  capturedAt: string;
  expiresAt: string;
  sourceNativeVersion: number;
  targetNativeVersion: number;
  targetAppVersion: string;
  counts: Readonly<Record<string, number>>;
  includesSecuritySettings: boolean;
  includesAttachments: boolean;
}
export interface SafetyUpgradeContext {
  sourceNativeVersion: number;
  targetNativeVersion: number;
  sourceSchema: Omit<SafetyBackupTable, "rows">[];
  capturedInThisTransaction: boolean;
}

export class MigrationSafetyBackupError extends Error {
  constructor(cause: unknown) {
    super(
      "Feng could not save a local safety backup, so the update was stopped and your previous data was kept. Free device storage, export a backup using the previous version if available, and try again.",
      { cause },
    );
    this.name = "MigrationSafetyBackupError";
  }
}

function schemaBeforeUpgrade(
  native: IDBDatabase,
  transaction: IDBTransaction,
): Omit<SafetyBackupTable, "rows">[] {
  return Array.from(native.objectStoreNames)
    .filter((name) => name !== SAFETY_BACKUP_STORE)
    .map((name) => {
      const store = transaction.objectStore(name);
      return {
        name,
        keyPath: store.keyPath,
        autoIncrement: store.autoIncrement,
        indexes: Array.from(store.indexNames).map((name) => {
          const index = store.index(name);
          return {
            name,
            keyPath: index.keyPath,
            unique: index.unique,
            multiEntry: index.multiEntry,
          };
        }),
      };
    });
}

/** Observe the original schema synchronously before Dexie's upgrade listener. */
export function migrationSafeFactory(
  factory: IDBFactory,
  name: string,
  context: SafetyUpgradeContext,
): IDBFactory {
  return new Proxy(factory, {
    get(target, property) {
      if (property === "open")
        return (databaseName: string, version?: number) => {
          const request =
            version === undefined
              ? target.open(databaseName)
              : target.open(databaseName, version);
          request.addEventListener("upgradeneeded", (event) => {
            if (databaseName !== name) return;
            context.sourceNativeVersion = event.oldVersion;
            context.targetNativeVersion =
              event.newVersion ?? request.result.version;
            context.capturedInThisTransaction = false;
            context.sourceSchema =
              event.oldVersion && request.transaction
                ? schemaBeforeUpgrade(request.result, request.transaction)
                : [];
          });
          return request;
        };
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function rawRows(store: IDBObjectStore): Dexie.Promise<SafetyBackupRow[]> {
  return new Dexie.Promise((resolve, reject) => {
    const rows: SafetyBackupRow[] = [];
    const request = store.openCursor();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return resolve(rows);
      rows.push({ key: cursor.primaryKey, value: cursor.value as unknown });
      cursor.continue();
    };
  });
}

/** MUST run first in every historical content upgrader, before any mutation. */
export async function captureBeforeMigration(
  transaction: DexieTransaction,
  context: SafetyUpgradeContext,
  appVersion: string,
  now = Date.now(),
): Promise<void> {
  if (!context.sourceNativeVersion || context.capturedInThisTransaction) return;
  context.capturedInThisTransaction = true;
  try {
    const tables = await Dexie.Promise.all(
      context.sourceSchema.map(async (schema) => ({
        ...schema,
        rows: await rawRows(transaction.idbtrans.objectStore(schema.name)),
      })),
    );
    // An older but entirely empty database has no user state to recover. Do not
    // create an empty recovery action that could suppress fresh initialization.
    if (tables.every((table) => table.rows.length === 0)) return;
    const backup: SafetyBackup = {
      key: SAFETY_BACKUP_KEY,
      format: "feng-native-migration-safety",
      version: 1,
      databaseName: transaction.db.name,
      sourceNativeVersion: context.sourceNativeVersion,
      targetNativeVersion: context.targetNativeVersion,
      targetAppVersion: appVersion,
      capturedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + SAFETY_BACKUP_RETENTION_MS).toISOString(),
      tables,
    };
    await transaction
      .table<SafetyBackupRecord>(SAFETY_BACKUP_STORE)
      .put(backup);
  } catch (error) {
    // Reject the versionchange transaction: financial rows/schema also roll back.
    throw new MigrationSafetyBackupError(error);
  }
}

function validBackup(
  record: SafetyBackupRecord | undefined,
): record is SafetyBackup {
  return (
    record?.key === SAFETY_BACKUP_KEY &&
    record.format === "feng-native-migration-safety" &&
    record.version === 1 &&
    Array.isArray(record.tables) &&
    typeof record.databaseName === "string" &&
    Number.isSafeInteger(record.sourceNativeVersion) &&
    record.sourceNativeVersion > 0 &&
    Number.isSafeInteger(record.targetNativeVersion) &&
    record.targetNativeVersion > record.sourceNativeVersion &&
    Number.isFinite(Date.parse(record.capturedAt)) &&
    Number.isFinite(Date.parse(record.expiresAt)) &&
    Date.parse(record.expiresAt) > Date.parse(record.capturedAt)
  );
}

/** Expiry is enforced on local access; a closed browser cannot run a timer. */
export async function expireSafetyBackup(
  database: Dexie,
  now = Date.now(),
): Promise<void> {
  const table = database.table<SafetyBackupRecord>(SAFETY_BACKUP_STORE);
  await database.transaction("rw", table, async () => {
    const record = await table.get(SAFETY_BACKUP_KEY);
    if (validBackup(record) && Date.parse(record.expiresAt) <= now)
      await table.delete(SAFETY_BACKUP_KEY);
  });
}

export async function previousDataPreview(
  database: Dexie,
  now = Date.now(),
): Promise<SafetyBackupPreview | undefined> {
  const record = await database
    .table<SafetyBackupRecord>(SAFETY_BACKUP_STORE)
    .get(SAFETY_BACKUP_KEY);
  // Keep this getter read-only so it is safe inside Dexie liveQuery. Startup and
  // the Settings access effect delete expired payloads separately.
  if (!validBackup(record) || Date.parse(record.expiresAt) <= now)
    return undefined;
  return {
    capturedAt: record.capturedAt,
    expiresAt: record.expiresAt,
    sourceNativeVersion: record.sourceNativeVersion,
    targetNativeVersion: record.targetNativeVersion,
    targetAppVersion: record.targetAppVersion,
    counts: Object.fromEntries(
      record.tables.map((table) => [table.name, table.rows.length]),
    ),
    includesSecuritySettings: record.tables.some(
      (table) =>
        table.name === "settings" &&
        table.rows.some(
          (row) =>
            typeof row.key === "string" && row.key.startsWith("security:"),
        ),
    ),
    includesAttachments: record.tables.some(
      (table) => table.name === "attachments" && table.rows.length > 0,
    ),
  };
}

export async function isExactRecovery(database: Dexie): Promise<boolean> {
  const record = await database
    .table<SafetyBackupRecord>(SAFETY_BACKUP_STORE)
    .get(SAFETY_RECOVERY_STATE_KEY);
  return (
    record?.key === SAFETY_RECOVERY_STATE_KEY &&
    record.format === "feng-native-recovery-state" &&
    Number.isFinite(Date.parse(record.recoveredAt)) &&
    Number.isFinite(Date.parse(record.capturedAt))
  );
}

function nativeWrite<T>(request: IDBRequest<T>): Dexie.Promise<T> {
  return new Dexie.Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Atomically restores original primary keys and raw values under the CURRENT
 * additive schema. It does not downgrade/delete/recreate IndexedDB.
 */
export async function restorePreviousData(
  database: Dexie,
  expectedCapturedAt: string,
  now = Date.now(),
): Promise<void> {
  await database.transaction("rw", database.tables, async (transaction) => {
    const record = await transaction
      .table<SafetyBackupRecord>(SAFETY_BACKUP_STORE)
      .get(SAFETY_BACKUP_KEY);
    if (
      !validBackup(record) ||
      record.databaseName !== database.name ||
      record.capturedAt !== expectedCapturedAt ||
      record.targetNativeVersion > database.backendDB().version ||
      !Number.isFinite(Date.parse(record.expiresAt)) ||
      Date.parse(record.expiresAt) <= now
    )
      throw new Error(
        "The previous-data safety backup has expired or changed. Your current data was kept.",
      );
    const available = new Set(database.tables.map((table) => table.name));
    if (
      record.tables.some(
        (table) =>
          table.name === SAFETY_BACKUP_STORE || !available.has(table.name),
      ) ||
      new Set(record.tables.map((table) => table.name)).size !==
        record.tables.length
    )
      throw new Error(
        "The previous-data safety backup is incompatible. Your current data was kept.",
      );
    for (const table of database.tables)
      if (table.name !== SAFETY_BACKUP_STORE)
        await nativeWrite(transaction.idbtrans.objectStore(table.name).clear());
    for (const table of record.tables) {
      const store = transaction.idbtrans.objectStore(table.name);
      for (const row of table.rows)
        await nativeWrite(
          store.keyPath === null
            ? store.put(row.value, row.key)
            : store.put(row.value),
        );
    }
    const recovery: SafetyRecoveryState = {
      key: SAFETY_RECOVERY_STATE_KEY,
      format: "feng-native-recovery-state",
      recoveredAt: new Date(now).toISOString(),
      capturedAt: record.capturedAt,
      sourceNativeVersion: record.sourceNativeVersion,
    };
    // No credentials/rows in the retained marker; it prevents startup defaults
    // from silently changing exactly recovered history after payload expiry.
    await transaction
      .table<SafetyBackupRecord>(SAFETY_BACKUP_STORE)
      .put(recovery);
  });
}
