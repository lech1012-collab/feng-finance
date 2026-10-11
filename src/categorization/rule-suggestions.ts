import type { Rule, RuleAction, Transaction } from "../domain/models";
import { normalizeMerchant } from "../domain/normalize";
import { matches } from "./engine";

/** Suggestions use repeated explicit edits, never a guess from a single payment. */
export function suggestedRules(
  transactions: Transaction[],
  rules: Rule[],
): { rule: Rule; count: number }[] {
  const grouped = new Map<string, Transaction[]>();
  for (const t of transactions) {
    if (
      !t.isReviewed ||
      t.isDemo ||
      t.parentId ||
      t.categorySource !== "manual" ||
      t.isTransfer ||
      !t.categoryId
    )
      continue;
    const merchant = normalizeMerchant(t.sourceMerchant ?? t.merchant);
    if (!merchant) continue;
    const key = JSON.stringify([
      t.accountId,
      t.currency,
      Math.sign(t.amount),
      merchant,
      t.categoryId,
      t.subcategoryId ?? "",
      t.merchant,
    ]);
    const group = grouped.get(key) ?? [];
    group.push(t);
    grouped.set(key, group);
  }
  return [...grouped.entries()]
    .flatMap(([key, group]) => {
      if (group.length < 3) return [];
      const t = group[0];
      const matching = rules.filter(
        (r) => r.enabled !== false && matches(r, t),
      );
      const alreadyCategory = matching.some(
        (r) =>
          r.categoryId === t.categoryId ||
          r.actions?.some(
            (a) => a.type === "category" && a.categoryId === t.categoryId,
          ),
      );
      const renamed =
        normalizeMerchant(t.merchant) !==
        normalizeMerchant(t.sourceMerchant ?? t.merchant);
      const alreadyRename = matching.some((r) =>
        r.actions?.some(
          (a) => a.type === "rename" && a.merchant === t.merchant,
        ),
      );
      const actions: RuleAction[] = [];
      if (!alreadyCategory)
        actions.push({
          type: "category",
          categoryId: t.categoryId,
          subcategoryId: t.subcategoryId,
        });
      if (renamed && !alreadyRename)
        actions.push({ type: "rename", merchant: t.merchant });
      if (!actions.length) return [];
      return [
        {
          count: group.length,
          rule: {
            id: `suggested-${encodeURIComponent(key)}`,
            name: `Remember ${t.merchant}`,
            match: "exact" as const,
            pattern: normalizeMerchant(t.sourceMerchant ?? t.merchant),
            accountId: t.accountId,
            direction:
              t.amount >= 0 ? ("positive" as const) : ("negative" as const),
            conditions: [
              {
                field: "merchant" as const,
                operator: "equals" as const,
                value: normalizeMerchant(t.sourceMerchant ?? t.merchant),
              },
              {
                field: "accountId" as const,
                operator: "equals" as const,
                value: t.accountId,
              },
              {
                field: "direction" as const,
                operator: "equals" as const,
                value: t.amount >= 0 ? "positive" : "negative",
              },
            ],
            conditionMatch: "all" as const,
            actions,
            priority: Math.max(100, ...rules.map((r) => r.priority)) + 1,
            builtIn: false,
            stopProcessing: false,
            createdFrom: "user" as const,
          },
        },
      ];
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);
}
