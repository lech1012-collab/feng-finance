import type { Category, Rule, Transaction } from "../domain/models";
import { normalizeDescription, normalizeMerchant } from "../domain/normalize";
import { financialType, amountType } from "../domain/transaction-type";
export function suggestRulePattern(t: Transaction, rules: Rule[]) {
  const merchantRule = rules
    .filter((r) => r.builtIn && matches(r, t))
    .sort((a, b) => b.pattern.length - a.pattern.length)[0];
  return merchantRule?.pattern ?? normalizeMerchant(t.merchant);
}
export function matches(rule: Rule, t: Transaction) {
  if (rule.accountId && rule.accountId !== t.accountId) return false;
  if (
    (rule.direction === "positive" && t.amount <= 0) ||
    (rule.direction === "negative" && t.amount >= 0)
  )
    return false;
  if (
    (rule.minAmount !== undefined && Math.abs(t.amount) < rule.minAmount) ||
    (rule.maxAmount !== undefined && Math.abs(t.amount) > rule.maxAmount)
  )
    return false;
  const text = normalizeDescription(t.description);
  const pattern = normalizeDescription(rule.pattern);
  return rule.match === "exact"
    ? normalizeMerchant(t.sourceMerchant ?? t.merchant) ===
        normalizeMerchant(pattern)
    : rule.match === "starts-with"
      ? text.startsWith(pattern)
      : text.includes(pattern);
}
export function categorize(
  t: Transaction,
  rules: Rule[],
  history: Transaction[] = [],
  categories?: Category[],
): Pick<
  Transaction,
  | "categoryId"
  | "subcategoryId"
  | "type"
  | "isTransfer"
  | "categorySource"
  | "categoryRuleId"
> {
  if (financialType(t) === "transfer")
    return {
      categoryId: undefined,
      subcategoryId: undefined,
      type: "transfer",
      isTransfer: true,
      categorySource: t.categorySource,
      categoryRuleId: t.categoryRuleId,
    };
  const active = rules.filter(
    (r) =>
      !categories ||
      r.type === "transfer" ||
      categories.some((c) => c.id === r.categoryId && !c.archived),
  );
  const sorted = [...active].sort(
    (a, b) =>
      Number(a.builtIn) - Number(b.builtIn) ||
      (a.match === "exact" ? -1 : 0) - (b.match === "exact" ? -1 : 0) ||
      b.priority - a.priority,
  );
  const rule = sorted.find((r) => matches(r, t));
  if (rule)
    return {
      categoryId: rule.categoryId,
      subcategoryId: rule.subcategoryId,
      type: rule.type === "transfer" ? "transfer" : amountType(t.amount),
      isTransfer: rule.type === "transfer",
      categorySource: "rule",
      categoryRuleId: rule.id,
    };
  const previous = history.filter(
    (p) =>
      p.isReviewed &&
      !p.isTransfer &&
      p.categoryId &&
      p.accountId === t.accountId &&
      p.currency === t.currency &&
      normalizeMerchant(p.sourceMerchant ?? p.merchant) ===
        normalizeMerchant(t.sourceMerchant ?? t.merchant) &&
      Math.sign(p.amount) === Math.sign(t.amount),
  );
  const unique = new Set(
    previous.map((p) => `${p.categoryId}|${p.subcategoryId ?? ""}`),
  );
  if (unique.size === 1) {
    const last = previous[previous.length - 1];
    if (
      !categories ||
      categories.some((c) => c.id === last.categoryId && !c.archived)
    )
      return {
        categoryId: last.categoryId,
        subcategoryId: last.subcategoryId,
        type: t.amount >= 0 ? "income" : "expense",
        isTransfer: false,
      };
  }
  return {
    categoryId: undefined,
    subcategoryId: undefined,
    type: t.amount >= 0 ? "income" : "expense",
    isTransfer: false,
  };
}
