import type { Transaction, Rule } from "../domain/models";
import { id, normalizeMerchant } from "../domain/normalize";
import { financialType } from "../domain/transaction-type";
import { db } from "./database";

/** Called inside the caller's atomic rules/categories/transactions write. */
export async function rememberCategory(
  t: Transaction,
): Promise<Rule | undefined> {
  const pattern = normalizeMerchant(
    t.sourceMerchant ?? (t.merchant || t.description),
  );
  const transfer = financialType(t) === "transfer";
  if (t.isDemo || !pattern || (!transfer && !t.categoryId)) return;
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
  const priority =
    Math.max(100, ...(await db.rules.toArray()).map((r) => r.priority)) + 1;
  if (!Number.isSafeInteger(priority))
    throw new Error("Rule priority is out of range.");
  const rule: Rule = {
    id: id(),
    name: `${pattern} → ${transfer ? "Transfer" : (subcategory ?? category)!.name}`,
    match: "exact",
    pattern,
    accountId: t.accountId,
    direction: t.amount >= 0 ? "positive" : "negative",
    categoryId: transfer ? undefined : t.categoryId,
    subcategoryId: transfer ? undefined : t.subcategoryId,
    type: transfer ? "transfer" : undefined,
    priority,
    builtIn: false,
  };
  await db.rules.add(rule);
  return rule;
}
