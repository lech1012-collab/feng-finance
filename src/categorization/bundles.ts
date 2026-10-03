import { z } from "zod";
import { db } from "../storage/database";
import { matches } from "./engine";
import { sha256 } from "../domain/normalize";
import type { Rule, Transaction } from "../domain/models";
const key = z.string().regex(/^[a-z0-9-]{1,100}$/);
const bundleSchema = z
  .object({
    format: z.literal("feng-finance-rules"),
    version: z.literal(1),
    categories: z
      .array(
        z
          .object({
            id: key,
            name: z.string().trim().min(1).max(100),
            kind: z.enum(["income", "expense"]),
          })
          .strict(),
      )
      .max(50),
    rules: z
      .array(
        z
          .object({
            name: z.string().trim().min(1).max(150),
            match: z.enum(["contains", "starts-with", "exact"]),
            pattern: z.string().trim().min(2).max(500),
            direction: z.enum(["positive", "negative", "any"]),
            categoryId: key.optional(),
            type: z.literal("transfer").optional(),
          })
          .strict()
          .refine(
            (r) => !!r.categoryId !== (r.type === "transfer"),
            "Choose a category or transfer type.",
          ),
      )
      .min(1)
      .max(100),
  })
  .strict();
export type RuleBundle = z.infer<typeof bundleSchema>;
export function validateRuleBundle(value: unknown) {
  const bundle = bundleSchema.parse(value);
  if (
    new Set(bundle.categories.map((c) => c.id)).size !==
    bundle.categories.length
  )
    throw new Error("Duplicate categories in rules file.");
  return bundle;
}
async function checkCategories(bundle: RuleBundle) {
  const categories = await db.categories.toArray();
  for (const c of bundle.categories) {
    const existing = categories.find((x) => x.id === c.id);
    if (
      existing &&
      (existing.kind !== c.kind || existing.parentId || existing.archived)
    )
      throw new Error(
        "A category conflicts with your existing categories. Resolve it in Settings first.",
      );
  }
  const ids = new Set([
    ...categories.filter((c) => !c.archived && !c.parentId).map((c) => c.id),
    ...bundle.categories.map((c) => c.id),
  ]);
  for (const r of bundle.rules)
    if (r.categoryId && !ids.has(r.categoryId))
      throw new Error("A rule refers to an unavailable category.");
}
async function prepare(bundle: RuleBundle) {
  await checkCategories(bundle);
  const rules: Rule[] = await Promise.all(
    bundle.rules.map(async (r) => {
      return {
        ...r,
        id: `personal-${await sha256(new TextEncoder().encode(JSON.stringify(r)))}`,
        builtIn: false,
        priority: 200,
      };
    }),
  );
  const transactions = await db.transactions.filter((t) => !t.isDemo).toArray();
  const changes = transactions.flatMap((t) => {
    const matched = rules.filter((r) => matches(r, t));
    const outcomes = new Set(
      matched.map((r) => `${r.type ?? ""}|${r.categoryId ?? ""}`),
    );
    if (outcomes.size > 1)
      throw new Error(
        "Some rules give conflicting results for the same transaction. Edit the rules file before applying it.",
      );
    const r = matched[0];
    if (!r) return [];
    const type = r.type ?? (t.amount >= 0 ? "income" : "expense");
    if (t.transferPairId && type !== "transfer")
      throw new Error(
        "A matching transaction is linked as a transfer. Unlink it before changing its category.",
      );
    const patch = {
      type,
      isTransfer: type === "transfer",
      categoryId: r.categoryId,
      subcategoryId: undefined,
      isReviewed: true,
    } satisfies Partial<Transaction>;
    return t.type === type &&
      t.isTransfer === patch.isTransfer &&
      t.categoryId === r.categoryId &&
      !t.subcategoryId
      ? []
      : [{ transaction: t, rule: r, patch }];
  });
  return {
    rules,
    changes,
    signature: JSON.stringify(
      changes.map((c) => [
        c.transaction.id,
        c.transaction.updatedAt,
        c.transaction.type,
        c.transaction.categoryId,
      ]),
    ),
  };
}
export async function previewRuleBundle(value: unknown) {
  return prepare(validateRuleBundle(value));
}
export async function applyRuleBundle(value: unknown, signature: string) {
  const bundle = validateRuleBundle(value);
  // Hash outside the Dexie transaction; native crypto promises can close IDB transactions.
  const prepared = await prepare(bundle);
  return db.transaction(
    "rw",
    db.categories,
    db.rules,
    db.transactions,
    async () => {
      await checkCategories(bundle);
      const current = await db.transactions.bulkGet(
        prepared.changes.map((c) => c.transaction.id),
      );
      const actual = JSON.stringify(
        current.map((t) =>
          t ? [t.id, t.updatedAt, t.type, t.categoryId] : null,
        ),
      );
      if (signature !== prepared.signature || actual !== signature)
        throw new Error(
          "Transactions changed during review. Select the rules file again.",
        );
      for (const c of bundle.categories)
        if (!(await db.categories.get(c.id)))
          await db.categories.add({ ...c, archived: false, color: "#829bd7" });
      await db.rules.bulkPut(prepared.rules);
      for (const c of prepared.changes)
        await db.transactions.update(c.transaction.id, {
          ...c.patch,
          updatedAt: new Date().toISOString(),
        });
      return prepared.changes.length;
    },
  );
}
