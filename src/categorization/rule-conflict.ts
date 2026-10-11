import type { Rule, Transaction } from "../domain/models";
import { categorize, matches } from "./engine";
export function conflictingCategoryRule(
  transaction: Transaction,
  target: { categoryId?: string; isTransfer: boolean },
  rules: Rule[],
): Rule | undefined {
  const existing = rules
    .filter(
      (rule) =>
        !rule.builtIn &&
        (!rule.actions ||
          rule.actions.some(
            (action) =>
              action.type === "category" ||
              action.type === "split" ||
              (action.type === "kind" && action.kind !== "normal"),
          )) &&
        matches(rule, transaction),
    )
    .sort(
      (a, b) =>
        Number(a.auto || a.createdFrom === "auto") -
          Number(b.auto || b.createdFrom === "auto") || b.priority - a.priority,
    )[0];
  if (!existing) return;
  const result = categorize(
    {
      ...transaction,
      kind: "normal",
      transferPairId: undefined,
      type: transaction.amount >= 0 ? "income" : "expense",
      isTransfer: false,
    },
    [existing],
  );
  return (
    target.isTransfer
      ? !result.isTransfer
      : result.isTransfer ||
        (result.kind === "refund" ? "refund" : result.categoryId) !==
          target.categoryId ||
        !!result.ruleSplit
  )
    ? existing
    : undefined;
}
