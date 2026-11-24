// @vitest-environment node
import Dexie from "dexie";
import { afterEach, expect, it, vi } from "vitest";
import { accounts, transaction } from "../tests/helpers";
import { FinanceDB, db, initializeDatabase } from "./database";
import {
  activateLedger,
  backupLedger,
  currentLedger,
  deleteDemoLedger,
  openDemoLedger,
} from "./ledgers";
import { createBackup, restoreBackup, validateBackup } from "./backup";
import { previousDataPreview, restorePreviousData } from "./safety-backup";
import { auditedMutation, undoChange } from "./audit";

const databases: FinanceDB[] = [];
function instance() {
  const database = new FinanceDB("ledger-" + crypto.randomUUID());
  databases.push(database);
  return database;
}
afterEach(async () => {
  vi.restoreAllMocks();
  for (const database of databases.splice(0)) await database.delete();
});

it("keeps accounts, rules, attachments, settings and Undo with their ledger, including identical IDs", async () => {
  const database = instance();
  await initializeDatabase(database);
  await database.settings.bulkPut([
    { key: "security:pin", value: "secret" },
    { key: "fx:download", value: "false" },
    { key: "periodDay", value: "15" },
  ]);
  await database.accounts.add(accounts[0]);
  await database.transactions.add(
    transaction({ source: "manual", statementId: "manual" }),
  );
  await database.attachments.add({
    id: "receipt",
    transactionId: "t1",
    name: "private receipt",
    mime: "image/png",
    sizeBytes: 4,
    blob: new Blob(["mine"], { type: "image/png" }),
  });
  await auditedMutation(
    "Personal merchant edit",
    ["transactions"],
    () => database.transactions.update("t1", { merchant: "Owner" }),
    database,
  );
  await activateLedger("demo", database);
  expect(await currentLedger(database)).toBe("demo");
  expect(await database.attachments.count()).toBe(0);
  expect(await database.settings.get("periodDay")).toBeUndefined();
  expect((await database.settings.get("fx:download"))?.value).toBe("false");
  expect((await database.settings.get("security:pin"))?.value).toBe("secret");
  await database.accounts.add({ ...accounts[0], displayName: "Demo only" });
  const backup = validateBackup(await createBackup({}, database));
  expect(backup.ledger).toBe("demo");
  expect(JSON.stringify(backup)).not.toContain("Owner");
  await activateLedger("personal", database);
  expect(await (await database.attachments.get("receipt"))?.blob.text()).toBe(
    "mine",
  );
  expect((await database.transactions.get("t1"))?.merchant).toBe("Owner");
  expect((await database.settings.get("periodDay"))?.value).toBe("15");
  expect((await database.changeLog.toArray()).map((e) => e.label)).toContain(
    "Personal merchant edit",
  );
  await restoreBackup(backup, database);
  expect(await currentLedger(database)).toBe("demo");
  expect((await database.accounts.get("a1"))?.displayName).toBe("Demo only");
  await deleteDemoLedger(database);
  expect(await currentLedger(database)).toBe("personal");
  expect(await (await database.attachments.get("receipt"))?.blob.text()).toBe(
    "mine",
  );
  expect(await database.ledgerArchives.count()).toBe(0);
});

it("rolls back the switch if a persisted receipt cannot be copied", async () => {
  const database = instance();
  await initializeDatabase(database);
  await database.accounts.add(accounts[0]);
  await database.attachments.add({
    id: "receipt",
    transactionId: "t1",
    mime: "text/plain",
    sizeBytes: 4,
    blob: new Blob(["mine"]),
  });
  vi.spyOn(Blob.prototype, "arrayBuffer").mockRejectedValue(
    new Error("receipt read failed"),
  );
  await expect(activateLedger("demo", database)).rejects.toThrow(
    "receipt read failed",
  );
  expect(await currentLedger(database)).toBe("personal");
  expect(await database.accounts.count()).toBe(1);
  expect(await database.attachments.count()).toBe(1);
  expect(await database.ledgerArchives.count()).toBe(0);
});

it("migrates a mixed v4 installation atomically, keeps private manual activity and separates demo receipts", async () => {
  const database = instance();
  const legacy = new Dexie(database.name);
  const schema = Object.fromEntries(
    database.tables
      .filter((table) => table.name !== "ledgerArchives")
      .map((table) => [
        table.name,
        [
          table.schema.primKey.src,
          ...table.schema.indexes.map((index) => index.src),
        ].join(","),
      ]),
  );
  legacy.version(4).stores(schema);
  await legacy
    .table("accounts")
    .bulkAdd([accounts[0], { ...accounts[1], isDemo: true }]);
  await legacy.table("transactions").bulkAdd([
    transaction({
      id: "example-tx",
      accountId: "a2",
      isDemo: true,
      source: "manual",
      statementId: "manual",
    }),
    transaction({
      id: "personal-tx",
      accountId: "a2",
      source: "manual",
      statementId: "manual",
    }),
  ]);
  await legacy.table("attachments").add({
    id: "demo-receipt",
    transactionId: "example-tx",
    blob: new Blob(["sample"]),
  });
  legacy.close();
  await database.open();
  expect((await previousDataPreview(database))?.sourceNativeVersion).toBe(40);
  expect(await currentLedger(database)).toBe("personal");
  expect(await database.transactions.toCollection().primaryKeys()).toEqual([
    "personal-tx",
  ]);
  expect((await database.accounts.get("a2"))?.isDemo).toBe(false);
  expect(await database.attachments.count()).toBe(0);
  await activateLedger("demo", database);
  expect(await database.transactions.toCollection().primaryKeys()).toEqual([
    "example-tx",
  ]);
  expect(await database.accounts.toCollection().primaryKeys()).toEqual(["a2"]);
  expect(
    await (await database.attachments.get("demo-receipt"))?.blob.text(),
  ).toBe("sample");
  await restorePreviousData(
    database,
    (await previousDataPreview(database))!.capturedAt,
  );
  expect(await currentLedger(database)).toBe("personal");
  expect(await database.transactions.toCollection().primaryKeys()).toEqual([
    "personal-tx",
  ]);
  await activateLedger("demo", database);
  expect(
    await (await database.attachments.get("demo-receipt"))?.blob.text(),
  ).toBe("sample");
});

