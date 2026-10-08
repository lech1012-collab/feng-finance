import { db } from "./database";
import type { Rule } from "../domain/models";
import { normalizeDescription, normalizeMerchant } from "../domain/normalize";

/** Rules change future imports only; amounts and existing transactions stay intact. */
export async function saveRule(rule: Rule, expected?: Rule) {
  return db.transaction(
    "rw",
    db.rules,
    db.accounts,
    db.categories,
    async () => {
      if (rule.builtIn) throw new Error("Built-in mappings cannot be edited.");
      const current = await db.rules.get(rule.id);
      if (current?.builtIn)
        throw new Error("Built-in mappings cannot be edited.");
      if (expected) {
        if (JSON.stringify(current) !== JSON.stringify(expected))
          throw new Error("This rule changed. Reopen it before saving.");
      } else if (current) {
        throw new Error("This rule already exists.");
      }
      const pattern =
        rule.match === "exact"
          ? normalizeMerchant(rule.pattern)
          : normalizeDescription(rule.pattern);
      if (!pattern || pattern.length > 500)
        throw new Error("Enter a match pattern between 1 and 500 characters.");
      if (
        !["contains", "starts-with", "exact"].includes(rule.match) ||
        !["any", "positive", "negative"].includes(rule.direction) ||
        !Number.isSafeInteger(rule.priority)
      )
        throw new Error("Enter a valid match, direction and integer priority.");
      if (rule.accountId && !(await db.accounts.get(rule.accountId)))
        throw new Error("This account is no longer available.");
      if (
        (rule.minAmount !== undefined || rule.maxAmount !== undefined) &&
        !rule.accountId
      )
        throw new Error("Choose an account before setting an amount range.");
      for (const amount of [rule.minAmount, rule.maxAmount])
        if (
          amount !== undefined &&
          (!Number.isSafeInteger(amount) || amount < 0)
        )
          throw new Error("Amount limits must be positive amounts.");
      if (
        rule.minAmount !== undefined &&
        rule.maxAmount !== undefined &&
        rule.minAmount > rule.maxAmount
      )
        throw new Error("The maximum amount must be at least the minimum.");
      if (rule.type !== "transfer") {
        const main = rule.categoryId
          ? await db.categories.get(rule.categoryId)
          : undefined;
        if (!main || main.archived || main.parentId)
          throw new Error("Choose an available main category.");
        if (rule.subcategoryId) {
          const sub = await db.categories.get(rule.subcategoryId);
          if (!sub || sub.archived || sub.parentId !== main.id)
            throw new Error(
              "Choose an available subcategory of the main category.",
            );
        }
      }
      const saved: Rule = {
        ...rule,
        pattern,
        categoryId: rule.type === "transfer" ? undefined : rule.categoryId,
        subcategoryId:
          rule.type === "transfer" ? undefined : rule.subcategoryId,
        type: rule.type === "transfer" ? "transfer" : undefined,
        name:
          rule.type === "transfer"
            ? `${pattern} → Transfer`
            : `${pattern} → ${(await db.categories.get(rule.categoryId!))!.name}`,
      };
      await db.rules.put(saved);
      return saved;
    },
  );
}

export async function deleteRule(expected: Rule) {
  await db.transaction("rw", db.rules, async () => {
    const current = await db.rules.get(expected.id);
    if (!current || JSON.stringify(current) !== JSON.stringify(expected))
      throw new Error("This rule changed. Refresh before deleting it.");
    if (current.builtIn)
      throw new Error("Built-in mappings cannot be deleted.");
    await db.rules.delete(current.id);
  });
}
