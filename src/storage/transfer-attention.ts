import type { Transaction, TransferProposal } from "../domain/models";
import { db } from "./database";

export function eligiblePair(
  proposal: TransferProposal,
  debit: Transaction,
  credit: Transaction,
) {
  return (
    debit.accountId !== credit.accountId &&
    debit.amount < 0 &&
    credit.amount > 0 &&
    [debit, credit].every(
      (leg) =>
        !leg.transferPairId &&
        !leg.parentId &&
        leg.kind !== "refund" &&
        leg.kind !== "split_parent",
    ) &&
    (proposal.crossCurrency
      ? debit.currency !== credit.currency
      : debit.currency === credit.currency && debit.amount === -credit.amount)
  );
}

/** A valid unresolved pair takes precedence over sorting either ledger entry. */
export async function pendingTransferAttention(scope?: readonly string[]) {
  const selected = scope && new Set(scope);
  const pending = (
    await db.transferProposals.where("status").equals("pending").toArray()
  ).filter(
    (p) => !selected || selected.has(p.debitTxId) || selected.has(p.creditTxId),
  );
  const [rows, refunds] = pending.length
    ? await Promise.all([
        db.transactions.bulkGet([
          ...new Set(pending.flatMap((p) => [p.debitTxId, p.creditTxId])),
        ]),
        db.transactions.where("kind").equals("refund").toArray(),
      ])
    : [[], []];
  const refundedPurchases = new Set(
    refunds.flatMap((row) =>
      (row.refundAllocations ?? []).map(
        (allocation) => allocation.transactionId,
      ),
    ),
  );
  const transactions = new Map(
    rows.filter((row): row is Transaction => !!row).map((row) => [row.id, row]),
  );
  const proposals = pending.filter((p) => {
    const debit = transactions.get(p.debitTxId),
      credit = transactions.get(p.creditTxId);
    return (
      debit &&
      credit &&
      !refundedPurchases.has(debit.id) &&
      eligiblePair(p, debit, credit)
    );
  });
  const ids = new Set(proposals.flatMap((p) => [p.debitTxId, p.creditTxId]));
  return { ids, proposals, transactions };
}
