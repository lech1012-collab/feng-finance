import { beforeEach, expect, it } from "vitest";
import { db, initializeDatabase } from "../storage/database";
import { clearLocalData } from "../storage/backup";
import { transaction } from "../tests/helpers";
import {
  cashFlow,
  propertyFlow,
  comparableMonths,
  comparisons,
} from "../analytics/calculations";
import {
  applyRuleBundle,
  previewRuleBundle,
  validateRuleBundle,
  type RuleBundle,
} from "./bundles";
import { categorize } from "./engine";
const bundle: RuleBundle = {
  format: "feng-finance-rules",
  version: 1,
  categories: [{ id: "cleaning", name: "Cleaning", kind: "expense" }],
  rules: [
    {
      name: "My transfer",
      match: "contains",
      pattern: "OWN ACCOUNT",
      direction: "positive",
      type: "transfer",
    },
    {
      name: "Personal cleaning",
      match: "contains",
      pattern: "HOME CLEANER",
      direction: "negative",
      categoryId: "cleaning",
    },
    {
      name: "Rental income",
      match: "contains",
      pattern: "REFERENCE: RENT",
      direction: "positive",
      categoryId: "property-income",
    },
  ],
};
beforeEach(async () => {
  await clearLocalData();
  await initializeDatabase();
});
it("applies private choices atomically, preserves printed values, and remembers future rules", async () => {
  const original = [
    transaction({
      id: "transfer",
      description: "OWN ACCOUNT PAYMENT",
      amount: 92000,
      type: "income",
    }),
    transaction({
      id: "cleaner",
      description: "HOME CLEANER",
      amount: -6400,
      categoryId: "property",
    }),
    transaction({
      id: "rent",
      description: "REFERENCE: RENT",
      amount: 190000,
      type: "income",
    }),
    transaction({
      id: "unrelated",
      description: "OWN ACCOUNT PAYMENT",
      amount: -400,
    }),
    transaction({
      id: "demo",
      description: "HOME CLEANER",
      amount: -3000,
      isDemo: true,
    }),
  ];
  await db.transactions.bulkPut(original);
  const preview = await previewRuleBundle(bundle);
  expect(preview.changes).toHaveLength(3);
  expect(await applyRuleBundle(bundle, preview.signature)).toBe(3);
  const after = await db.transactions.toArray();
  for (const before of original) {
    const current = after.find((t) => t.id === before.id)!;
    for (const field of [
      "amount",
      "date",
      "description",
      "accountId",
      "statementId",
      "transactionFingerprint",
    ] as const)
      expect(current[field]).toEqual(before[field]);
  }
  expect(await db.transactions.get("demo")).toEqual(original[4]);
  expect(await db.transactions.get("unrelated")).toEqual(original[3]);
  expect(propertyFlow(after, "GBP")).toEqual({
    income: 190000,
    expenses: 0,
    net: 190000,
  });
  expect(
    cashFlow(
      after.filter((t) => !t.isDemo),
      "GBP",
    ),
  ).toEqual({ income: 190000, expenses: 6800, net: 183200 });
  expect(
    categorize(
      transaction({ description: "HOME CLEANER NEXT MONTH" }),
      await db.rules.toArray(),
    ).categoryId,
  ).toBe("cleaning");
  const again = await previewRuleBundle(bundle);
  expect(await applyRuleBundle(bundle, again.signature)).toBe(0);
  expect(
    await db.rules.filter((r) => r.id.startsWith("personal-")).count(),
  ).toBe(3);
});
it("rejects stale previews without writing rules or categories", async () => {
  await db.transactions.put(transaction({ description: "HOME CLEANER" }));
  const preview = await previewRuleBundle(bundle);
  await db.transactions.update("t1", {
    updatedAt: "2026-10-04T00:00:00Z",
    categoryId: "household",
  });
  await expect(applyRuleBundle(bundle, preview.signature)).rejects.toThrow(
    "changed during review",
  );
  expect(await db.rules.filter((r) => !r.builtIn).count()).toBe(0);
  expect((await db.transactions.get("t1"))?.categoryId).toBe("household");
});
it("rejects unavailable categories and conflicting matching rules", async () => {
  await db.transactions.put(transaction({ description: "HOME CLEANER" }));
  await expect(
    previewRuleBundle({
      ...bundle,
      rules: [...bundle.rules, { ...bundle.rules[1], categoryId: "household" }],
    }),
  ).rejects.toThrow("conflicting");
  await db.categories.update("cleaning", { archived: true });
  await expect(previewRuleBundle(bundle)).rejects.toThrow("conflicts");
  await expect(
    previewRuleBundle({
      ...bundle,
      categories: [],
      rules: [{ ...bundle.rules[1], categoryId: "missing" }],
    }),
  ).rejects.toThrow("unavailable");
});
it("does not unlink a paired transfer as a side effect of categorization", async () => {
  await db.transactions.put(
    transaction({
      description: "HOME CLEANER",
      type: "transfer",
      isTransfer: true,
      transferPairId: "link",
    }),
  );
  await expect(previewRuleBundle(bundle)).rejects.toThrow(
    "linked as a transfer",
  );
});
it("validates schema and refuses ambiguous rule outcomes", () => {
  expect(() => validateRuleBundle({ ...bundle, version: 2 })).toThrow();
  expect(() =>
    validateRuleBundle({
      ...bundle,
      rules: [{ ...bundle.rules[0], categoryId: "cleaning" }],
    }),
  ).toThrow();
  expect(() =>
    validateRuleBundle({
      ...bundle,
      categories: [...bundle.categories, ...bundle.categories],
    }),
  ).toThrow("Duplicate");
});
it("adds new built-ins during upgrade without overwriting renamed or archived categories", async () => {
  await db.categories.delete("cleaning");
  await db.settings.delete("defaults-1.1");
  await db.categories.update("shopping", {
    name: "My purchases",
    archived: true,
  });
  await initializeDatabase();
  expect((await db.categories.get("cleaning"))?.name).toBe("Cleaning");
  await db.rules.delete("builtin-xiaomi");
  await initializeDatabase();
  expect(await db.rules.get("builtin-xiaomi")).toBeUndefined();
  expect(await db.categories.get("shopping")).toMatchObject({
    name: "My purchases",
    archived: true,
  });
});
it("avoids misleading comparisons between different imported account sets and currencies", () => {
  const items = [
    transaction({ date: "2026-08-10" }),
    transaction({ date: "2026-09-10" }),
    transaction({ date: "2026-09-11", accountId: "a2" }),
  ];
  expect(comparableMonths(items, "2026-09", "2026-08", "GBP")).toBe(false);
  expect(comparisons(items, [], "2026-09", "GBP").sampleMonths).toBe(0);
  expect(comparableMonths(items, "2026-09", "2026-08", "EUR")).toBe(false);
  items.push(transaction({ date: "2026-08-11", accountId: "a2" }));
  expect(comparableMonths(items, "2026-09", "2026-08", "GBP")).toBe(true);
  expect(comparisons(items, [], "2026-09", "GBP").average).toBe(2000);
});
