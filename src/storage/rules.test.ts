import { beforeEach, describe, expect, it } from "vitest";
import { db, defaultRules } from "./database";
import { clearLocalData } from "./backup";
import { saveRule, deleteRule } from "./rules";
import { accounts, transaction } from "../tests/helpers";
import type { Rule } from "../domain/models";

const rule = (patch: Partial<Rule> = {}): Rule => ({
  id: "custom-rule",
  name: "Custom",
  match: "exact",
  pattern: " waitrose ",
  accountId: "a1",
  direction: "negative",
  categoryId: "groceries",
  priority: 100,
  builtIn: false,
  ...patch,
});
beforeEach(async () => {
  await clearLocalData();
  await db.accounts.bulkPut(accounts);
});
describe("safe personal rule management", () => {
  it("normalizes edits, retains identity and leaves past transactions unchanged", async () => {
    const t = transaction({ categoryId: "groceries" });
    await db.transactions.put(t);
    const saved = await saveRule(rule());
    expect(saved.pattern).toBe("WAITROSE");
    const updated = await saveRule({ ...saved, categoryId: "shopping" }, saved);
    expect(updated.id).toBe(saved.id);
    expect(updated.name).toBe("WAITROSE → Shopping");
    expect(await db.transactions.get(t.id)).toEqual(t);
  });
  it("rejects stale edits and deletes without changing the current rule", async () => {
    const saved = await saveRule(rule());
    await db.rules.update(saved.id, { priority: 101 });
    await expect(
      saveRule({ ...saved, categoryId: "shopping" }, saved),
    ).rejects.toThrow("changed");
    await expect(deleteRule(saved)).rejects.toThrow("changed");
    expect((await db.rules.get(saved.id))?.priority).toBe(101);
  });
  it("deletes a personal rule without touching categorized history", async () => {
    const t = transaction({ categoryId: "groceries" });
    await db.transactions.put(t);
    const saved = await saveRule(rule());
    await deleteRule(saved);
    expect(await db.rules.get(saved.id)).toBeUndefined();
    expect(await db.transactions.get(t.id)).toEqual(t);
  });
  it("requires real accounts, active main categories and compatible subcategories", async () => {
    await expect(saveRule(rule({ accountId: "missing" }))).rejects.toThrow(
      "account",
    );
    await expect(saveRule(rule({ categoryId: "missing" }))).rejects.toThrow(
      "category",
    );
    await db.categories.update("groceries", { archived: true });
    await expect(saveRule(rule())).rejects.toThrow("category");
    await expect(
      saveRule(rule({ categoryId: "shopping", subcategoryId: "missing" })),
    ).rejects.toThrow("subcategory");
  });
  it("validates explicit-currency amount ranges and transfer category clearing", async () => {
    await expect(
      saveRule(rule({ accountId: undefined, minAmount: 100 })),
    ).rejects.toThrow("account");
    await expect(
      saveRule(rule({ minAmount: 200, maxAmount: 100 })),
    ).rejects.toThrow("maximum");
    await expect(saveRule(rule({ minAmount: 1.5 }))).rejects.toThrow("amounts");
    await expect(saveRule(rule({ priority: 1.5 }))).rejects.toThrow("priority");
    const transfer = await saveRule(
      rule({ type: "transfer", subcategoryId: "anything" }),
    );
    expect(transfer.categoryId).toBeUndefined();
    expect(transfer.subcategoryId).toBeUndefined();
  });
  it("prevents editing or deleting built-in mappings", async () => {
    const builtin = defaultRules[0];
    await expect(
      saveRule({ ...builtin, builtIn: false }, builtin),
    ).rejects.toThrow("Built-in");
    await expect(deleteRule(builtin)).rejects.toThrow("Built-in");
    expect(await db.rules.get(builtin.id)).toEqual(builtin);
  });
});
