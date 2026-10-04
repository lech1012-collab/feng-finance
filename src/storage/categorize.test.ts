import { beforeEach, expect, it } from "vitest";
import { db, initializeDatabase } from "./database";
import { clearLocalData } from "./backup";
import { transaction } from "../tests/helpers";
import {
  categorizeCards,
  matchingUncategorized,
  undoCategory,
} from "./categorize";
import { categorize } from "../categorization/engine";
import { cashFlow } from "../analytics/calculations";
beforeEach(async () => {
  await clearLocalData();
  await initializeDatabase();
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
  const receipt = await categorizeCards([a, b], "groceries", true);
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
  await expect(categorizeCards([t], "shopping", true)).rejects.toThrow(
    "changed",
  );
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
