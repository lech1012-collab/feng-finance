import { beforeEach, expect, it } from "vitest";
import { db, initializeDatabase } from "./database";
import {
  clearLocalData,
  deleteImportedRecords,
  createBackup,
  restoreBackup,
} from "./backup";
import { transaction, accounts } from "../tests/helpers";
import {
  categorizeCards,
  matchingUncategorized,
  undoCategory,
  TRANSFER_TARGET,
} from "./categorize";
import { categorize } from "../categorization/engine";
import { cashFlow } from "../analytics/calculations";
import { editTransaction } from "./transactions";
beforeEach(async () => {
  await clearLocalData();
  await initializeDatabase();
});
it("remembers a direct debit after import deletion, reload and backup restore, scoped to its account and direction", async () => {
  const t = transaction({
    merchant: "DIRECT DEBIT TO HAMM&FULH CTAX REF: 12345678",
    description: "DIRECT DEBIT TO HAMM&FULH CTAX REF: 12345678",
    amount: -15500,
  });
  await db.accounts.bulkPut(accounts);
  await db.transactions.put(t);
  const receipt = await categorizeCards([t], "childcare");
  await deleteImportedRecords();
  const backup = await createBackup();
  db.close();
  await db.open();
  expect(await db.transactions.count()).toBe(0);
  expect(await db.accounts.get(t.accountId)).toEqual(accounts[0]);
  const rules = await db.rules.toArray();
  expect(rules).toContainEqual(receipt.rule);
  expect(categorize(t, rules).categoryId).toBe("childcare");
  expect(
    categorize({ ...t, accountId: "different" }, rules).categoryId,
  ).toBeUndefined();
  expect(categorize({ ...t, amount: 15500 }, rules).categoryId).toBeUndefined();
  await restoreBackup(backup);
  await deleteImportedRecords();
  expect(categorize(t, await db.rules.toArray()).categoryId).toBe("childcare");
  await db.transactions.put({
    ...t,
    merchant: "MY CHILDCARE CLUB",
    sourceMerchant: t.merchant,
  });
  await editTransaction(t.id, {
    merchant: "RENAMED AGAIN",
    categoryId: "utilities",
    subcategoryId: undefined,
    type: "expense",
    tags: [],
  });
  await deleteImportedRecords();
  expect(categorize(t, await db.rules.toArray()).categoryId).toBe("utilities");
  await clearLocalData();
  expect(categorize(t, await db.rules.toArray()).categoryId).toBeUndefined();
});
it("demo categorization never creates a real merchant rule", async () => {
  const t = transaction({
    isDemo: true,
    merchant: "UNIQUE MERCHANT",
    description: "UNIQUE MERCHANT",
  });
  await db.transactions.put(t);
  const receipt = await categorizeCards([t], "childcare");
  expect(receipt.rule).toBeUndefined();
  await deleteImportedRecords();
  expect(categorize(t, await db.rules.toArray()).categoryId).toBeUndefined();
});
it("a later manual correction becomes the default without a rule argument", async () => {
  const t = transaction({ merchant: "CITY CLUB", description: "CITY CLUB" });
  await db.transactions.put(t);
  await categorizeCards([t], "entertainment");
  await editTransaction(t.id, {
    merchant: "MY CHILDCARE CLUB",
    categoryId: "childcare",
    subcategoryId: undefined,
    type: "expense",
    tags: [],
  });
  await deleteImportedRecords();
  expect(categorize(t, await db.rules.toArray()).categoryId).toBe("childcare");
});
it("Salary categorization repairs an incoming payment type without changing money or provenance", async () => {
  const salary = transaction({
    amount: 372600,
    merchant: "SIEMENS",
    description: "SIEMENS",
    type: "expense",
    categoryId: undefined,
  });
  await db.transactions.put(salary);
  const receipt = await categorizeCards([salary], "salary");
  expect(receipt.after[0]).toMatchObject({
    amount: 372600,
    type: "income",
    categoryId: "salary",
    statementId: salary.statementId,
    transactionFingerprint: salary.transactionFingerprint,
    isTransfer: false,
  });
  expect(cashFlow(receipt.after, "GBP").income).toBe(372600);
  await undoCategory(receipt);
  expect(await db.transactions.get(salary.id)).toEqual(salary);
});
it("detail edits classify salary and income by credit direction, and refuse debit salary", async () => {
  const salary = transaction({ amount: 372600, type: "expense" });
  await db.transactions.put(salary);
  await editTransaction(salary.id, {
    merchant: "SIEMENS",
    categoryId: "salary",
    subcategoryId: undefined,
    type: "expense",
    tags: [],
  });
  expect(await db.transactions.get(salary.id)).toMatchObject({
    amount: 372600,
    type: "income",
    categoryId: "salary",
  });
  const debit = transaction({ id: "debit", amount: -15228 });
  await db.transactions.put(debit);
  await expect(categorizeCards([debit], "salary")).rejects.toThrow("money out");
  await expect(
    editTransaction(debit.id, {
      merchant: "SIEMENS",
      categoryId: "salary",
      subcategoryId: undefined,
      type: "income",
      tags: [],
    }),
  ).rejects.toThrow("money out");
  expect(await db.transactions.get(debit.id)).toEqual(debit);
});
it("marks debit and credit transfers, excludes them from cash flow, learns safe rules and supports Undo", async () => {
  for (const amount of [-50000, 50000]) {
    const t = transaction({
      amount,
      merchant: "MY OTHER ACCOUNT",
      description: "MY OTHER ACCOUNT",
      categoryId: "shopping",
      subcategoryId: "old",
    });
    await db.transactions.put(t);
    const receipt = await categorizeCards([t], TRANSFER_TARGET);
    expect(receipt.categoryName).toBe("Transfer");
    expect(receipt.after[0]).toMatchObject({
      amount,
      type: "transfer",
      isTransfer: true,
    });
    expect(receipt.after[0].categoryId).toBeUndefined();
    expect(receipt.after[0].subcategoryId).toBeUndefined();
    expect(receipt.after[0].transferPairId).toBeUndefined();
    expect(cashFlow(receipt.after, "GBP")).toMatchObject({
      income: 0,
      expenses: 0,
      net: 0,
    });
    expect(
      categorize({ ...t, categoryId: undefined }, [receipt.rule!]),
    ).toMatchObject({
      type: "transfer",
      isTransfer: true,
      categoryId: undefined,
    });
    expect(
      categorize({ ...t, accountId: "other-account" }, [receipt.rule!])
        .isTransfer,
    ).toBe(false);
    await undoCategory(receipt);
    expect(await db.transactions.get(t.id)).toEqual(t);
    expect(await db.rules.get(receipt.rule!.id)).toBeUndefined();
  }
});
it("categorizes a group and learns an account-specific rule without changing financial fields", async () => {
  const a = transaction({
    merchant: "CORNER SHOP",
    description: "CORNER SHOP",
    categoryId: undefined,
  });
  const b = transaction({ ...a, id: "two", date: "2026-09-04", amount: -2000 });
  await db.transactions.bulkPut([
    a,
    b,
    transaction({ ...a, id: "other-account", accountId: "a2" }),
    transaction({ ...a, id: "already", categoryId: "shopping" }),
    transaction({ ...a, id: "credit", amount: 1000, type: "income" }),
  ]);
  const matches = await matchingUncategorized(a);
  expect(matches.map((t) => t.id).sort()).toEqual([a.id, b.id].sort());
  const before = cashFlow(await db.transactions.toArray(), "GBP");
  const receipt = await categorizeCards([a, b], "groceries");
  expect(receipt.after.every((t) => t.categoryId === "groceries")).toBe(true);
  expect(cashFlow(await db.transactions.toArray(), "GBP")).toEqual(before);
  expect(
    receipt.after.map(
      ({
        categoryId: _c,
        subcategoryId: _s,
        isReviewed: _r,
        updatedAt: _u,
        ...t
      }) => t,
    ),
  ).toEqual(
    [a, b].map(
      ({
        categoryId: _c,
        subcategoryId: _s,
        isReviewed: _r,
        updatedAt: _u,
        ...t
      }) => t,
    ),
  );
  expect(
    categorize(
      transaction({ merchant: "CORNER SHOP", description: "CORNER SHOP" }),
      await db.rules.toArray(),
    ).categoryId,
  ).toBe("groceries");
  expect(
    categorize(
      transaction({
        merchant: "CORNER SHOP",
        description: "CORNER SHOP",
        accountId: "a2",
      }),
      await db.rules.toArray(),
    ).categoryId,
  ).toBeUndefined();
  await undoCategory(receipt);
  expect(await db.transactions.get(a.id)).toEqual(a);
  expect(await db.transactions.get(b.id)).toEqual(b);
  expect(await db.rules.get(receipt.rule!.id)).toBeUndefined();
});
it("refuses stale cards, archived categories and linked transfers atomically", async () => {
  const t = transaction();
  await db.transactions.put(t);
  await db.transactions.update(t.id, { tags: ["new"] });
  await expect(categorizeCards([t], "shopping")).rejects.toThrow("changed");
  expect(await db.rules.filter((r) => !r.builtIn).count()).toBe(0);
  await db.transactions.put(t);
  await db.categories.update("shopping", { archived: true });
  await expect(categorizeCards([t], "shopping")).rejects.toThrow("available");
  const transfer = { ...t, isTransfer: true, transferPairId: "pair" };
  await db.transactions.put(transfer);
  await expect(categorizeCards([transfer], "groceries")).rejects.toThrow(
    "Transfers",
  );
});
it("preserves a property subcategory and blocks undo from overwriting later edits", async () => {
  const t = transaction();
  await db.transactions.put(t);
  const receipt = await categorizeCards([t], "property-maintenance");
  expect(receipt.after[0]).toMatchObject({
    categoryId: "property",
    subcategoryId: "property-maintenance",
  });
  await db.transactions.update(t.id, { tags: ["later"] });
  await expect(undoCategory(receipt)).rejects.toThrow("newer changes");
  expect((await db.transactions.get(t.id))?.tags).toEqual(["later"]);
});
it("never groups different merchants, directions or previously categorized rows", async () => {
  const a = transaction();
  for (const patch of [
    { merchant: "DIFFERENT" },
    { amount: 1000 },
    { categoryId: "shopping" },
  ]) {
    const b = transaction({ id: "b", ...patch });
    await db.transactions.bulkPut([a, b]);
    await expect(categorizeCards([a, b], "groceries")).rejects.toThrow();
    expect((await db.transactions.get(a.id))?.categoryId).toBeUndefined();
  }
});
