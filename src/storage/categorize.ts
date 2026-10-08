import type { Transaction, Rule } from "../domain/models";
import { db } from "./database";
import { normalizeMerchant } from "../domain/normalize";
import { amountType } from "../domain/transaction-type";
import { rememberCategory } from "./category-memory";
export const TRANSFER_TARGET = "__feng-transfer";
export interface CategoryReceipt {
  before: Transaction[];
  after: Transaction[];
  rule?: Rule;
  rules?: Rule[];
  selectedIds?: string[];
  learning?: { merchant: string; accountId: string; count: number }[];
  categoryName: string;
}
export async function matchingUncategorized(t: Transaction) {
  const merchant = normalizeMerchant(t.sourceMerchant ?? t.merchant);
  if (!merchant) return [];
  return db.transactions
    .where("accountId")
    .equals(t.accountId)
    .filter(
      (p) =>
        !p.categoryId &&
        !p.subcategoryId &&
        !p.isTransfer &&
        p.type !== "transfer" &&
        !p.transferPairId &&
        p.currency === t.currency &&
        !!p.isDemo === !!t.isDemo &&
        Math.sign(p.amount) === Math.sign(t.amount) &&
        normalizeMerchant(p.sourceMerchant ?? p.merchant) === merchant,
    )
    .toArray();
}
export async function categorizeCards(
  expected: Transaction[],
  categoryId: string,
  options: { allowMultipleMerchants?: boolean; backfill?: boolean } = {},
): Promise<CategoryReceipt> {
  if (
    !expected.length ||
    new Set(expected.map((t) => t.id)).size !== expected.length
  )
    throw new Error("Choose a transaction first.");
  return db.transaction(
    "rw",
    db.transactions,
    db.categories,
    db.rules,
    async () => {
      const transfer = categoryId === TRANSFER_TARGET;
      const category = transfer
        ? undefined
        : await db.categories.get(categoryId);
      const categoryName = transfer ? "Transfer" : category?.name;
      const parent = category?.parentId
        ? await db.categories.get(category.parentId)
        : undefined;
      if (
        !transfer &&
        (!category ||
          category.archived ||
          (category.parentId && (!parent || parent.archived)))
      )
        throw new Error("This category is no longer available.");
      const current = await db.transactions.bulkGet(expected.map((t) => t.id));
      if (
        current.some(
          (t, i) => !t || JSON.stringify(t) !== JSON.stringify(expected[i]),
        )
      )
        throw new Error(
          "A transaction changed. Reopen it before categorizing.",
        );
      const chosen = current as Transaction[];
      const before = [...chosen];
      if (options.backfill) {
        const ids = new Set(before.map((t) => t.id));
        const scopes = new Set<string>();
        for (const t of chosen) {
          const scope = JSON.stringify([
            t.accountId,
            t.currency,
            Math.sign(t.amount),
            normalizeMerchant(t.sourceMerchant ?? t.merchant),
            !!t.isDemo,
          ]);
          if (scopes.has(scope)) continue;
          scopes.add(scope);
          for (const match of await matchingUncategorized(t))
            if (!ids.has(match.id)) {
              ids.add(match.id);
              before.push(match);
            }
        }
      }
      if (
        !transfer &&
        (parent ?? category)?.kind === "income" &&
        before.some((t) => t.amount < 0)
      )
        throw new Error(
          "This is money out. Income and Salary require a positive payment. Check the source statement before correcting its amount.",
        );
      const first = before[0];
      if (
        before.some(
          (t) => t.isTransfer || t.type === "transfer" || t.transferPairId,
        )
      )
        throw new Error("Transfers must be edited in transaction details.");
      if (
        !options.allowMultipleMerchants &&
        before.some(
          (t) =>
            t.accountId !== first.accountId ||
            t.currency !== first.currency ||
            Math.sign(t.amount) !== Math.sign(first.amount) ||
            normalizeMerchant(t.sourceMerchant ?? t.merchant) !==
              normalizeMerchant(first.sourceMerchant ?? first.merchant) ||
            !!t.isDemo !== !!first.isDemo,
        )
      )
        throw new Error(
          "Only matching merchants in the same account can be grouped.",
        );
      if (
        !options.allowMultipleMerchants &&
        before.slice(1).some((t) => t.categoryId)
      )
        throw new Error("A matching transaction has already been categorized.");
      const updatedAt = new Date().toISOString();
      const after = before.map((t) => ({
        ...t,
        categoryId: transfer ? undefined : (parent?.id ?? category!.id),
        subcategoryId: !transfer && parent ? category!.id : undefined,
        type: transfer ? ("transfer" as const) : amountType(t.amount),
        isTransfer: transfer || t.isTransfer,
        isReviewed: true,
        categorySource: chosen.some((p) => p.id === t.id)
          ? ("manual" as const)
          : ("rule" as const),
        updatedAt,
      }));
      const rules: Rule[] = [];
      const learning: NonNullable<CategoryReceipt["learning"]> = [];
      const grouped = new Map<string, Transaction[]>();
      for (const t of after) {
        const key = JSON.stringify([
          t.accountId,
          t.currency,
          Math.sign(t.amount),
          normalizeMerchant(t.sourceMerchant ?? t.merchant),
          !!t.isDemo,
        ]);
        const group = grouped.get(key) ?? [];
        group.push(t);
        grouped.set(key, group);
      }
      for (const group of grouped.values()) {
        const rule = await rememberCategory(group[0]);
        if (rule) rules.push(rule);
        for (const t of group) t.categoryRuleId = rule?.id;
        learning.push({
          merchant: group[0].merchant || group[0].description,
          accountId: group[0].accountId,
          count: group.length,
        });
      }
      await db.transactions.bulkPut(after);
      return {
        before,
        after,
        rule: rules[0],
        rules,
        learning,
        selectedIds: chosen.map((t) => t.id),
        categoryName: categoryName!,
      };
    },
  );
}
export async function undoCategory(receipt: CategoryReceipt) {
  await db.transaction("rw", db.transactions, db.rules, async () => {
    const current = await db.transactions.bulkGet(
      receipt.after.map((t) => t.id),
    );
    if (
      current.some(
        (t, i) => JSON.stringify(t) !== JSON.stringify(receipt.after[i]),
      )
    )
      throw new Error(
        "These transactions changed since categorization. Undo would overwrite newer changes.",
      );
    const rules = receipt.rules ?? (receipt.rule ? [receipt.rule] : []);
    for (const rule of rules)
      if (JSON.stringify(await db.rules.get(rule.id)) !== JSON.stringify(rule))
        throw new Error(
          "The learned rule changed. Undo is no longer available.",
        );
    await db.transactions.bulkPut(receipt.before);
    await db.rules.bulkDelete(rules.map((r) => r.id));
  });
}