it("seeds the actual demo atomically and returns to an empty personal workspace", async () => {
  await db.delete();
  await db.open();
  try {
    await initializeDatabase();
    await openDemoLedger();
    expect(await currentLedger()).toBe("demo");
    expect(await db.accounts.count()).toBeGreaterThan(5);
    await activateLedger("personal");
    expect(await db.accounts.count()).toBe(0);
    await openDemoLedger();
    expect(await db.accounts.count()).toBeGreaterThan(5);
  } finally {
    await db.delete();
  }
});

it("restores only personal Undo history from a mixed backup, merging unique sample records and retaining local demo edits", async () => {
  const database = instance();
  await initializeDatabase(database);
  await database.accounts.add(accounts[0]);
  const backup = await createBackup({}, database);
  delete backup.ledger;
  backup.schemaVersion = 4;
  backup.accounts = [
    { ...accounts[0], displayName: "restored personal" },
    { ...accounts[1], isDemo: true, displayName: "old sample name" },
    { ...accounts[2], isDemo: true, displayName: "unique sample account" },
  ];
  const receiptTx = transaction({
    id: "legacy-sample",
    accountId: "a3",
    isDemo: true,
    source: "manual",
    statementId: "manual",
  });
  backup.transactions = [receiptTx];
  await activateLedger("demo", database);
  await database.accounts.add({
    ...accounts[1],
    displayName: "edited sample",
    isDemo: true,
  });
  const restored = await restoreBackup(backup, database);
  expect(await currentLedger(database)).toBe("personal");
  expect((await database.accounts.get("a1"))?.displayName).toBe(
    "restored personal",
  );
  expect(await database.transactions.count()).toBe(0);
  const undo = await database.changeLog.get(restored.changeId);
  expect(JSON.stringify(undo)).not.toContain("legacy-sample");
  await undoChange(restored.changeId, database);
  expect(await database.accounts.toArray()).toEqual([accounts[0]]);
  await activateLedger("demo", database);
  expect((await database.accounts.get("a2"))?.displayName).toBe(
    "edited sample",
  );
  expect((await database.accounts.get("a3"))?.displayName).toBe(
    "unique sample account",
  );
  expect((await database.transactions.get("legacy-sample"))?.accountId).toBe(
    "a3",
  );
  expect(validateBackup(await createBackup({}, database)).accounts.length).toBe(
    2,
  );
});

it("identifies a legacy sample-only backup when split children have no ownership flag", () => {
  const sample = {
    accounts: [{ ...accounts[0], isDemo: true }],
    statements: [],
    transactions: [
      transaction({ id: "child", source: "split", parentId: "parent" }),
      transaction({
        id: "parent",
        source: "manual",
        kind: "split_parent",
        isDemo: true,
      }),
    ],
  };
  expect(backupLedger(sample)).toBe("demo");
  expect(
    backupLedger({
      ...sample,
      valuations: [
        {
          id: "owner-value",
          accountId: "a1",
          date: "2026-09-01",
          valueMinor: 100,
        },
      ],
    }),
  ).toBe("personal");
});

it("rolls back both ledgers if combining a legacy mixed backup would attach a transaction to the wrong currency", async () => {
  const database = instance();
  await initializeDatabase(database);
  await database.accounts.add(accounts[0]);
  const backup = await createBackup({}, database);
  delete backup.ledger;
  backup.schemaVersion = 4;
  backup.accounts = [
    { ...accounts[0], displayName: "Replacement personal" },
    { ...accounts[1], currency: "EUR", isDemo: true },
  ];
  backup.transactions = [
    transaction({
      accountId: "a2",
      currency: "EUR",
      source: "manual",
      statementId: "",
      isDemo: true,
    }),
  ];
  validateBackup(backup);
  await activateLedger("demo", database);
  await database.accounts.add({
    ...accounts[1],
    displayName: "Existing GBP sample",
    isDemo: true,
  });
  await expect(restoreBackup(backup, database)).rejects.toThrow(
    "conflicting records",
  );
  expect(await currentLedger(database)).toBe("demo");
  expect((await database.accounts.get("a2"))?.currency).toBe("GBP");
  expect(await database.transactions.count()).toBe(0);
  await activateLedger("personal", database);
  expect(await database.accounts.toArray()).toEqual([accounts[0]]);
  expect(await database.transactions.count()).toBe(0);
  expect(
    (await database.changeLog.toArray()).map((entry) => entry.label),
  ).not.toContain("Restore backup");
});
