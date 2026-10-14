import { afterEach, beforeEach, expect, it } from "vitest";
import { db } from "./database";
import {
  clearLocalData,
  createBackup,
  deleteImportedRecords,
  validateBackup,
} from "./backup";
import { loadDemo } from "./demo";
import { undoChange } from "./audit";
import { categorizeCards } from "./categorize";
import type { SafetyRecoveryState } from "./safety-backup";
import { accounts, transaction } from "../tests/helpers";

beforeEach(async () => {
  await db.open();
  await clearLocalData();
  await loadDemo();
  await db.accounts.put(accounts[0]);
  const retainedPurchase = transaction({
    id: "manual-wallet-purchase",
    accountId: accounts[0].id,
    statementId: "",
    source: "manual",
    sourcePage: 0,
    amount: -1200,
    categoryId: "groceries",
    merchant: "FICTITIOUS RETAINED PURCHASE",
    description: "FICTITIOUS RETAINED PURCHASE",
  });
  await db.transactions.put(retainedPurchase);
  await categorizeCards([retainedPurchase], "shopping");
  await db.savedViews.put({
    id: "view",
    name: "My view",
    conditions: [],
    match: "all",
    pinned: true,
  });
  await db.savedReports.put({
    id: "report",
    name: "My report",
    groupBy: "category",
    measure: "sum",
    chart: "table",
    conditions: [],
    pinned: false,
  });
  await db.scenarios.put({
    id: "scenario",
    name: "My scenario",
    currency: "GBP",
    createdAt: new Date().toISOString(),
    changes: [],
  });
  await db.settings.put({
    key: "security:pinHash",
    value: "synthetic-local-hash",
  });
});
afterEach(async () => {
  await db.delete();
});

it("deleting imported records keeps manual records, planning, learned rules and settings; one Undo restores every deleted statement and source transaction", async () => {
  const preserved = [
    "accounts",
    "categories",
    "rules",
    "settings",
    "valuations",
    "pots",
    "budgets",
    "tags",
    "recurringSeries",
    "fxRates",
    "savedViews",
    "savedReports",
    "scenarios",
    "layoutTemplates",
  ];
  const retained = Object.fromEntries(
    await Promise.all(
      preserved.map(async (name) => [name, await db.table(name).toArray()]),
    ),
  );
  const originalStatements = await db.statements.toArray();
  const originalTransactions = await db.transactions.toArray();
  const originalLinks = await db.transferLinks.toArray();
  const originalProposals = await db.transferProposals.toArray();
  expect(originalStatements.length).toBeGreaterThan(0);
  expect(originalLinks.length).toBeGreaterThan(0);
  expect(originalProposals.length).toBeGreaterThan(0);
  validateBackup(await createBackup());
  const removed = await deleteImportedRecords();
  expect(await db.statements.count()).toBe(0);
  expect((await db.transactions.toArray()).map((row) => row.id)).toEqual([
    "manual-wallet-purchase",
  ]);
  expect(await db.transferLinks.count()).toBe(0);
  expect(await db.transferProposals.count()).toBe(0);
  expect(await db.monthCloses.count()).toBe(0);
  for (const name of preserved)
    expect(await db.table(name).toArray()).toEqual(retained[name]);
  validateBackup(await createBackup());
  await undoChange(removed.changeId);
  expect(await db.statements.toArray()).toEqual(originalStatements);
  expect(await db.transactions.toArray()).toEqual(originalTransactions);
  expect(await db.transferLinks.toArray()).toEqual(originalLinks);
  expect(await db.transferProposals.toArray()).toEqual(originalProposals);
  validateBackup(await createBackup());
}, 20000);

it("erasing everything clears financial history, planning, local credentials and recovery markers while retaining only initial built-in defaults", async () => {
  const recovery: SafetyRecoveryState = {
    key: "recovery-state",
    format: "feng-native-recovery-state",
    recoveredAt: "2026-10-14T12:00:00Z",
    capturedAt: "2026-10-01T12:00:00Z",
    sourceNativeVersion: 20,
  };
  await db.safetyBackups.put(recovery);
  expect(await db.safetyBackups.count()).toBe(1);
  await clearLocalData();
  for (const table of db.tables) {
    if (["categories", "rules", "settings"].includes(table.name)) continue;
    expect(await table.count(), table.name).toBe(0);
  }
  expect(await db.settings.toArray()).toEqual([
    { key: "initialized", value: "true" },
  ]);
  expect((await db.rules.toArray()).every((row) => row.builtIn)).toBe(true);
  expect(await db.categories.count()).toBeGreaterThan(0);
  validateBackup(await createBackup());
});
