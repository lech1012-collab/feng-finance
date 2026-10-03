import Dexie from "dexie";
import { beforeEach, afterAll, describe, it, expect } from "vitest";
import { db, FinanceDB, initializeDatabase } from "./database";
import { loadDemo, deleteDemo } from "./demo";
import {
  createBackup,
  validateBackup,
  restoreBackup,
  clearLocalData,
  exportCsv,
} from "./backup";
import { editTransaction, linkTransfers } from "./transactions";
import { transaction, accounts, bankRows } from "../tests/helpers";
import { prepareDraft, commitDraft, validateDraft } from "../import/pipeline";
import { cashFlow } from "../analytics/calculations";
beforeEach(async () => {
  await clearLocalData();
});
afterAll(async () => {
  await db.delete();
});
describe("storage and backup integrity", () => {
  it("initializes once and retains category customizations", async () => {
    await initializeDatabase();
    await db.categories.update("shopping", { name: "My shopping" });
    await initializeDatabase();
    expect((await db.categories.get("shopping"))?.name).toBe("My shopping");
  });
  it("round trips a complete versioned backup", async () => {
    await loadDemo();
    const before = await createBackup();
    expect(validateBackup(JSON.parse(JSON.stringify(before)))).toEqual(before);
    await clearLocalData();
    expect(await db.transactions.count()).toBe(0);
    await restoreBackup(before);
    const after = await createBackup();
    expect(after.transactions).toEqual(before.transactions);
    expect(after.accounts).toEqual(before.accounts);
    expect(after.categories).toEqual(before.categories);
  });
  it("rejects malformed, future and orphaned backups before mutation", async () => {
    await loadDemo();
    const b = await createBackup();
    const count = await db.transactions.count();
    expect(() => validateBackup({ ...b, version: 99 })).toThrow();
    expect(() => validateBackup({ ...b, schemaVersion: 99 })).toThrow();
    expect(() => validateBackup({ ...b, accounts: [] })).toThrow();
    expect(() =>
      validateBackup({
        ...b,
        transactions: [...b.transactions, b.transactions[0]],
      }),
    ).toThrow();
    expect(() =>
      validateBackup({
        ...b,
        transactions: b.transactions.map((t, i) =>
          i ? t : { ...t, amount: 1.5 },
        ),
      }),
    ).toThrow();
    await expect(restoreBackup({ ...b, categories: [] })).rejects.toThrow();
    expect(await db.transactions.count()).toBe(count);
  });
  it("deletes only demo data", async () => {
    await loadDemo();
    await db.accounts.put(accounts[0]);
    await db.transactions.put(transaction({ id: "real" }));
    await deleteDemo();
    expect(await db.transactions.count()).toBe(1);
    expect(await db.transactions.get("real")).toBeDefined();
    expect(await db.accounts.count()).toBe(1);
  });
  it("exports portable CSV and neutralizes spreadsheet formulas", async () => {
    await db.accounts.put(accounts[0]);
    await db.transactions.put(
      transaction({ description: '=HYPERLINK("unsafe")', merchant: "@unsafe" }),
    );
    const csv = await exportCsv();
    expect(csv).toContain('"Date","Description","Merchant","Amount"');
    expect(csv).toContain("\"'=HYPERLINK");
    expect(csv).toContain('"-10.00"');
    expect(csv).toContain("Barclays");
  });
  it("preserves transactions through a v1 to v2 migration", async () => {
    const name = "migration-test";
    const old = new Dexie(name);
    old
      .version(1)
      .stores({
        accounts: "id,institution,currency",
        statements:
          "id,accountId,sourceFileHash,statementPeriodEnd,[accountId+statementPeriodStart+statementPeriodEnd]",
        transactions:
          "id,date,accountId,statementId,categoryId,transactionFingerprint,[currency+date],[accountId+date]",
        categories: "id,parentId",
        rules: "id,priority",
        transferLinks: "id",
        settings: "key",
      });
    const t = transaction();
    const { occurrence: _o, isReviewed: _r, tags: _tags, ...legacy } = t;
    await old.table("transactions").put(legacy);
    old.close();
    const current = new FinanceDB(name);
    await current.open();
    const preserved = await current.transactions.get("t1");
    expect(preserved?.amount).toBe(-1000);
    expect(preserved?.description).toBe("WAITROSE");
    expect(preserved?.occurrence).toBe(0);
    expect(preserved?.tags).toEqual([]);
    expect(current.verno).toBe(2);
    await current.delete();
  });
});
describe("atomic import and editing", () => {
  const extraction = () => ({
    rows: bankRows(),
    hash: "synthetic-hash",
    filename: "synthetic.pdf",
    method: "embedded-text" as const,
    warnings: [],
  });
  it("commits only reviewed data and prevents exact or regenerated reimports", async () => {
    const d = await prepareDraft(extraction());
    expect(d.transactions).toHaveLength(4);
    await commitDraft(d);
    expect(await db.transactions.count()).toBe(4);
    const duplicate = await prepareDraft(extraction());
    expect(duplicate.exactDuplicate).toBe(true);
    await expect(commitDraft(duplicate)).rejects.toThrow("already");
    const regenerated = await prepareDraft({
      ...extraction(),
      hash: "regenerated-hash",
    });
    expect(regenerated.regenerated).toBe(true);
    expect(
      regenerated.transactions.every(
        (t) => t.duplicate === "certain" && !t.include,
      ),
    ).toBe(true);
    await commitDraft(regenerated);
    expect(await db.transactions.count()).toBe(4);
    expect(await db.statements.count()).toBe(2);
    validateBackup(await createBackup());
  });
  it("requires explicit reconciliation override and stores its audit trail", async () => {
    const d = await prepareDraft(extraction());
    d.transactions[0].amount -= 100;
    await expect(commitDraft(d)).rejects.toThrow("reconciliation");
    expect(await db.transactions.count()).toBe(0);
    await commitDraft(d, true);
    const s = await db.statements.get(d.statement.id);
    expect(s?.validationStatus).toBe("warning");
    expect(s?.validationOverride).toBe(true);
    expect(s?.validationDifference).toBe(100);
  });
  it("blocks unreviewed OCR, extraction warnings and kept duplicates", async () => {
    const d = await prepareDraft(extraction());
    d.transactions[0].extractionConfidence = 0.6;
    d.transactions[0].acknowledged = false;
    expect(() => validateDraft(d, false)).toThrow("uncertain");
    d.transactions[0].acknowledged = true;
    d.warnings = ["Partial extraction"];
    expect(() => validateDraft(d, false)).toThrow("warnings");
    d.reviewedWarnings = true;
    expect(() => validateDraft(d, false)).not.toThrow();
    d.transactions[0].duplicate = "possible";
    d.transactions[0].extractionConfidence = 1;
    d.transactions[0].acknowledged = false;
    expect(() => validateDraft(d, false)).toThrow("duplicate");
  });
  it("detects history changes that occurred during review", async () => {
    const d = await prepareDraft(extraction());
    const concurrent = await prepareDraft({
      ...extraction(),
      hash: "another-hash",
    });
    await commitDraft(concurrent);
    await expect(commitDraft(d)).rejects.toThrow("history changed");
    expect(await db.transactions.count()).toBe(4);
  });
  it("learns a correction rule and applies it on the next import", async () => {
    const d = await prepareDraft(extraction());
    await commitDraft(d);
    const t = d.transactions[0];
    await editTransaction(
      t.id,
      {
        merchant: "JOHN LEWIS",
        categoryId: "household",
        subcategoryId: undefined,
        type: "expense",
        tags: ["home"],
      },
      {
        id: "learned",
        name: "JOHN LEWIS → Household",
        match: "contains",
        pattern: "JOHN LEWIS",
        direction: "negative",
        categoryId: "household",
        priority: 100,
        builtIn: false,
      },
    );
    const next = await prepareDraft({ ...extraction(), hash: "next-hash" });
    expect(next.transactions[0].categoryId).toBe("household");
    expect((await db.transactions.get(t.id))?.tags).toEqual(["home"]);
  });
  it("links and unlinks both transfer sides atomically", async () => {
    await db.accounts.bulkAdd(accounts);
    const a = transaction({ id: "a", description: "Transfer", amount: -1000 });
    const b = transaction({
      id: "b",
      accountId: "a2",
      description: "Transfer",
      amount: 1000,
      type: "income",
    });
    await db.transactions.bulkAdd([a, b]);
    await linkTransfers("a", "b");
    let saved = await db.transactions.toArray();
    expect(cashFlow(saved, "GBP")).toEqual({ income: 0, expenses: 0, net: 0 });
    expect(await db.transferLinks.count()).toBe(1);
    await editTransaction("a", {
      merchant: "Purchase",
      type: "expense",
      categoryId: "shopping",
      subcategoryId: undefined,
      tags: [],
    });
    saved = await db.transactions.toArray();
    expect(saved.every((t) => !t.isTransfer && !t.transferPairId)).toBe(true);
    expect(await db.transferLinks.count()).toBe(0);
  });
  it("queries a month through an index with 20,000 persisted transactions", async () => {
    const rows = Array.from({ length: 20000 }, (_, i) =>
      transaction({
        id: `perf-${i}`,
        date: `2026-${String((i % 12) + 1).padStart(2, "0")}-01`,
        amount: -100 - i,
        merchant: `MERCHANT ${i % 100}`,
      }),
    );
    await db.transactions.bulkAdd(rows);
    const month = await db.transactions
      .where("[currency+date]")
      .between(["GBP", "2026-09-01"], ["GBP", "2026-10-01"], true, false)
      .toArray();
    expect(month.length).toBe(1666);
    expect(cashFlow(month, "GBP").expenses).toBeGreaterThan(0);
    expect(await db.transactions.count()).toBe(20000);
  }, 20000);
});
