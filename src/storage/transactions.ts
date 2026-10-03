import type { Rule, Transaction, TransferLink } from "../domain/models";
import { db } from "./database";
import { id } from "../domain/normalize";
export async function editTransaction(
  tid: string,
  patch: Pick<
    Transaction,
    "merchant" | "categoryId" | "subcategoryId" | "type" | "tags"
  >,
  rule?: Rule,
) {
  await db.transaction(
    "rw",
    db.transactions,
    db.rules,
    db.transferLinks,
    async () => {
      const current = await db.transactions.get(tid);
      if (!current) throw new Error("Transaction no longer exists.");
      if (current.transferPairId && patch.type !== "transfer") {
        const pair = await db.transferLinks.get(current.transferPairId);
        if (pair) {
          for (const otherId of pair.transactionIds.filter((x) => x !== tid)) {
            const other = await db.transactions.get(otherId);
            if (other)
              await db.transactions.update(other.id, {
                type: other.amount >= 0 ? "income" : "expense",
                isTransfer: false,
                transferPairId: undefined,
                isReviewed: false,
              });
          }
          await db.transferLinks.delete(pair.id);
        }
      }
      await db.transactions.update(tid, {
        ...patch,
        categoryId: patch.type === "transfer" ? undefined : patch.categoryId,
        subcategoryId:
          patch.type === "transfer" ? undefined : patch.subcategoryId,
        isTransfer: patch.type === "transfer",
        transferPairId:
          patch.type === "transfer" ? current.transferPairId : undefined,
        isReviewed: true,
        updatedAt: new Date().toISOString(),
      });
      if (rule) await db.rules.add(rule);
    },
  );
}
export async function linkTransfers(aId: string, bId: string) {
  await db.transaction("rw", db.transactions, db.transferLinks, async () => {
    const a = await db.transactions.get(aId),
      b = await db.transactions.get(bId);
    if (
      !a ||
      !b ||
      a.id === b.id ||
      a.accountId === b.accountId ||
      a.currency !== b.currency ||
      a.amount !== -b.amount ||
      a.amount === 0 ||
      a.transferPairId ||
      b.transferPairId
    )
      throw new Error(
        "Choose unlinked transactions in different accounts with exactly opposite amounts and the same currency.",
      );
    const link: TransferLink = {
      id: id(),
      transactionIds: [a.id, b.id],
      createdAt: new Date().toISOString(),
      manual: true,
    };
    await db.transferLinks.add(link);
    for (const t of [a, b])
      await db.transactions.update(t.id, {
        type: "transfer",
        isTransfer: true,
        transferPairId: link.id,
        categoryId: undefined,
        subcategoryId: undefined,
        isReviewed: true,
        updatedAt: link.createdAt,
      });
  });
}
