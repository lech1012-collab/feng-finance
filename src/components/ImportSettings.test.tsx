import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { FinanceDB } from "../storage/database";
import { SafetyRecovery } from "./SafetyRecovery";
import { ImportLayoutsSettings } from "./ImportLayoutsSettings";
import { ImportDiagnosticsSettings } from "./ImportDiagnosticsSettings";
import { saveLayoutTemplate } from "../storage/layout-templates";
import { setImportDiagnosticsEnabled } from "../storage/import-diagnostics";
import type { LayoutTemplate, ImportDiagnostics } from "../domain/models";
import { download } from "../storage/backup";
vi.mock("../storage/backup", () => ({ download: vi.fn() }));
const databases: FinanceDB[] = [];
function createDatabase() {
  const database = new FinanceDB(`import-settings-${crypto.randomUUID()}`);
  databases.push(database);
  return database;
}
afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
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
  status: "check_needed",
  columnRoles: [
    { x0: 0, x1: 0.2, role: "date" },
    { x0: 0.2, x1: 0.8, role: "description" },
    { x0: 0.8, x1: 1, role: "amount" },
  ],
};
const diagnostic: ImportDiagnostics = {
  id: "SYNTHETIC SECRET ID",
  createdAt: "2026-10-11T12:00:00.000Z",
  parserVersion: "2.2.0",
  method: "text",
  table: {
    columns: [
      {
        id: "description",
        x0: 20,
        x1: 200,
        alignment: "left",
        headerText: "SYNTHETIC SECRET HEADER",
        inferredRole: "description",
      },
    ],
    pages: [{ page: 1, width: 600, height: 840, rotation: 0 }],
    rows: [
      {
        id: "row",
        kind: "transaction",
        rect: { page: 1, x: 20, y: 100, width: 180, height: 10 },
        cells: [
          {
            columnId: "description",
            text: "SYNTHETIC SECRET TEXT",
            rect: { page: 1, x: 20, y: 100, width: 180, height: 10 },
            parseSource: "text",
          },
        ],
      },
    ],
  },
  rows: [],
  checks: {
    policy: "exact-v2.2",
    reconciliation: { status: "unavailable" },
    calculatedMoneyIn: 12345,
    calculatedMoneyOut: 45678,
    balanceRowsPassed: 0,
    balanceRowsFailed: 0,
    totalCheckedRows: 0,
    needsReviewRows: 1,
    unreadPages: [],
    evidence: [],
    reconciledExactly: false,
  },
};

it("shows no previous-data action on a new installation", async () => {
  const database = createDatabase();
  const { container } = render(<SafetyRecovery database={database} />);
  await database.open();
  await waitFor(() => expect(container.childNodes.length).toBe(0));
});
it("requires explicit confirmation before restoring earlier values and lock configuration", async () => {
  const database = createDatabase();
  await database.open();
  await database.settings.put({
    key: "security:pinHash",
    value: "synthetic-new-pin",
  });
  await database.table("safetyBackups").put({
    key: "latest",
    format: "feng-native-migration-safety",
    version: 1,
    databaseName: database.name,
    sourceNativeVersion: 30,
    targetNativeVersion: 40,
    targetAppVersion: "2.2.0",
    capturedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    tables: [
      {
        name: "settings",
        keyPath: "key",
        autoIncrement: false,
        indexes: [],
        rows: [
          {
            key: "security:pinHash",
            value: {
              key: "security:pinHash",
              value: "synthetic-original-pin",
            },
          },
        ],
      },
    ],
  });
  const onRestored = vi.fn();
  render(<SafetyRecovery database={database} onRestored={onRestored} />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Restore previous data" }),
  );
  expect(
    screen.getByText(/earlier PIN and device unlock configuration also return/),
  ).toBeTruthy();
  expect(
    (
      screen.getByRole("button", {
        name: "Restore previous data",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(
    screen.getByRole("button", { name: "Restore previous data" }),
  );
  await waitFor(() => expect(onRestored).toHaveBeenCalledOnce());
  expect((await database.settings.get("security:pinHash"))?.value).toBe(
    "synthetic-original-pin",
  );
});
it("renames a saved layout and allows direct Undo of deletion", async () => {
  const database = createDatabase();
  await saveLayoutTemplate(template, database);
  render(<ImportLayoutsSettings database={database} />);
  expect(screen.queryByText(/Saved column mappings help/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "About Import layouts" }));
  expect(await screen.findByText(/Saved column mappings help/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Close Import layouts" }));
  expect(await screen.findByText("Check columns on next import")).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", {
      name: "Rename Synthetic account import layout",
    }),
  );
  fireEvent.change(screen.getByLabelText("Layout name"), {
    target: { value: "Updated synthetic layout" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save name" }));
  await screen.findByText("Updated synthetic layout");
  fireEvent.click(
    screen.getByRole("button", {
      name: "Delete Updated synthetic layout import layout",
    }),
  );
  await screen.findByText("Import layout deleted.");
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  await screen.findByText("Updated synthetic layout");
});
it("exports only redacted diagnostics and turning diagnostics off removes retained rows", async () => {
  const database = createDatabase();
  await setImportDiagnosticsEnabled(true, database);
  await database.importDiagnostics.add(diagnostic);
  render(<ImportDiagnosticsSettings database={database} />);
  expect(screen.getByText(/Keeps statement text and figures/)).toBeVisible();
  expect(screen.getByText(/Turning this off deletes/)).toBeVisible();
  expect(screen.queryByText(/migration safety copy may/)).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "About Import diagnostics" }),
  );
  expect(await screen.findByText(/14-day expiry/)).toBeVisible();
  expect(await database.importDiagnostics.count()).toBe(1);
  fireEvent.click(
    screen.getByRole("button", { name: "Close Import diagnostics" }),
  );
  await screen.findByText("1 of 5 imports retained.");
  fireEvent.click(
    screen.getByRole("button", { name: "Export redacted diagnostics" }),
  );
  await waitFor(() => expect(download).toHaveBeenCalledOnce());
  const exported = vi.mocked(download).mock.calls[0][0];
  expect(exported).toContain("[text]");
  expect(exported).not.toContain("SYNTHETIC SECRET");
  expect(exported).not.toContain("12345");
  fireEvent.click(
    screen.getByRole("checkbox", { name: "Keep local import diagnostics" }),
  );
  await screen.findByText("Local import diagnostics disabled and cleared.");
  expect(await database.importDiagnostics.count()).toBe(0);
  expect(await database.changeLog.count()).toBe(0);
});
