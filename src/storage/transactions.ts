import type { Rule, Transaction, TransferLink } from "../domain/models";
import { db } from "./database";
import { id } from "../domain/normalize";
import { amountType } from "../domain/transaction-type";
import { rememberCategory } from "./category-memory";
import { auditedMutation } from "./audit";
import { ensureMonthsOpen } from "./month-review";
import { ensureRefundIntegrity } from "./accuracy";
export async function editTransaction(
  tid: string,
  patch: Pick<
    Transaction,
    "merchant" | "categoryId" | "subcategoryId" | "type" | "tags"
  >,
  rule?: Rule,
  options: { learn?: boolean } = {},
) {
  return auditedMutation(
    "Edit transaction",
    [
      "transactions",
      "rules",
      "transferLinks",
      "categories",
      "settings",
      "monthCloses",
      "transferProposals",
    ],
    async () => {
      const current = await db.transactions.get(tid);
      if (!current) throw new Error("Transaction no longer exists.");
      await ensureMonthsOpen([current]);
      if (current.kind === "split_parent")
        throw new Error(
          "Edit the split lines or unsplit this transaction first.",
        );
      if (current.kind === "refund" && current.refundAllocations?.length)
        throw new Error(
          "Use Refund of to change a linked refund, or restore it as normal income first.",
        );
      if (
        current.parentId &&
        (patch.type === "transfer" || patch.categoryId === "refund")
      )
        throw new Error(
          "A split line must keep its original money direction. Unsplit the parent before marking it as a transfer or refund.",
        );
      const category = patch.categoryId
        ? await db.categories.get(patch.categoryId)
        : undefined;
      if (
        patch.type !== "transfer" &&
        category?.kind === "income" &&
        current.amount < 0
      )
        throw new Error(
          "This is money out. Income and Salary require a positive payment. Check the source statement before correcting its amount.",
        );
      await ensureRefundIntegrity(current, {
        ...current,
        ...patch,
        isTransfer: patch.type === "transfer",
        kind:
          patch.type === "transfer"
            ? "transfer"
            : patch.categoryId === "refund"
              ? "refund"
              : "normal",
      });
      if (current.transferPairId && patch.type !== "transfer") {
        const pair = await db.transferLinks.get(current.transferPairId);
        if (pair) {
          for (const otherId of pair.transactionIds.filter((x) => x !== tid)) {
            const other = await db.transactions.get(otherId);
            if (other) {
              await ensureMonthsOpen([other]);
              await db.transactions.update(other.id, {
                type: other.amount >= 0 ? "income" : "expense",
                isTransfer: false,
                transferPairId: undefined,
                isReviewed: false,
                kind: "normal",
                linkId: undefined,
              });
            }
          }
          await db.transferLinks.delete(pair.id);
          await db.transferProposals
            .where("status")
            .equals("confirmed")
            .filter(
              (proposal) =>
                pair.transactionIds.includes(proposal.debitTxId) &&
                pair.transactionIds.includes(proposal.creditTxId),
            )
            .modify({ status: "rejected" });
        }
      }
      await db.transactions.update(tid, {
        ...patch,
        sourceMerchant:
          current.sourceMerchant ?? (current.merchant || current.description),
        type:
          patch.type === "transfer" ? "transfer" : amountType(current.amount),
        categoryId: patch.type === "transfer" ? undefined : patch.categoryId,
        subcategoryId:
          patch.type === "transfer" ? undefined : patch.subcategoryId,
        isTransfer: patch.type === "transfer",
        kind:
          patch.type === "transfer"
            ? current.kind === "card_repayment"
              ? "card_repayment"
              : "transfer"
            : patch.categoryId === "refund"
              ? "refund"
              : "normal",
        transferPairId:
          patch.type === "transfer" ? current.transferPairId : undefined,
        isReviewed: true,
        categorySource: "manual",
        categoryRuleId: undefined,
        updatedAt: new Date().toISOString(),
      });
      if (!rule && options.learn !== false) {
        const saved = (await db.transactions.get(tid))!;
        const learned = await rememberCategory(saved, current);
        if (learned)
          await db.transactions.update(tid, { categoryRuleId: learned.id });
      }
      if (rule) {
        const priority =
          Math.max(100, ...(await db.rules.toArray()).map((r) => r.priority)) +
          1;
        if (!Number.isSafeInteger(priority))
          throw new Error("Rule priority is out of range.");
        await db.rules.add({ ...rule, priority });
        await db.transactions.update(tid, { categoryRuleId: rule.id });
      }
    },
  );
}
export async function linkTransfers(aId: string, bId: string) {
  return auditedMutation(
    "Link internal transfer",
    [
      "transactions",
      "transferLinks",
      "categories",
      "rules",
      "accounts",
      "settings",
      "monthCloses",
      "transferProposals",
    ],
    async () => {
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
        b.transferPairId ||
        a.parentId ||
        b.parentId ||
        ["refund", "split_parent"].includes(a.kind ?? "") ||
        ["refund", "split_parent"].includes(b.kind ?? "")
      )
        throw new Error(
          "Choose unlinked transactions in different accounts with exactly opposite amounts and the same currency. Unsplit or restore a refund as normal income before linking.",
        );
      for (const transaction of [a, b])
        await ensureRefundIntegrity(transaction, {
          ...transaction,
          type: "transfer",
          isTransfer: true,
          kind: "transfer",
        });
      await ensureMonthsOpen([a, b]);
      const credit = a.amount > 0 ? a : b;
      const receiving = await db.accounts.get(credit.accountId);
      const kind =
        receiving && ["credit", "credit_card"].includes(receiving.accountType)
          ? "card_repayment"
          : "transfer";
      const link: TransferLink = {
        id: id(),
        transactionIds: [a.id, b.id],
        createdAt: new Date().toISOString(),
        manual: true,
      };
      await db.transferLinks.add(link);
      for (const t of [a, b]) {
        await db.transactions.update(t.id, {
          type: "transfer",
          kind,
          isTransfer: true,
          transferPairId: link.id,
          linkId: link.id,
          categoryId: undefined,
          subcategoryId: undefined,
          isReviewed: true,
          categorySource: "manual",
          categoryRuleId: undefined,
          updatedAt: link.createdAt,
        });
        const rule = await rememberCategory(
          (await db.transactions.get(t.id))!,
          t,
        );
        if (rule)
          await db.transactions.update(t.id, { categoryRuleId: rule.id });
      }
      await db.transferProposals
        .filter(
          (proposal) =>
            proposal.status === "pending" &&
            link.transactionIds.some(
              (transactionId) =>
                transactionId === proposal.debitTxId ||
                transactionId === proposal.creditTxId,
            ),
        )
        .modify((proposal) => {
          proposal.status =
            link.transactionIds.includes(proposal.debitTxId) &&
            link.transactionIds.includes(proposal.creditTxId)
              ? "confirmed"
              : "rejected";
        });
      return link;
    },
  );
}
