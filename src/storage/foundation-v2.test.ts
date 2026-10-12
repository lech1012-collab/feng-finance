import Dexie from "dexie";
import { Blob as NativeBlob } from "node:buffer";
import { beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import { db, FinanceDB, initializeDatabase } from "./database";
import { auditedMutation, undoChange } from "./audit";
import {
  clearLocalData,
  createBackup,
  restoreBackup,
  validateBackup,
  exportCsv,
  deleteImportedRecords,
} from "./backup";
import { loadDemo } from "./demo";
import { transaction, accounts } from "../tests/helpers";

beforeEach(async () => {
  vi.stubGlobal("Blob", NativeBlob);
  await clearLocalData();
});
afterAll(async () => {
  await db.delete();
  vi.unstubAllGlobals();
});

describe("version 2 foundation", () => {
  it("upgrades an existing schema 2 database without changing money, descriptions or learned rules", async () => {
    const name = "v2-foundation-migration";
    const old = new Dexie(name);
    old.version(2).stores({
      accounts: "id,institution,currency",
      statements:
        "id,accountId,sourceFileHash,statementPeriodEnd,[accountId+statementPeriodStart+statementPeriodEnd]",
      transactions:
        "id,date,accountId,statementId,categoryId,transactionFingerprint,[currency+date],[accountId+date],merchant",
      categories: "id,parentId",
      rules: "id,priority",
      transferLinks: "id",
      settings: "key",
    });
    const original = transaction({ id: "legacy", amount: -125912 });
    await old.table("transactions").put(original);
    await old
      .table("settings")
      .put({ key: "budget:GBP:groceries", value: "30000" });
    old.close();
    const migrated = new FinanceDB(name);
    await migrated.open();
    expect(await migrated.transactions.get("legacy")).toMatchObject({
      ...original,
      kind: "normal",
      source: "pdf",
      attachmentIds: [],
    });
    expect((await migrated.settings.get("budget:GBP:groceries"))?.value).toBe(
      "30000",
    );
    expect((await migrated.settings.get("transferMatching"))?.value).toBe(
      "manual",
    );
    expect(migrated.verno).toBe(4);
    expect(await migrated.pots.count()).toBe(0);
    await migrated.delete();
  });
  it("restores a v1.8.3-style backup without silently dropping data and rejects newer schemas", async () => {
    await loadDemo();
    const current = await createBackup();
    const {
      valuations: _a,
      pots: _b,
      budgets: _c,
      tags: _d,
      recurringSeries: _e,
      monthCloses: _f,
      attachments: _g,
      fxRates: _h,
      transferProposals: _i,
      savedViews: _j,
      savedReports: _k,
      scenarios: _l,
      changeLog: _m,
      ...legacy
    } = current;
    const transactions = legacy.transactions
      .filter((row) => !row.parentId)
      .map(
        ({
          kind: _kind,
          source: _source,
          parentId: _parent,
          refundAllocations: _refunds,
          recurringSeriesId: _series,
          attachmentIds: _attachments,
          ...row
        }) => row,
      );
    const backup = {
      ...legacy,
      schemaVersion: 2,
      accounts: legacy.accounts.filter((row) => row.tracking !== "manual"),
      transactions,
    };
    expect(validateBackup(backup).transactions).toEqual(transactions);
    await restoreBackup(backup);
    expect(await db.transactions.toArray()).toEqual(transactions);
    expect(await db.pots.count()).toBe(0);
    const count = await db.transactions.count();
    await expect(
      restoreBackup({ ...backup, schemaVersion: 99 }),
    ).rejects.toThrow();
    expect(await db.transactions.count()).toBe(count);
  });
  it("keeps local lock credentials out of portable backups and retains them on restore", async () => {
    await db.settings.bulkPut([
      { key: "security:pinHash", value: "private-local-hash" },
      { key: "security:credential", value: "private-credential" },
    ]);
    const backup = await createBackup();
    expect(JSON.stringify(backup)).not.toContain("private-local-hash");
    await restoreBackup({
      ...backup,
      settings: [
        ...backup.settings,
        { key: "security:pinHash", value: "attacker" },
      ],
    });
    expect((await db.settings.get("security:pinHash"))?.value).toBe(
      "private-local-hash",
    );
  });
  it("round trips new manual assets, goals, monthly budgets, tags and exact rates", async () => {
    await loadDemo();
    const account = (await db.accounts.toArray())[0];
    await db.accounts.put({
      ...account,
      id: "house",
      accountType: "property",
      tracking: "manual",
    });
    await db.valuations.put({
      id: "house-jun",
      accountId: "house",
      date: "2026-06-01",
      valueMinor: 45000000,
    });
    await db.tags.put({
      id: "holiday",
      name: "Holiday",
      colour: "#6EA8FF",
      archived: false,
    });
    await db.pots.put({
      id: "insurance",
      type: "sinking",
      name: "Car insurance",
      targetMinor: 54000,
      currency: "GBP",
      targetDate: "2027-03-15",
      contributions: [{ month: "2026-10", amountMinor: 9000 }],
      createdAt: new Date().toISOString(),
    });
    await db.budgets.put({
      id: "groceries-sep",
      categoryId: "groceries",
      month: "2026-09",
      currency: "GBP",
      amountMinor: 30000,
      rollover: "surplus",
    });
    await db.fxRates.put({
      id: "2026-09-04:EUR:GBP",
      date: "2026-09-04",
      base: "EUR",
      quote: "GBP",
      rate: "0.86425",
      source: "ecb",
    });
    const backup = validateBackup(await createBackup());
    await clearLocalData();
    await restoreBackup(JSON.parse(JSON.stringify(backup)));
    expect((await db.valuations.get("house-jun"))?.valueMinor).toBe(45000000);
    expect((await db.pots.get("insurance"))?.contributions[0].amountMinor).toBe(
      9000,
    );
    expect((await db.fxRates.toArray())[0].rate).toBe("0.86425");
  });
  it("serializes attachment and Undo blobs portably and can omit attachments safely", async () => {
    await loadDemo();
    const original = (await db.transactions.toArray())[0];
    const attachment = {
      id: "receipt",
      transactionId: original.id,
      mime: "image/png",
      sizeBytes: 3,
      blob: new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
      name: "Receipt.png",
    };
    const { changeId } = await auditedMutation(
      "Add receipt",
      ["attachments", "transactions"],
      async () => {
        await db.attachments.put(attachment);
        await db.transactions.update(original.id, {
          attachmentIds: [attachment.id],
        });
      },
    );
    const backup = validateBackup(await createBackup());
    expect(backup.attachments?.[0].dataBase64).toBe("AQID");
    const without = validateBackup(
      await createBackup({ includeAttachments: false }),
    );
    expect(without.attachments).toEqual([]);
    expect(
      without.transactions.find((transaction) => transaction.id === original.id)
        ?.attachmentIds,
    ).toEqual([]);
    await clearLocalData();
    await restoreBackup(JSON.parse(JSON.stringify(backup)));
    expect((await db.attachments.get("receipt"))?.blob.size).toBe(3);
    await undoChange(changeId);
    expect(await db.attachments.count()).toBe(0);
    expect((await db.transactions.get(original.id))?.attachmentIds).toEqual(
      original.attachmentIds,
    );
  });
});

describe("atomic local change history", () => {
  it("groups a bulk action into one Undo and records only touched rows", async () => {
    await db.transactions.bulkPut(
      Array.from({ length: 20000 }, (_, index) =>
        transaction({ id: `bulk-${index}`, isReviewed: false }),
      ),
    );
    const { changeId } = await auditedMutation(
      "Review two payments",
      ["transactions"],
      async () => {
        await db.transactions.update("bulk-10", { isReviewed: true });
        await db.transactions.update("bulk-20", { categoryId: "shopping" });
      },
    );
    expect((await db.changeLog.get(changeId))?.changes).toHaveLength(2);
    await undoChange(changeId);
    expect((await db.transactions.get("bulk-10"))?.isReviewed).toBe(false);
    expect((await db.transactions.get("bulk-20"))?.categoryId).toBeUndefined();
    expect(await db.transactions.count()).toBe(20000);
  }, 20000);
  it("rolls back the operation and audit record together on a failure", async () => {
    await expect(
      auditedMutation("Broken change", ["settings"], async () => {
        await db.settings.put({ key: "temporary", value: "value" });
        throw new Error("Failed safely");
      }),
    ).rejects.toThrow("Failed safely");
    expect(await db.settings.get("temporary")).toBeUndefined();
    expect(await db.changeLog.count()).toBe(0);
  });
  it("does not put PIN settings in history and expires entries after 90 days", async () => {
    await db.changeLog.put({
      id: "expired",
      label: "Old change",
      createdAt: "2020-01-01T00:00:00.000Z",
      changes: [],
    });
    const result = await auditedMutation(
      "Appearance",
      ["settings"],
      async () => {
        await db.settings.put({ key: "theme", value: "dark" });
        await db.settings.put({ key: "security:pinHash", value: "secret" });
      },
    );
    expect(
      (await db.changeLog.get(result.changeId))?.changes.map(
        (change) => change.key,
      ),
    ).toEqual(["theme"]);
    expect(await db.changeLog.get("expired")).toBeUndefined();
    expect(JSON.stringify(await createBackup())).not.toContain("secret");
  });
  it("refuses Undo that would overwrite a newer edit", async () => {
    await db.settings.put({ key: "test", value: "before" });
    const older = await auditedMutation("First change", ["settings"], () =>
      db.settings.put({ key: "test", value: "first" }),
    );
    const newer = await auditedMutation("Second change", ["settings"], () =>
      db.settings.put({ key: "test", value: "second" }),
    );
    await expect(undoChange(older.changeId)).rejects.toThrow("newer");
    expect((await db.settings.get("test"))?.value).toBe("second");
    await undoChange(newer.changeId);
    await undoChange(older.changeId);
    expect((await db.settings.get("test"))?.value).toBe("before");
  });
  it("does not retain a no-op change", async () => {
    const result = await auditedMutation(
      "No change",
      ["settings"],
      async () => undefined,
    );
    expect(result.changeId).toBe("");
    expect(await db.changeLog.count()).toBe(0);
  });
});

it("checks exact split and refund invariants across generated minor-unit amounts", () => {
  const now = "2026-10-08T12:00:00.000Z";
  for (let index = 1; index <= 60; index++) {
    const amount = 50 + index * 137;
    const first = Math.floor(amount * 0.37),
      second = amount - first;
    const parent = transaction({
      id: "purchase",
      accountId: "a1",
      statementId: "",
      source: "manual",
      sourcePage: 0,
      kind: "split_parent",
      amount: -amount,
    });
    const children = [
      transaction({
        ...parent,
        id: "groceries-line",
        source: "split",
        parentId: parent.id,
        kind: "normal",
        categoryId: "groceries",
        amount: -first,
      }),
      transaction({
        ...parent,
        id: "household-line",
        source: "split",
        parentId: parent.id,
        kind: "normal",
        categoryId: "household",
        amount: -second,
      }),
    ];
    const refund = transaction({
      id: "refund",
      accountId: "a1",
      statementId: "",
      source: "manual",
      sourcePage: 0,
      date: "2026-10-01",
      amount,
      type: "income",
      kind: "refund",
      refundAllocations: [{ transactionId: parent.id, amount }],
    });
    const backup = {
      format: "feng-finance",
      version: 1,
      schemaVersion: 3,
      moneyUnit: "minor",
      exportedAt: now,
      accounts: [
        {
          id: "a1",
          institution: "Other",
          displayName: "Cash wallet",
          accountType: "current",
          currency: "GBP",
          maskedAccountIdentifier: "Cash",
          createdAt: now,
          updatedAt: now,
        },
      ],
      statements: [],
      transactions: [parent, ...children, refund],
      categories: [
        {
          id: "groceries",
          name: "Groceries",
          kind: "expense",
          archived: false,
          color: "#6EA8FF",
        },
        {
          id: "household",
          name: "Household",
          kind: "expense",
          archived: false,
          color: "#A99BD6",
        },
      ],
      rules: [],
      transferLinks: [],
      settings: [],
    };
    expect(() => validateBackup(backup)).not.toThrow();
    expect(() =>
      validateBackup({
        ...backup,
        transactions: [
          parent,
          { ...children[0], amount: -first - 1 },
          children[1],
          refund,
        ],
      }),
    ).toThrow("Split amounts");
    expect(() =>
      validateBackup({
        ...backup,
        transactions: [
          parent,
          ...children,
          {
            ...refund,
            amount: amount + 1,
            refundAllocations: [
              { transactionId: parent.id, amount: amount + 1 },
            ],
          },
        ],
      }),
    ).toThrow("Refunds exceed");
    expect(() =>
      validateBackup({
        ...backup,
        transactions: [
          parent,
          ...children,
          {
            ...refund,
            refundAllocations: [
              { transactionId: parent.id, amount: amount - 1 },
            ],
          },
        ],
      }),
    ).toThrow("refund allocation");
  }
});

it("rejects malformed audit snapshots before they can be restored and later undone", async () => {
  const backup = await createBackup();
  const bad = {
    id: "bad-change",
    label: "Bad change",
    createdAt: new Date().toISOString(),
    changes: [
      {
        table: "transactions",
        key: "forged",
        before: { id: "forged", amount: 1.5 },
      },
    ],
  };
  expect(() => validateBackup({ ...backup, changeLog: [bad] })).toThrow();
});

it("refuses to Undo an entity creation while later records still depend on it", async () => {
  const tag = await auditedMutation("Create trip tag", ["tags"], () =>
    db.tags.add({
      id: "trip",
      name: "Trip",
      colour: "#6EA8FF",
      archived: false,
    }),
  );
  const tagged = await auditedMutation("Tag payment", ["transactions"], () =>
    db.transactions.add(transaction({ id: "tagged", tags: ["trip"] })),
  );
  await expect(undoChange(tag.changeId)).rejects.toThrow("depend");
  expect(await db.tags.get("trip")).toBeDefined();
  await undoChange(tagged.changeId);
  await undoChange(tag.changeId);
  expect(await db.tags.get("trip")).toBeUndefined();
});

it("records same-size receipt replacements and refuses Undo after a later binary edit", async () => {
  const first = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
  const second = new Blob([new Uint8Array([4, 5, 6])], { type: "image/png" });
  await db.attachments.put({
    id: "receipt",
    transactionId: "payment",
    mime: "image/png",
    sizeBytes: 3,
    blob: first,
  });
  const changed = await auditedMutation(
    "Replace receipt",
    ["attachments"],
    () => db.attachments.update("receipt", { blob: second }),
  );
  expect((await db.changeLog.get(changed.changeId))?.changes).toHaveLength(1);
  await db.attachments.update("receipt", {
    blob: new Blob([new Uint8Array([7, 8, 9])], { type: "image/png" }),
  });
  await expect(undoChange(changed.changeId)).rejects.toThrow("newer");
  await db.attachments.update("receipt", { blob: second });
  await undoChange(changed.changeId);
  const restored = await db.attachments.get("receipt");
  expect([...new Uint8Array(await restored!.blob.arrayBuffer())]).toEqual([
    1, 2, 3,
  ]);
});

it("does not Undo a period setting beneath a subsequently closed month", async () => {
  const change = await auditedMutation(
    "Change reporting period",
    ["settings"],
    () =>
      db.settings.put({
        key: "period:start",
        value: JSON.stringify({ type: "fixed", day: 25 }),
      }),
  );
  const close = await auditedMutation(
    "Close a later month",
    ["monthCloses"],
    () =>
      db.monthCloses.put({
        month: "2026-10",
        closedAt: new Date().toISOString(),
        snapshot: {
          income: 1000,
          expenses: 500,
          net: 500,
          transactionCount: 1,
        },
      }),
  );
  await expect(undoChange(change.changeId)).rejects.toThrow(
    "newer month close",
  );
  expect(await db.monthCloses.get("2026-10")).toBeDefined();
  await undoChange(close.changeId);
  await undoChange(change.changeId);
  expect(await db.settings.get("period:start")).toBeUndefined();
});

it("exports split children once while preserving native refund and transfer rows", async () => {
  const parent = transaction({
    id: "split-parent",
    amount: -6000,
    kind: "split_parent",
    currency: "GBP",
  });
  const first = transaction({
    ...parent,
    id: "split-groceries",
    parentId: parent.id,
    kind: "normal",
    amount: -4500,
    categoryId: "groceries",
    source: "split",
    tags: ["home"],
  });
  const second = transaction({
    ...parent,
    id: "split-household",
    parentId: parent.id,
    kind: "normal",
    amount: -1500,
    categoryId: "household",
    source: "split",
    tags: ["home"],
  });
  const refund = transaction({
    id: "native-refund",
    date: "2026-10-01",
    amount: 2000,
    type: "income",
    kind: "refund",
    refundAllocations: [{ transactionId: parent.id, amount: 2000 }],
  });
  const transfer = transaction({
    id: "native-transfer",
    amount: -5000,
    type: "transfer",
    isTransfer: true,
    kind: "transfer",
  });
  await db.transactions.bulkPut([parent, first, second, refund, transfer]);
  await db.tags.put({
    id: "home",
    name: "Home project",
    colour: "#6EA8FF",
    archived: false,
  });
  const csv = await exportCsv();
  const rows = csv.split("\r\n");
  expect(rows).toHaveLength(5);
  expect(csv).toContain('"Parent ID","Kind","Source","Reviewed","Note"');
  expect(rows.some((row) => row.includes('"-60.00"'))).toBe(false);
  expect(csv).toContain('"-45.00"');
  expect(csv).toContain('"-15.00"');
  expect(csv).toContain('"20.00"');
  expect(csv).toContain('"-50.00"');
  expect(csv).toContain('"Home project"');
  expect(csv).toContain('"refund"');
  expect(csv).toContain('"transfer"');
});

it("refuses deleting an imported purchase linked by a preserved manual refund", async () => {
  await db.accounts.put(accounts[0]);
  await db.statements.put({
    id: "imported-statement",
    institution: "Barclays",
    accountId: accounts[0].id,
    statementPeriodStart: "2026-08-01",
    statementPeriodEnd: "2026-08-31",
    openingBalance: 5000,
    closingBalance: 1000,
    currency: "GBP",
    sourceFilename: "Fictitious statement",
    sourceFileHash: "synthetic-hash",
    importedAt: "2026-10-08T12:00:00.000Z",
    parserVersion: "synthetic",
    extractionMethod: "embedded-text",
    validationStatus: "reconciled",
    transactionCount: 1,
    warnings: [],
  });
  await db.transactions.bulkPut([
    transaction({
      id: "imported-purchase",
      accountId: accounts[0].id,
      date: "2026-08-04",
      statementId: "imported-statement",
      source: "pdf",
      amount: -4000,
    }),
    transaction({
      id: "manual-refund",
      accountId: accounts[0].id,
      date: "2026-09-04",
      statementId: "",
      source: "manual",
      sourcePage: 0,
      amount: 4000,
      type: "income",
      kind: "refund",
      refundAllocations: [{ transactionId: "imported-purchase", amount: 4000 }],
    }),
  ]);
  validateBackup(await createBackup());
  const auditCount = await db.changeLog.count();
  await expect(deleteImportedRecords()).rejects.toThrow(
    "Unlink or delete that refund",
  );
  expect(await db.statements.count()).toBe(1);
  expect(await db.transactions.count()).toBe(2);
  expect(await db.changeLog.count()).toBe(auditCount);
  validateBackup(await createBackup());
  await db.transactions.delete("manual-refund");
  await deleteImportedRecords();
  expect(await db.statements.count()).toBe(0);
  expect(await db.transactions.count()).toBe(0);
  validateBackup(await createBackup());
});
