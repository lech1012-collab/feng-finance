// @vitest-environment node
import { beforeEach, afterAll, expect, it } from "vitest";
import { db, initializeDatabase } from "./database";
import { transaction, accounts } from "../tests/helpers";
import type { Transaction, Rule } from "../domain/models";
import { exportCsv } from "./backup";
import { tagTransactions, tagSummary, mergeTags } from "./tags";
import { undoChange } from "./audit";
import { categorize } from "../categorization/engine";
import { matchesCondition } from "../categorization/conditions";
import { loadDemo, deleteDemo } from "./demo";

function legacyPayment(): Transaction {
  const {
    tags: _tags,
    occurrence: _occurrence,
    isReviewed: _reviewed,
    ...raw
  } = transaction({ id: "legacy-payment" });
  // Exact recovery deliberately restores records before additive defaults.
  return raw as Transaction;
}
beforeEach(async () => {
  await db.transaction("rw", db.tables, async () => {
    for (const table of db.tables) await table.clear();
  });
  await initializeDatabase(db);
  await db.accounts.put(accounts[0]);
  await db.transactions.put(legacyPayment());
});
afterAll(async () => {
  await db.delete();
});

it("exports and filters an exactly restored legacy payment without persisting defaults", async () => {
  const original = await db.transactions.get("legacy-payment");
  expect(await exportCsv(db)).toContain('"WAITROSE","WAITROSE","-10.00"');
  expect(tagSummary([original!], "synthetic-tag", "GBP").count).toBe(0);
  expect(
    matchesCondition(original!, {
      field: "tag",
      operator: "equals",
      value: "",
    }),
  ).toBe(true);
  expect(
    matchesCondition(original!, {
      field: "reviewed",
      operator: "equals",
      value: false,
    }),
  ).toBe(true);
  const rule: Rule = {
    id: "synthetic-rule",
    name: "Tag synthetic payment",
    match: "contains",
    pattern: "WAITROSE",
    direction: "any",
    priority: 100,
    builtIn: false,
    actions: [{ type: "tag", tagIds: ["synthetic-tag"] }],
  };
  expect(categorize(original!, [rule]).tags).toEqual(["synthetic-tag"]);
  expect(await db.transactions.get("legacy-payment")).toEqual(original);
  expect(await db.changeLog.count()).toBe(0);
});

it("adds tags only on the user's explicit edit and Undo restores the missing fields exactly", async () => {
  const original = await db.transactions.get("legacy-payment");
  await db.tags.put({
    id: "synthetic-tag",
    name: "Synthetic",
    colour: "#ffffff",
    archived: false,
  });
  const edited = await tagTransactions(["legacy-payment"], ["synthetic-tag"]);
  expect((await db.transactions.get("legacy-payment"))?.tags).toEqual([
    "synthetic-tag",
  ]);
  expect(
    (await db.transactions.get("legacy-payment"))?.occurrence,
  ).toBeUndefined();
  await undoChange(edited.changeId, db);
  expect(await db.transactions.get("legacy-payment")).toEqual(original);
  await db.tags.put({
    id: "target",
    name: "Target",
    colour: "#ffffff",
    archived: false,
  });
  expect((await mergeTags("synthetic-tag", "target")).result).toBe(0);
  expect(await db.transactions.get("legacy-payment")).toEqual(original);
});

it("clears optional demo records without changing raw real payments missing tags", async () => {
  const original = await db.transactions.get("legacy-payment");
  await loadDemo();
  await deleteDemo();
  expect(await db.transactions.get("legacy-payment")).toEqual(original);
  expect(await db.transactions.count()).toBe(1);
});
