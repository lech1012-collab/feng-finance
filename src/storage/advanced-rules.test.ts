import { beforeEach, describe, expect, it } from "vitest";
import { db } from "./database";
import { clearLocalData } from "./backup";
import { accounts, transaction } from "../tests/helpers";
import {
  exportRules,
  importRules,
  previewRule,
  saveRuleWithExisting,
} from "./rules";
import { undoChange } from "./audit";
import { mergeTags, saveTag, tagTransactions } from "./tags";
import type { Rule, Transaction } from "../domain/models";
import { rememberCategory } from "./category-memory";
import { categorize } from "../categorization/engine";
import { conflictingCategoryRule } from "../categorization/rule-conflict";
import { buildSplitRuleOffer } from "../components/SplitRuleOffer";
const rule = (patch: Partial<Rule> = {}): Rule => ({
  id: "r",
  name: "Prime",
  match: "contains",
  pattern: "",
  direction: "any",
  priority: 1000,
  builtIn: false,
  conditions: [
    { field: "description", operator: "contains", value: "AMZN" },
    { field: "amount", operator: "lt", value: 1000 },
  ],
  actions: [
    { type: "category", categoryId: "entertainment" },
    { type: "rename", merchant: "Prime Video" },
  ],
  stopProcessing: true,
  ...patch,
});
beforeEach(async () => {
  await clearLocalData();
  await db.accounts.bulkPut(accounts);
});
describe("rule persistence, preview and Undo", () => {
  for (const mode of ["save", "import"] as const) {
    const apply = (value: Rule) =>
      mode === "save"
        ? saveRuleWithExisting(value)
        : importRules({
            format: "feng-finance-rules-v2",
            version: 2,
            rules: [value],
          });
    it(`${mode} Apply-existing refuses transfer classification of a refunded purchase atomically`, async () => {
      const purchase = transaction({
        id: "purchase",
        description: "AMZN PURCHASE",
        amount: -349,
        categoryId: "shopping",
      });
      const refund = transaction({
        id: "refund",
        description: "REFUND",
        amount: 100,
        type: "income",
        kind: "refund",
        categoryId: "refund",
        refundAllocations: [{ transactionId: purchase.id, amount: 100 }],
      });
      await db.transactions.bulkPut([purchase, refund]);
      await expect(
        apply(
          rule({
            conditions: [
              { field: "description", operator: "contains", value: "PURCHASE" },
            ],
            actions: [{ type: "kind", kind: "transfer" }],
          }),
        ),
      ).rejects.toThrow("Unlink the refunds");
      expect(await db.rules.get("r")).toBeUndefined();
      expect(await db.transactions.bulkGet([purchase.id, refund.id])).toEqual([
        purchase,
        refund,
      ]);
    });
    it(`${mode} Apply-existing keeps linked refunds out of normal categorization`, async () => {
      const purchase = transaction({
        id: "purchase",
        amount: -349,
        categoryId: "shopping",
      });
      const refund = transaction({
        id: "refund",
        description: "AMZN REFUND",
        amount: 100,
        type: "income",
        kind: "refund",
        categoryId: "refund",
        refundAllocations: [{ transactionId: purchase.id, amount: 100 }],
      });
      await db.transactions.bulkPut([purchase, refund]);
      await expect(
        apply(
          rule({
            conditions: [
              { field: "description", operator: "contains", value: "REFUND" },
            ],
            actions: [
              { type: "kind", kind: "normal" },
              { type: "category", categoryId: "entertainment" },
            ],
          }),
        ),
      ).rejects.toThrow("linked refund");
      expect(await db.rules.get("r")).toBeUndefined();
      expect(await db.transactions.get(refund.id)).toEqual(refund);
    });
  }
  it("keeps a broad learned Amazon default below a specific explicit amount rule", async () => {
    const explicit = rule({ priority: 20 });
    await saveRuleWithExisting(explicit, undefined, false);
    const large = transaction({
      merchant: "AMZN",
      description: "AMZN MARKETPLACE",
      amount: -2499,
      categoryId: "shopping",
    });
    const learned = await rememberCategory(large);
    expect(learned?.auto).toBe(true);
    expect(learned!.priority).toBeLessThan(explicit.priority);
    expect(
      categorize({ ...large, amount: -349 }, [learned!, explicit]),
    ).toMatchObject({ categoryId: "entertainment", merchant: "Prime Video" });
    expect(categorize(large, [learned!, explicit]).categoryId).toBe("shopping");
  });
  it("updates only a confirmed advanced financial action and preserves its conditions and rename", async () => {
    const explicit = rule();
    await saveRuleWithExisting(explicit, undefined, false);
    const before = transaction({
      merchant: "AMZN",
      description: "AMZN DIGITAL",
      amount: -349,
      categoryId: "entertainment",
    });
    expect(
      conflictingCategoryRule(
        before,
        { categoryId: "shopping", isTransfer: false },
        [explicit],
      )?.id,
    ).toBe(explicit.id);
    const updated = await rememberCategory(
      { ...before, categoryId: "shopping" },
      before,
    );
    expect(updated?.id).toBe(explicit.id);
    expect(updated?.conditions).toEqual(explicit.conditions);
    expect(updated?.priority).toBe(explicit.priority);
    expect(updated?.actions).toContainEqual({
      type: "rename",
      merchant: "Prime Video",
    });
    expect(updated?.actions).toContainEqual({
      type: "category",
      categoryId: "shopping",
      subcategoryId: undefined,
    });
    expect(await db.rules.filter((r) => !!r.auto).count()).toBe(0);
  });
  it("builds an exact-account future-only expense split offer using 2dp percentage allocation", async () => {
    const parent = transaction({
      id: "tesco",
      accountId: "a3",
      merchant: "TESCO",
      amount: -10000,
      kind: "split_parent",
    });
    const lines: Transaction[] = [
      transaction({
        id: "one",
        parentId: parent.id,
        accountId: parent.accountId,
        amount: -7500,
        categoryId: "groceries",
      }),
      transaction({
        id: "two",
        parentId: parent.id,
        accountId: parent.accountId,
        amount: -2500,
        categoryId: "household",
      }),
    ];
    const offer = buildSplitRuleOffer(parent, lines)!;
    expect(offer.actions?.[0].splits?.map((line) => line.percentage)).toEqual([
      75, 25,
    ]);
    expect(
      categorize({ ...parent, kind: "normal" }, [offer]).ruleSplit?.map(
        (line) => line.amount,
      ),
    ).toEqual([-7500, -2500]);
    expect(
      categorize({ ...parent, accountId: "a1", kind: "normal" }, [offer])
        .ruleSplit,
    ).toBeUndefined();
    await db.transactions.bulkPut([parent, ...lines]);
    const saved = await saveRuleWithExisting(
      { ...offer, id: "split-rule" },
      undefined,
      false,
    );
    expect(saved.result.count).toBe(0);
    expect(await db.transactions.get(parent.id)).toEqual(parent);
    await undoChange(saved.changeId);
    expect(await db.rules.get("split-rule")).toBeUndefined();
    expect(
      buildSplitRuleOffer({ ...parent, amount: 10000 }, lines),
    ).toBeUndefined();
  });
  it("rejects a rule combining transfer/refund and split actions", async () => {
    await expect(
      saveRuleWithExisting(
        rule({
          actions: [
            { type: "kind", kind: "transfer" },
            {
              type: "split",
              splits: [
                { categoryId: "groceries", percentage: 75 },
                { categoryId: "household", percentage: 25 },
              ],
            },
          ],
        }),
      ),
    ).rejects.toThrow("cannot also be split");
    expect(await db.rules.get("r")).toBeUndefined();
  });
  it("does not consume a single-use rule on preview and applies only once on commit", async () => {
    const rows = [
      transaction({
        id: "a",
        description: "AMZN",
        date: "2026-08-01",
        amount: -349,
      }),
      transaction({ id: "b", description: "AMZN", amount: -349 }),
    ];
    await db.transactions.bulkPut(rows);
    const r = rule({ singleUse: true });
    expect(await previewRule(r)).toHaveLength(2);
    expect(await db.rules.get(r.id)).toBeUndefined();
    const saved = await saveRuleWithExisting(r);
    expect(saved.result.count).toBe(1);
    expect(await db.rules.get(r.id)).toBeUndefined();
    expect((await db.transactions.get("a"))?.merchant).toBe("Prime Video");
    expect((await db.transactions.get("b"))?.merchant).toBe("WAITROSE");
    await undoChange(saved.changeId);
    expect(await db.transactions.bulkGet(["a", "b"])).toEqual(rows);
  });
  it("applies actions, tags and reviewed without changing original money", async () => {
    await saveTag({
      id: "trip",
      name: "Trip",
      colour: "#A99BD6",
      archived: false,
    });
    const t = transaction({
      description: "AMZN",
      amount: -349,
      isReviewed: false,
    });
    await db.transactions.put(t);
    const saved = await saveRuleWithExisting(
      rule({
        actions: [
          { type: "category", categoryId: "entertainment" },
          { type: "tag", tagIds: ["trip"] },
          { type: "reviewed", reviewed: true },
        ],
      }),
    );
    expect(await db.transactions.get(t.id)).toMatchObject({
      amount: -349,
      categoryId: "entertainment",
      tags: ["trip"],
      isReviewed: true,
    });
    expect((await db.rules.get("r"))?.stats?.hits).toBe(1);
    await undoChange(saved.changeId);
    expect(await db.transactions.get(t.id)).toEqual(t);
  });
  it("imports and exports rule definitions without exporting the transaction ledger", async () => {
    await saveRuleWithExisting(rule(), undefined, false);
    const value = await exportRules();
    expect(value.rules).toHaveLength(1);
    await db.rules.delete("r");
    const imported = await importRules(value, false);
    expect(await db.rules.get("r")).toMatchObject({ actions: rule().actions });
    await undoChange(imported.changeId);
    expect(await db.rules.get("r")).toBeUndefined();
  });
  it("imports the original v1 personal-rules format safely", async () => {
    await db.transactions.put(transaction({ categoryId: "groceries" }));
    const legacy = {
      format: "feng-finance-rules",
      version: 1,
      categories: [],
      rules: [
        {
          name: "My household purchases",
          match: "contains",
          pattern: "WAITROSE",
          direction: "negative",
          categoryId: "household",
        },
      ],
    };
    const saved = await importRules(legacy);
    expect((await db.transactions.get("t1"))?.categoryId).toBe("household");
    expect(
      (await db.rules.filter((r) => !r.builtIn).toArray())[0].pattern,
    ).toBe("WAITROSE");
    await undoChange(saved.changeId);
    expect((await db.transactions.get("t1"))?.categoryId).toBe("groceries");
  });
  it("requires reopening a closed month before applying past changes", async () => {
    await db.transactions.put(
      transaction({ description: "AMZN", amount: -349 }),
    );
    await db.monthCloses.put({
      month: "2026-09",
      closedAt: "2026-10-01",
      snapshot: { income: 0, expenses: 349, net: -349, transactionCount: 1 },
    });
    await expect(saveRuleWithExisting(rule())).rejects.toThrow("closed month");
    expect(await db.rules.get("r")).toBeUndefined();
    expect((await db.transactions.get("t1"))?.categoryId).toBeUndefined();
  });
});
describe("tag management", () => {
  it("renames, archives and bulk-tags with Undo", async () => {
    await saveTag({
      id: "trip",
      name: "Lisbon",
      colour: "#A99BD6",
      archived: false,
    });
    await db.transactions.put(transaction());
    const change = await tagTransactions(["t1"], ["trip"]);
    expect((await db.transactions.get("t1"))?.tags).toEqual(["trip"]);
    await undoChange(change.changeId);
    expect((await db.transactions.get("t1"))?.tags).toEqual([]);
    const edited = await saveTag({
      id: "trip",
      name: "Lisbon trip",
      colour: "#E7C46A",
      archived: true,
    });
    expect(await db.tags.get("trip")).toMatchObject({
      name: "Lisbon trip",
      archived: true,
    });
    await undoChange(edited.changeId);
    expect((await db.tags.get("trip"))?.name).toBe("Lisbon");
  });
  it("merges duplicates across transactions and rule conditions/actions atomically", async () => {
    await saveTag({
      id: "a",
      name: "Holiday",
      colour: "#A99BD6",
      archived: false,
    });
    await saveTag({
      id: "b",
      name: "Lisbon",
      colour: "#E7C46A",
      archived: false,
    });
    await db.transactions.put(transaction({ tags: ["a", "b"] }));
    await db.rules.put(
      rule({
        conditions: [{ field: "tag", operator: "equals", value: "a" }],
        actions: [{ type: "tag", tagIds: ["a"] }],
      }),
    );
    const merged = await mergeTags("a", "b");
    expect((await db.transactions.get("t1"))?.tags).toEqual(["b"]);
    expect((await db.rules.get("r"))?.conditions?.[0].value).toBe("b");
    expect(await db.tags.get("a")).toBeUndefined();
    await undoChange(merged.changeId);
    expect((await db.transactions.get("t1"))?.tags).toEqual(["a", "b"]);
    expect(await db.tags.get("a")).toBeDefined();
  });
});
