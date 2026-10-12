// @vitest-environment node
import { afterEach, expect, it } from "vitest";
import { FinanceDB } from "./database";
import {
  saveLayoutTemplate,
  renameLayoutTemplate,
  deleteLayoutTemplate,
  markLayoutTemplateChecked,
} from "./layout-templates";
import { auditedMutation, undoChange } from "./audit";
import type { LayoutTemplate } from "../domain/models";
const databases: FinanceDB[] = [];
const createDatabase = () => {
  const database = new FinanceDB(`layouts-${crypto.randomUUID()}`);
  databases.push(database);
  return database;
};
afterEach(async () => {
  for (const database of databases.splice(0)) await database.delete();
});
const template: LayoutTemplate = {
  id: "synthetic-layout",
  name: "Synthetic account",
  fingerprint: "synthetic-layout-fingerprint",
  coordinateSpace: "page-width-fraction",
  signConvention: "signed_positive_out",
  balanceSign: -1,
  dateFormat: "auto",
  createdAt: "2026-10-11T12:00:00.000Z",
  lastUsedAt: "2026-10-11T12:00:00.000Z",
  status: "active",
  columnRoles: [
    { x0: 0, x1: 0.2, role: "date" },
    { x0: 0.2, x1: 0.8, role: "description" },
    { x0: 0.8, x1: 1, role: "amount" },
  ],
};
it("audits layout save, rename, status and deletion, with working Undo", async () => {
  const database = createDatabase();
  await saveLayoutTemplate(template, database);
  await renameLayoutTemplate(template.id, "Renamed layout", database);
  await markLayoutTemplateChecked(template.id, false, database);
  expect((await database.layoutTemplates.get(template.id))?.status).toBe(
    "check_needed",
  );
  const removed = await deleteLayoutTemplate(template.id, database);
  expect(await database.layoutTemplates.count()).toBe(0);
  await undoChange(removed.changeId, database);
  expect(await database.layoutTemplates.get(template.id)).toMatchObject({
    name: "Renamed layout",
    status: "check_needed",
  });
});
it("rejects malformed templates and missing edits without changing stored layouts", async () => {
  const database = createDatabase();
  await saveLayoutTemplate(template, database);
  await expect(
    saveLayoutTemplate(
      { ...template, columnRoles: [{ x0: -1, x1: 0.2, role: "date" }] },
      database,
    ),
  ).rejects.toThrow();
  await expect(
    renameLayoutTemplate(template.id, "   ", database),
  ).rejects.toThrow("Enter a layout name");
  await expect(
    renameLayoutTemplate("missing", "Name", database),
  ).rejects.toThrow("no longer exists");
  expect(await database.layoutTemplates.get(template.id)).toEqual(template);
});
it("allows atomic operational writes but never copies raw diagnostics or safety snapshots into Undo", async () => {
  const database = createDatabase();
  await database
    .table("safetyBackups")
    .put({ key: "latest", raw: "SYNTHETIC RAW SECURITY" });
  await database.table("importDiagnostics").put({
    id: "raw",
    createdAt: "2026-10-11T12:00:00.000Z",
    raw: "SYNTHETIC RAW STATEMENT",
  });
  const { changeId } = await auditedMutation(
    "Operational-safe change",
    ["settings", "safetyBackups", "importDiagnostics"],
    async () => {
      await database.settings.put({ key: "theme", value: "light" });
      await database.table("safetyBackups").clear();
      await database.table("importDiagnostics").clear();
    },
    database,
  );
  const change = await database.changeLog.get(changeId);
  expect(change?.changes).toEqual([
    {
      table: "settings",
      key: "theme",
      after: { key: "theme", value: "light" },
    },
  ]);
  expect(JSON.stringify(change)).not.toContain("SYNTHETIC RAW");
  await undoChange(changeId, database);
  expect(await database.table("safetyBackups").count()).toBe(0);
  expect(await database.table("importDiagnostics").count()).toBe(0);
});
it("rejects history referring to private operational snapshots", async () => {
  const database = createDatabase();
  await database.changeLog.put({
    id: "unsafe",
    label: "Unsafe old row",
    createdAt: "2026-10-11T12:00:00.000Z",
    changes: [
      {
        table: "safetyBackups",
        key: "latest",
        before: { raw: "SYNTHETIC SECURITY" },
      },
    ],
  });
  await expect(undoChange("unsafe", database)).rejects.toThrow(
    "unsupported table",
  );
  expect(await database.table("safetyBackups").count()).toBe(0);
});
