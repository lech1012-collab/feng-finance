// @vitest-environment node
import { afterEach, expect, it } from "vitest";
import { FinanceDB, initializeDatabase } from "./database";
import { createBackup, restoreBackup, validateBackup } from "./backup";
import { saveLayoutTemplate } from "./layout-templates";
import type { LayoutTemplate, Statement, Transaction } from "../domain/models";
const databases: FinanceDB[] = [];
const createDatabase = () => {
  const database = new FinanceDB(`backup-v22-${crypto.randomUUID()}`);
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
it("portable backups contain validated layouts but never raw diagnostics/safety/security Undo history", async () => {
  const database = createDatabase();
  await initializeDatabase(database);
  await saveLayoutTemplate(template, database);
  await database
    .table("safetyBackups")
    .put({ key: "latest", privateField: "SYNTHETIC SNAPSHOT SECURITY" });
  await database
    .table("importDiagnostics")
    .put({ id: "raw", privateField: "SYNTHETIC RAW STATEMENT" });
  await database.changeLog.add({
    id: "unsafe",
    label: "unsafe older data",
    createdAt: "2026-10-11T12:00:00.000Z",
    changes: [
      {
        table: "safetyBackups",
        key: "latest",
        before: { raw: "SYNTHETIC SNAPSHOT SECURITY" },
      },
    ],
  });
  const backup = await createBackup({}, database);
  expect(backup.schemaVersion).toBe(4);
  expect(backup.layoutTemplates).toEqual([template]);
  expect(validateBackup(backup).layoutTemplates).toEqual([template]);
  expect(JSON.stringify(backup)).not.toContain("SYNTHETIC SNAPSHOT SECURITY");
  expect(JSON.stringify(backup)).not.toContain("SYNTHETIC RAW STATEMENT");
  expect(backup.changeLog?.some((entry) => entry.id === "unsafe")).toBe(false);
  const target = createDatabase();
  await target
    .table("safetyBackups")
    .put({ key: "recovery-state", format: "feng-native-recovery-state" });
  await target.table("importDiagnostics").put({ id: "old-raw" });
  await restoreBackup(backup, target);
  expect(await target.layoutTemplates.toArray()).toEqual([template]);
  expect(await target.table("safetyBackups").count()).toBe(0);
  expect(await target.table("importDiagnostics").count()).toBe(0);
  expect(
    (await target.changeLog.toArray()).every((entry) =>
      entry.changes.every(
        (change) =>
          !["safetyBackups", "importDiagnostics"].includes(change.table),
      ),
    ),
  ).toBe(true);
});
it("projects legacy required transaction defaults only in exported JSON, leaving native records untouched", async () => {
  const database = createDatabase();
  await initializeDatabase(database);
  await database.accounts.put({
    id: "a",
    institution: "Other",
    displayName: "Synthetic",
    accountType: "current",
    currency: "GBP",
    maskedAccountIdentifier: "•••• 0001",
    createdAt: "2026-10-11T12:00:00.000Z",
    updatedAt: "2026-10-11T12:00:00.000Z",
  });
  const raw = {
    id: "legacy",
    accountId: "a",
    statementId: "",
    date: "2026-10-01",
    description: "SYNTHETIC CASH",
    merchant: "SYNTHETIC CASH",
    amount: 100,
    currency: "GBP",
    type: "income",
    source: "manual",
    sourcePage: 0,
    extractionConfidence: 1,
    transactionFingerprint: "synthetic",
    isTransfer: false,
    createdAt: "2026-10-11T12:00:00.000Z",
    updatedAt: "2026-10-11T12:00:00.000Z",
  };
  await database.table("transactions").put(raw);
  const backup = await createBackup({}, database);
  expect(validateBackup(backup).transactions[0]).toMatchObject({
    tags: [],
    occurrence: 0,
    isReviewed: false,
    amount: 100,
  });
  expect(await database.table("transactions").get("legacy")).toEqual(raw);
});
it("rejects malformed/duplicate layouts before destructive restore", async () => {
  const database = createDatabase();
  await initializeDatabase(database);
  await saveLayoutTemplate(template, database);
  const backup = await createBackup({}, database);
  await expect(
    restoreBackup(
      { ...backup, layoutTemplates: [template, template] },
      database,
    ),
  ).rejects.toThrow("duplicate identifiers");
  await expect(
    restoreBackup(
      { ...backup, layoutTemplates: [{ ...template, balanceSign: 0 }] },
      database,
    ),
  ).rejects.toThrow();
  expect(await database.layoutTemplates.toArray()).toEqual([template]);
});

it("round-trips exact PDF evidence without changing legacy validation policy or financial signs", async () => {
  const database = createDatabase();
  await initializeDatabase(database);
  await database.accounts.put({
    id: "synthetic-account",
    institution: "Other",
    displayName: "Synthetic account",
    accountType: "current",
    currency: "GBP",
    maskedAccountIdentifier: "•••• 0001",
    createdAt: "2026-10-11T12:00:00.000Z",
    updatedAt: "2026-10-11T12:00:00.000Z",
  });
  const statement: Statement = {
    id: "synthetic-statement",
    accountId: "synthetic-account",
    institution: "Other",
    statementPeriodStart: "2026-10-01",
    statementPeriodEnd: "2026-10-31",
    openingBalance: 10000,
    closingBalance: 9750,
    currency: "GBP",
    sourceFilename: "synthetic-statement.pdf",
    sourceFileHash: "synthetic-hash",
    importedAt: "2026-10-11T12:00:00.000Z",
    parserVersion: "2.2.0",
    extractionMethod: "embedded-text",
    validationStatus: "reconciled",
    validationDifference: 0,
    transactionCount: 1,
    warnings: [],
    parserMethod: "template",
    rowsBalanceChecked: 1,
    rowsTotalChecked: 0,
    rowsNeedingReview: 0,
    rowsExcludedByReview: 1,
    unreadPages: [],
    bankProfileId: "synthetic-profile",
    layoutTemplateId: template.id,
    validationPolicy: "exact-v2.2",
  };
  const transaction: Transaction = {
    id: "synthetic-payment",
    accountId: statement.accountId,
    statementId: statement.id,
    date: "2026-10-10",
    description: "SYNTHETIC PAYMENT",
    merchant: "SYNTHETIC PAYMENT",
    amount: -250,
    currency: "GBP",
    balanceAfterTransaction: 9750,
    type: "expense",
    tags: [],
    sourcePage: 1,
    extractionConfidence: 1,
    transactionFingerprint: "synthetic-payment-hash",
    occurrence: 0,
    isTransfer: false,
    isReviewed: true,
    createdAt: "2026-10-11T12:00:00.000Z",
    updatedAt: "2026-10-11T12:00:00.000Z",
    checkLevel: "balance",
    parseSource: "text",
    parseRowId: "synthetic-row",
    layoutTemplateId: template.id,
  };
  await database.statements.put(statement);
  await database.transactions.put(transaction);
  const portable = validateBackup(await createBackup({}, database));
  expect(portable.version).toBe(1);
  expect(portable.schemaVersion).toBe(4);
  expect(portable.statements).toEqual([statement]);
  expect(portable.transactions).toEqual([transaction]);
  const restored = createDatabase();
  await restoreBackup(portable, restored);
  expect(await restored.statements.toArray()).toEqual([statement]);
  expect(await restored.transactions.toArray()).toEqual([transaction]);
  const {
    validationPolicy: _policy,
    parserMethod: _method,
    rowsBalanceChecked: _balanceCount,
    rowsTotalChecked: _totalCount,
    rowsNeedingReview: _reviewCount,
    rowsExcludedByReview: _excludedCount,
    unreadPages: _unread,
    bankProfileId: _profile,
    layoutTemplateId: _layout,
    ...legacyStatement
  } = statement;
  const {
    checkLevel: _level,
    parseSource: _source,
    parseRowId: _rowId,
    layoutTemplateId: _transactionLayout,
    ...legacyTransaction
  } = transaction;
  const legacy = validateBackup({
    ...portable,
    schemaVersion: 3,
    statements: [legacyStatement],
    transactions: [legacyTransaction],
    layoutTemplates: undefined,
  });
  expect(legacy.statements[0].validationPolicy).toBeUndefined();
  expect(legacy.transactions[0].checkLevel).toBeUndefined();
  expect(legacy.transactions[0].amount).toBe(-250);
});
