import { db } from "./database";
import type {
  Category,
  Rule,
  RuleCondition,
  Transaction,
} from "../domain/models";
import {
  normalizeDescription,
  normalizeMerchant,
  sha256,
} from "../domain/normalize";
import { categorize, matches } from "../categorization/engine";
import { safePattern } from "../categorization/conditions";
import { auditedMutation } from "./audit";
import { ensureRefundIntegrity, transactionSplitRows } from "./accuracy";
import { ensureMonthsOpen } from "./month-review";
import { validateRuleBundle } from "../categorization/bundles";

export function validateConditions(conditions: RuleCondition[]) {
  if (!Array.isArray(conditions) || conditions.length > 20)
    throw new Error("Use up to 20 conditions.");
  const fields = [
    "description",
    "merchant",
    "displayMerchant",
    "amount",
    "direction",
    "accountId",
    "day",
    "currency",
    "tag",
    "kind",
    "reviewed",
    "source",
    "date",
    "note",
    "categoryId",
    "search",
  ];
  const operators = [
    "contains",
    "starts-with",
    "equals",
    "regex",
    "gt",
    "gte",
    "lt",
    "lte",
    "between",
    "in",
  ];
  for (const c of conditions) {
    if (!fields.includes(c.field) || !operators.includes(c.operator))
      throw new Error("This condition is not supported.");
    if (c.operator === "regex") safePattern(String(c.value));
    if (
      [
        "description",
        "merchant",
        "note",
        "search",
        "currency",
        "accountId",
      ].includes(c.field) &&
      typeof c.value === "string" &&
      !c.value.trim()
    )
      throw new Error("Enter a value for each condition.");
    if (c.field === "reviewed" && typeof c.value !== "boolean")
      throw new Error("Choose reviewed or not reviewed.");
    if (["amount", "day"].includes(c.field)) {
      if (!Number.isSafeInteger(c.value) || Number(c.value) < 0)
        throw new Error("Amounts and days must be whole positive minor units.");
      if (c.field === "day" && (Number(c.value) < 1 || Number(c.value) > 31))
        throw new Error("Days must be between 1 and 31.");
      if (
        c.operator === "between" &&
        (!Number.isSafeInteger(c.valueTo) ||
          Number(c.valueTo) < Number(c.value))
      )
        throw new Error("Enter a valid range.");
      if (
        c.field === "day" &&
        c.valueTo !== undefined &&
        Number(c.valueTo) > 31
      )
        throw new Error("Days must be between 1 and 31.");
    } else if (typeof c.value === "string" && c.value.length > 500)
      throw new Error("A condition is too long.");
  }
}

