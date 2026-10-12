import type { Dexie } from "dexie";

/** Raw source is opt-in, local-only, and never copied into portable backups/Undo. */
export const IMPORT_DIAGNOSTICS_SETTING = "importDiagnosticsEnabled";
export const MAX_IMPORT_DIAGNOSTICS = 5;

export async function importDiagnosticsEnabled(
  database: Dexie,
): Promise<boolean> {
  return (
    (
      await database
        .table<{ key: string; value: string }>("settings")
        .get(IMPORT_DIAGNOSTICS_SETTING)
    )?.value === "true"
  );
}

export async function setImportDiagnosticsEnabled(
  enabled: boolean,
  database: Dexie,
): Promise<void> {
  await database.transaction(
    "rw",
    database.table("settings"),
    database.table("importDiagnostics"),
    async () => {
      await database
        .table("settings")
        .put({ key: IMPORT_DIAGNOSTICS_SETTING, value: String(enabled) });
      if (!enabled) await database.table("importDiagnostics").clear();
    },
  );
}

export async function retainImportDiagnostics<
  T extends { id: string; createdAt: string },
>(diagnostic: T, database: Dexie): Promise<void> {
  if (!diagnostic.id || !Number.isFinite(Date.parse(diagnostic.createdAt)))
    throw new Error(
      "Import diagnostics need a valid local identifier and timestamp.",
    );
  await database.transaction(
    "rw",
    database.table("settings"),
    database.table("importDiagnostics"),
    async () => {
      if (!(await importDiagnosticsEnabled(database))) return;
      await database.table("importDiagnostics").put(diagnostic);
      // Use primary-key order to break equal millisecond timestamps deterministically.
      const keys = await database
        .table<{ id: string; createdAt: string }>("importDiagnostics")
        .orderBy("createdAt")
        .reverse()
        .primaryKeys();
      await database
        .table("importDiagnostics")
        .bulkDelete(keys.slice(MAX_IMPORT_DIAGNOSTICS));
    },
  );
}

export async function clearImportDiagnostics(database: Dexie): Promise<void> {
  await database.table("importDiagnostics").clear();
}
