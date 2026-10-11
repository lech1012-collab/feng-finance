import type { Category, Rule, Transaction } from "../domain/models";
import { normalizeDescription, normalizeMerchant } from "../domain/normalize";
import { financialType, amountType } from "../domain/transaction-type";
import { matchesConditions } from "./conditions";
import { allocateMinor } from "../analytics/effective-transactions";
export function suggestRulePattern(t: Transaction, rules: Rule[]) {
  const merchantRule = rules
    .filter((r) => r.builtIn && matches(r, t))
    .sort((a, b) => b.pattern.length - a.pattern.length)[0];
  return merchantRule?.pattern ?? normalizeMerchant(t.merchant);
}
export function matches(rule: Rule, t: Transaction) {
  if (rule.enabled === false) return false;
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
  if (rule.conditions?.length)
    return matchesConditions(t, rule.conditions, rule.conditionMatch ?? "all");
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
): Partial<Transaction> & Pick<Transaction, "type" | "isTransfer"> {
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
      r.actions?.length ||
      categories.some((c) => c.id === r.categoryId && !c.archived),
  );
  const sorted = [...active].sort(
    (a, b) =>
      Number(a.builtIn) - Number(b.builtIn) ||
      Number(a.auto || a.createdFrom === "auto") -
        Number(b.auto || b.createdFrom === "auto") ||
      b.priority - a.priority ||
      (a.match === "exact" ? -1 : 0) - (b.match === "exact" ? -1 : 0),
  );
  const patch: Partial<Transaction> & Pick<Transaction, "type" | "isTransfer"> =
    {
      type: amountType(t.amount),
      isTransfer: false,
    };
  const applied: string[] = [];
  const claimed = new Set<string>();
  for (const rule of sorted) {
    if (!matches(rule, t)) continue;
    applied.push(rule.id);
    const actions = rule.actions ?? [
      {
        type: "category" as const,
        categoryId: rule.categoryId,
        subcategoryId: rule.subcategoryId,
      },
      ...(rule.type === "transfer"
        ? [{ type: "kind" as const, kind: "transfer" as const }]
        : []),
    ];
    for (const action of actions) {
      if (action.type !== "tag" && claimed.has(action.type)) continue;
      if (action.type === "category") {
        const category = categories?.find((c) => c.id === action.categoryId);
        if (category?.kind === "income" && t.amount < 0) continue;
        if (action.categoryId === "refund") {
          if (t.amount <= 0) continue;
          patch.kind = "refund";
          claimed.add("kind");
        }
        if (
          categories &&
          action.categoryId &&
          !categories.some((c) => c.id === action.categoryId && !c.archived)
        )
          continue;
        patch.categoryId = action.categoryId;
        patch.subcategoryId = action.subcategoryId;
        patch.categoryRuleId = rule.id;
      } else if (action.type === "rename" && action.merchant) {
        patch.merchant = action.merchant;
        patch.sourceMerchant = t.sourceMerchant ?? t.merchant;
      } else if (action.type === "tag")
        patch.tags = [
          ...new Set([...(patch.tags ?? t.tags), ...(action.tagIds ?? [])]),
        ];
      else if (action.type === "kind" && action.kind) {
        if (action.kind === "refund" && t.amount <= 0) continue;
        if (action.kind === "split_parent") continue;
        patch.kind = action.kind;
        if (action.kind === "transfer" || action.kind === "card_repayment") {
          patch.type = "transfer";
          patch.isTransfer = true;
          patch.categoryId = undefined;
          patch.subcategoryId = undefined;
          claimed.add("category");
        }
      } else if (action.type === "reviewed")
        patch.isReviewed = action.reviewed ?? true;
      else if (action.type === "recurring")
        patch.recurringSeriesId = action.recurringSeriesId;
      else if (action.type === "split" && action.splits) {
        const amounts = allocateMinor(
          t.amount,
          action.splits.map((s) => Math.round(s.percentage * 100)),
        );
        patch.ruleSplit = action.splits.map((s, i) => ({
          categoryId: s.categoryId,
          amount: amounts[i],
          tags: s.tagIds,
        }));
      }
      claimed.add(action.type);
    }
    // Old single-action rules keep their previous first-match behavior.
    if (rule.stopProcessing ?? !rule.actions) break;
  }
  const finalKind = patch.kind ?? t.kind;
  if (
    patch.isTransfer ||
    finalKind === "transfer" ||
    finalKind === "card_repayment" ||
    finalKind === "refund"
  )
    patch.ruleSplit = undefined;
  if (finalKind === "refund" && !t.refundAllocations?.length)
    patch.isReviewed = false;
  if (applied.length)
    return {
      ...patch,
      categorySource: "rule",
      categoryRuleId: patch.categoryRuleId ?? applied[0],
      appliedRuleIds: applied,
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
