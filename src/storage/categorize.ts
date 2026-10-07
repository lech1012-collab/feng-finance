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
      const before = current as Transaction[];
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
      if (before.slice(1).some((t) => t.categoryId))
        throw new Error("A matching transaction has already been categorized.");
      const updatedAt = new Date().toISOString();
      const after = before.map((t) => ({
        ...t,
        categoryId: transfer ? undefined : (parent?.id ?? category!.id),
        subcategoryId: !transfer && parent ? category!.id : undefined,
        type: transfer ? ("transfer" as const) : amountType(t.amount),
        isTransfer: transfer || t.isTransfer,
        isReviewed: true,
        updatedAt,
      }));
      const rule = await rememberCategory(after[0]);
      await db.transactions.bulkPut(after);
      return { before, after, rule, categoryName: categoryName! };
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
    if (
      receipt.rule &&
      JSON.stringify(await db.rules.get(receipt.rule.id)) !==
        JSON.stringify(receipt.rule)
    )
      throw new Error("The learned rule changed. Undo is no longer available.");
    await db.transactions.bulkPut(receipt.before);
    if (receipt.rule) await db.rules.delete(receipt.rule.id);
  });
}