/** Rules change future imports only; amounts and existing transactions stay intact. */
export async function saveRule(rule: Rule, expected?: Rule) {
  return db.transaction(
    "rw",
    db.rules,
    db.accounts,
    db.categories,
    db.tags,
    db.recurringSeries,
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
      if ((!pattern && !rule.conditions?.length) || pattern.length > 500)
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
      if (rule.conditions) validateConditions(rule.conditions);
      if (rule.conditionMatch && !["all", "any"].includes(rule.conditionMatch))
        throw new Error("Choose match all or any.");
      if (rule.actions) {
        if (!rule.actions.length || rule.actions.length > 20)
          throw new Error("Choose between 1 and 20 actions.");
        if (
          rule.actions.some((a) => a.type === "split") &&
          rule.actions.some((a) => a.type === "kind" && a.kind !== "normal")
        )
          throw new Error(
            "A transfer or refund cannot also be split. Use one financial action.",
          );
        for (const action of rule.actions) {
          if (
            ![
              "category",
              "rename",
              "tag",
              "kind",
              "split",
              "reviewed",
              "recurring",
            ].includes(action.type)
          )
            throw new Error("This action is not supported.");
          if (
            action.type === "category" &&
            (!action.categoryId ||
              !(await db.categories.get(action.categoryId)) ||
              (await db.categories.get(action.categoryId))?.archived)
          )
            throw new Error("Choose an available category.");
          if (
            action.type === "rename" &&
            (!action.merchant?.trim() || action.merchant.length > 200)
          )
            throw new Error(
              "Enter a display name between 1 and 200 characters.",
            );
          if (action.type === "tag")
            for (const tagId of action.tagIds ?? [])
              if (!(await db.tags.get(tagId)))
                throw new Error("Choose an available tag.");
          if (
            action.type === "kind" &&
            !["normal", "transfer", "card_repayment", "refund"].includes(
              action.kind ?? "",
            )
          )
            throw new Error(
              "Choose normal, transfer, card repayment or refund.",
            );
          if (
            action.type === "reviewed" &&
            action.reviewed !== undefined &&
            typeof action.reviewed !== "boolean"
          )
            throw new Error("Choose reviewed or not reviewed.");
          if (
            action.type === "recurring" &&
            (!action.recurringSeriesId ||
              !(await db.recurringSeries.get(action.recurringSeriesId)))
          )
            throw new Error("Choose an available recurring series.");
          if (action.type === "split") {
            const splits = action.splits ?? [];
            if (
              splits.length < 2 ||
              splits.length > 20 ||
              Math.abs(splits.reduce((s, l) => s + l.percentage, 0) - 100) >
                0.00001
            )
              throw new Error(
                "Split percentages must add up to 100% across 2 to 20 categories.",
              );
            for (const split of splits)
              if (
                !Number.isFinite(split.percentage) ||
                split.percentage <= 0 ||
                !(await db.categories.get(split.categoryId)) ||
                (await db.categories.get(split.categoryId))?.archived
              )
                throw new Error(
                  "Choose valid split percentages and categories.",
                );
          }
        }
      }
      if (rule.type !== "transfer" && !rule.actions) {
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
        name: rule.actions
          ? rule.name.trim() || "Personal rule"
          : rule.type === "transfer"
            ? `${pattern} → Transfer`
            : `${pattern} → ${(await db.categories.get(rule.categoryId!))!.name}`,
      };
      await db.rules.put(saved);
      return saved;
    },
  );
}

/** Preview is read-only: it does not consume single-use rules or update hit counts. */
export async function previewRule(rule: Rule) {
  return db.transactions
    .filter(
      (t) =>
        !t.isDemo &&
        !t.parentId &&
        t.kind !== "split_parent" &&
        matches(rule, t),
    )
    .toArray();
}

export async function consumeRuleApplications(transactions: Transaction[]) {
  const counts = new Map<string, number>();
  for (const t of transactions)
    for (const id of t.appliedRuleIds ??
      (t.categoryRuleId ? [t.categoryRuleId] : []))
      counts.set(id, (counts.get(id) ?? 0) + 1);
  const now = new Date().toISOString();
  for (const [id, hits] of counts) {
    const rule = await db.rules.get(id);
    if (!rule) continue;
    if (rule.singleUse) await db.rules.delete(id);
    else
      await db.rules.update(id, {
        stats: { hits: (rule.stats?.hits ?? 0) + hits, lastHit: now },
        lastUsedAt: now,
      });
  }
}

