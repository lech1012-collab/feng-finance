// @vitest-environment node
import { afterEach, expect, it } from "vitest";
import { FinanceDB } from "./database";
import {
  importDiagnosticsEnabled,
  retainImportDiagnostics,
  setImportDiagnosticsEnabled,
} from "./import-diagnostics";
const databases: FinanceDB[] = [];
const createDatabase = () => {
  const database = new FinanceDB(`diagnostics-${crypto.randomUUID()}`);
  databases.push(database);
  return database;
};
afterEach(async () => {
  for (const database of databases.splice(0)) await database.delete();
});

it("never retains raw statement data unless explicitly enabled", async () => {
  const database = createDatabase();
  expect(await importDiagnosticsEnabled(database)).toBe(false);
  await retainImportDiagnostics(
    {
      id: "synthetic",
      createdAt: "2026-10-11T12:00:00.000Z",
      raw: "SYNTHETIC STATEMENT",
    },
    database,
  );
  expect(await database.table("importDiagnostics").count()).toBe(0);
  expect(await database.changeLog.count()).toBe(0);
});
it("retains only the most recent five and disabling removes raw rows without Undo retention", async () => {
  const database = createDatabase();
  await setImportDiagnosticsEnabled(true, database);
  for (let index = 9; index >= 0; index--)
    await retainImportDiagnostics(
      {
        id: String(index),
        createdAt: `2026-10-11T12:00:0${index}.000Z`,
        raw: "SYNTHETIC STATEMENT",
      },
      database,
    );
  expect(
    (await database.table("importDiagnostics").toArray()).map((row) => row.id),
  ).toEqual(["5", "6", "7", "8", "9"]);
  await setImportDiagnosticsEnabled(false, database);
  expect(await importDiagnosticsEnabled(database)).toBe(false);
  expect(await database.table("importDiagnostics").count()).toBe(0);
  expect(await database.changeLog.count()).toBe(0);
});
it("bounds equal timestamps and rejects invalid diagnostic identities", async () => {
  const database = createDatabase();
  await setImportDiagnosticsEnabled(true, database);
  for (let index = 0; index < 10; index++)
    await retainImportDiagnostics(
      { id: String(index), createdAt: "2026-10-11T12:00:00.000Z" },
      database,
    );
  expect(await database.table("importDiagnostics").count()).toBe(5);
  await expect(
    retainImportDiagnostics({ id: "", createdAt: "invalid" }, database),
  ).rejects.toThrow("valid local identifier");
});
