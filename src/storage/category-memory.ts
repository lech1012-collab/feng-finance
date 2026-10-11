import type { Transaction, Rule } from "../domain/models";
import { id, normalizeMerchant } from "../domain/normalize";
import { financialType } from "../domain/transaction-type";
import { db } from "./database";
import { conflictingCategoryRule } from "../categorization/rule-conflict";

/** Called inside the caller's atomic rules/categories/transactions write. */
export async function rememberCategory(
  t: Transaction,
  before: Transaction = t,
): Promise<Rule | undefined> {
  const pattern = normalizeMerchant(
    t.sourceMerchant ?? (t.merchant || t.description),
  );
  const transfer = financialType(t) === "transfer";
  if (
    t.isDemo ||
    t.parentId ||
    t.kind === "refund" ||
    t.kind === "split_parent" ||
    !pattern ||
    (!transfer && !t.categoryId)
  )
    return;
  const category = t.categoryId
    ? await db.categories.get(t.categoryId)
    : undefined;
  const subcategory = t.subcategoryId
    ? await db.categories.get(t.subcategoryId)
    : undefined;
  if (!transfer && (!category || category.archived || subcategory?.archived))
    throw new Error("This category is no longer available.");
  if (!transfer && category?.kind === "income" && t.amount < 0)
    throw new Error("Income and Salary require a positive payment.");
  const existingRules = await db.rules.toArray();
  const explicit = conflictingCategoryRule(
    before,
    {
      categoryId: transfer ? undefined : t.categoryId,
      isTransfer: transfer,
    },
    existingRules.filter((r) => !r.auto && r.createdFrom !== "auto"),
  );
  if (explicit) {
    const financialActions: NonNullable<Rule["actions"]> = transfer
      ? [
          {
            type: "kind",
            kind: t.kind === "card_repayment" ? "card_repayment" : "transfer",
          },
        ]
      : [
          {
            type: "category",
            categoryId: t.categoryId,
            subcategoryId: t.subcategoryId,
          },
          ...(explicit.actions?.some((action) => action.type === "kind")
            ? [{ type: "kind" as const, kind: "normal" as const }]
            : []),
        ];
    const updated: Rule = {
      ...explicit,
      actions: explicit.actions
        ? [
            ...financialActions,
            ...explicit.actions.filter(
              (action) => !["category", "kind", "split"].includes(action.type),
            ),
          ]
        : undefined,
      categoryId: transfer ? undefined : t.categoryId,
      subcategoryId: transfer ? undefined : t.subcategoryId,
      type: transfer ? "transfer" : undefined,
      lastUsedAt: new Date().toISOString(),
    };
    await db.rules.put(updated);
    return updated;
  }
  const previous = existingRules.find(
    (r) =>
      r.auto &&
      r.accountId === t.accountId &&
      r.match === "exact" &&
      r.pattern === pattern &&
      r.direction === (t.amount >= 0 ? "positive" : "negative"),
  );
  const nextAutoPriority =
    Math.max(
      100,
      ...existingRules
        .filter((r) => r.auto || r.createdFrom === "auto")
        .map((r) => r.priority),
    ) + 1;
  const explicitPriorities = existingRules
    .filter((r) => !r.builtIn && !r.auto && r.createdFrom !== "auto")
    .map((r) => r.priority);
  const priority = explicitPriorities.length
    ? Math.max(
        Number.MIN_SAFE_INTEGER,
        Math.min(nextAutoPriority, Math.min(...explicitPriorities) - 1),
      )
    : nextAutoPriority;
  if (!Number.isSafeInteger(priority))
    throw new Error("Rule priority is out of range.");
  const rule: Rule = {
    id: previous?.id ?? id(),
    name: `${pattern} → ${transfer ? "Transfer" : (subcategory ?? category)!.name}`,
    match: "exact",
    pattern,
    accountId: t.accountId,
    direction: t.amount >= 0 ? "positive" : "negative",
    categoryId: transfer ? undefined : t.categoryId,
    subcategoryId: transfer ? undefined : t.subcategoryId,
    type: transfer ? "transfer" : undefined,
    actions: transfer
      ? [
          {
            type: "kind",
            kind: t.kind === "card_repayment" ? "card_repayment" : "transfer",
          },
        ]
      : undefined,
    priority,
    builtIn: false,
    auto: true,
    createdFrom: "auto",
    lastUsedAt: new Date().toISOString(),
  };
  await db.rules.put(rule);
  return rule;
}