export async function saveRuleWithExisting(
  rule: Rule,
  expected?: Rule,
  applyExisting = true,
) {
  return auditedMutation(
    "Save categorization rule",
    [
      "rules",
      "transactions",
      "accounts",
      "categories",
      "tags",
      "monthCloses",
      "settings",
      "recurringSeries",
    ],
    async () => {
      const saved = await saveRule(rule, expected);
      if (!applyExisting) return { rule: saved, count: 0 };
      const categories = await db.categories.toArray();
      let matching = (await previewRule(saved)).sort(
        (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
      );
      if (saved.singleUse) matching = matching.slice(0, 1);
      await ensureMonthsOpen(matching);
      const after = matching.map((t) => {
        if (t.transferPairId)
          throw new Error("Unlink a transfer before applying a rule to it.");
        return {
          ...t,
          ...categorize(
            {
              ...t,
              isTransfer: false,
              type: t.amount >= 0 ? "income" : "expense",
            },
            [saved],
            [],
            categories,
          ),
          updatedAt: new Date().toISOString(),
        };
      });
      for (let index = 0; index < matching.length; index++)
        await ensureRefundIntegrity(matching[index], after[index]);
      for (const t of after) {
        if (t.ruleSplit) {
          const rows = transactionSplitRows(t, t.ruleSplit);
          await db.transactions.bulkPut(rows);
          await db.transactions.put({
            ...t,
            kind: "split_parent",
            categoryId: undefined,
            subcategoryId: undefined,
            ruleSplit: undefined,
          });
        } else await db.transactions.put(t);
      }
      await consumeRuleApplications(after);
      return { rule: saved, count: after.length };
    },
  );
}

export async function exportRules() {
  return {
    format: "feng-finance-rules-v2",
    version: 2,
    exportedAt: new Date().toISOString(),
    rules: await db.rules.filter((r) => !r.builtIn).toArray(),
  };
}

export async function importRules(value: unknown, applyExisting = true) {
  const legacyCategories: Category[] = [];
  if (
    value &&
    typeof value === "object" &&
    "format" in value &&
    value.format === "feng-finance-rules"
  ) {
    const bundle = validateRuleBundle(value);
    for (const category of bundle.categories)
      legacyCategories.push({ ...category, archived: false, color: "#A99BD6" });
    // Hashing stays outside the IndexedDB transaction.
    const rules: Rule[] = await Promise.all(
      bundle.rules.map(async (r) => ({
        ...r,
        id: `personal-${await sha256(new TextEncoder().encode(JSON.stringify(r)))}`,
        priority: 200,
        builtIn: false,
      })),
    );
    value = { format: "feng-finance-rules-v2", version: 2, rules };
  }
  if (
    !value ||
    typeof value !== "object" ||
    !("format" in value) ||
    value.format !== "feng-finance-rules-v2" ||
    !("version" in value) ||
    value.version !== 2 ||
    !("rules" in value) ||
    !Array.isArray(value.rules) ||
    value.rules.length > 1000
  )
    throw new Error("Choose a Feng v2 rules file.");
  const rules = value.rules as Rule[];
  for (const r of rules)
    if (
      !r ||
      typeof r.id !== "string" ||
      typeof r.name !== "string" ||
      typeof r.pattern !== "string" ||
      r.builtIn
    )
      throw new Error("This rules file contains an invalid rule.");
  return auditedMutation(
    "Import categorization rules",
    [
      "rules",
      "transactions",
      "accounts",
      "categories",
      "tags",
      "monthCloses",
      "settings",
      "recurringSeries",
    ],
    async () => {
      let count = 0;
      for (const category of legacyCategories) {
        const existing = await db.categories.get(category.id);
        if (
          existing &&
          (existing.kind !== category.kind ||
            existing.parentId ||
            existing.archived)
        )
          throw new Error(
            "A category in this rules file conflicts with your categories. Resolve it in Settings first.",
          );
        if (!existing) await db.categories.add(category);
      }
      for (const r of rules) {
        const existing = await db.rules.get(r.id);
        const saved = await saveRule(r, existing);
        if (applyExisting) {
          let transactions = await previewRule(saved);
          if (saved.singleUse) transactions = transactions.slice(0, 1);
          await ensureMonthsOpen(transactions);
          const categories = await db.categories.toArray();
          const after = transactions.map((t) => ({
            ...t,
            ...categorize(t, [saved], [], categories),
            updatedAt: new Date().toISOString(),
          }));
          for (let index = 0; index < transactions.length; index++) {
            if (transactions[index].transferPairId)
              throw new Error(
                "Unlink a transfer before applying a rule to it.",
              );
            await ensureRefundIntegrity(transactions[index], after[index]);
          }
          for (const t of after) {
            if (t.ruleSplit) {
              await db.transactions.bulkPut(
                transactionSplitRows(t, t.ruleSplit),
              );
              await db.transactions.put({
                ...t,
                kind: "split_parent",
                categoryId: undefined,
                subcategoryId: undefined,
                ruleSplit: undefined,
              });
            } else await db.transactions.put(t);
          }
          await consumeRuleApplications(after);
          count += after.length;
        }
      }
      return count;
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
