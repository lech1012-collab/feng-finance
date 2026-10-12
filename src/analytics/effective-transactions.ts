import type { Transaction } from "../domain/models";
import { normalizeMerchant } from "../domain/normalize";
import { safeSum } from "../domain/money";

/** Exact proportional allocation; floating point is never used for money. */
export function allocateMinor(total: number, weights: number[]): number[] {
  if (
    !Number.isSafeInteger(total) ||
    weights.some((w) => !Number.isSafeInteger(w) || w < 0)
  )
    throw new Error("Allocation amounts must be integer minor units.");
  if (!weights.length) return [];
  const denominator = BigInt(safeSum(weights));
  const absolute = BigInt(Math.abs(total));
  const sign = Math.sign(total);
  const values =
    denominator === 0n
      ? weights.map(() => Number(absolute / BigInt(weights.length)) * sign)
      : weights.map(
          (weight) => Number((absolute * BigInt(weight)) / denominator) * sign,
        );
  let remainder = total - safeSum(values);
  // Assign pennies to the largest fractional remainders. Ties keep row order.
  const order = weights
    .map((weight, i) => ({
      i,
      fraction:
        denominator === 0n ? 0n : (absolute * BigInt(weight)) % denominator,
    }))
    .sort((a, b) =>
      a.fraction === b.fraction ? a.i - b.i : a.fraction > b.fraction ? -1 : 1,
    );
  for (let i = 0; remainder !== 0; i++) {
    const adjustment = Math.sign(remainder);
    values[order[i % order.length].i] += adjustment;
    remainder -= adjustment;
  }
  return values;
}

/** Use the complete ledger BEFORE applying a reporting-date filter. The return
 * value is a projection only; originals remain the authority for balances and
 * reconciliation. Refunds reduce their original purchases, never arrival-month
 * income. Split parents contribute no second copy to spending. */
export interface EffectiveTransaction extends Transaction {
  analyticsProjected?: true;
}
export function effectiveTransactions(
  transactions: Transaction[],
): EffectiveTransaction[] {
  if (
    transactions.every(
      (transaction) => (transaction as EffectiveTransaction).analyticsProjected,
    )
  )
    return transactions;
  const byId = new Map(
    transactions.map((transaction) => [transaction.id, transaction]),
  );
  const children = new Map<string, Transaction[]>();
  for (const transaction of transactions) {
    if (!transaction.parentId) continue;
    const list = children.get(transaction.parentId) ?? [];
    list.push(transaction);
    children.set(transaction.parentId, list);
  }
  for (const lines of children.values())
    lines.sort(
      (a, b) =>
        (a.occurrence ?? 0) - (b.occurrence ?? 0) || a.id.localeCompare(b.id),
    );
  const adjustments = new Map<string, number>();
  const refundedByPurchase = new Map<string, number>();
  for (const refund of transactions) {
    if (refund.kind !== "refund" && refund.categoryId !== "refund") continue;
    for (const allocation of refund.refundAllocations ?? []) {
      const purchase = byId.get(allocation.transactionId);
      // A missing original is intentionally not converted into income. Storage
      // validates allocations; this also safely handles an incomplete query.
      if (
        !purchase ||
        purchase.amount >= 0 ||
        !Number.isSafeInteger(allocation.amount) ||
        allocation.amount <= 0
      )
        continue;
      refundedByPurchase.set(
        purchase.id,
        safeSum([refundedByPurchase.get(purchase.id) ?? 0, allocation.amount]),
      );
    }
  }
  // Allocate the cumulative refund once. Rounding each reimbursement separately
  // could repeatedly assign its remainder penny to the same split line.
  for (const [purchaseId, total] of refundedByPurchase) {
    const purchase = byId.get(purchaseId)!;
    if (total > -purchase.amount)
      throw new Error(
        "Refund allocations exceed the original purchase amount. Review the linked refunds.",
      );
    const split = children.get(purchase.id);
    const targets = split?.length ? split : [purchase];
    const values = allocateMinor(
      total,
      targets.map((line) => Math.abs(line.amount)),
    );
    targets.forEach((line, i) =>
      adjustments.set(
        line.id,
        safeSum([adjustments.get(line.id) ?? 0, values[i]]),
      ),
    );
  }
  return transactions.flatMap((transaction) => {
    if (
      transaction.kind === "refund" ||
      (transaction.amount > 0 && transaction.categoryId === "refund") ||
      transaction.kind === "split_parent" ||
      children.has(transaction.id)
    )
      return [];
    const adjusted = adjustments.get(transaction.id) ?? 0;
    if ((transaction as EffectiveTransaction).analyticsProjected)
      return [transaction];
    if (!adjusted)
      return [{ ...transaction, analyticsProjected: true as const }];
    if (transaction.amount + adjusted > 0)
      throw new Error(
        "Refund allocations exceed the original purchase amount. Review the linked refunds.",
      );
    return [
      {
        ...transaction,
        amount: transaction.amount + adjusted,
        analyticsProjected: true as const,
      },
    ];
  });
}

export function refundCandidates(
  credit: Transaction,
  transactions: Transaction[],
): Transaction[] {
  if (credit.amount <= 0) return [];
  const merchant = normalizeMerchant(
    credit.sourceMerchant ?? credit.merchant ?? credit.description,
  );
  if (!merchant) return [];
  const alreadyAllocated = new Map<string, number>();
  for (const refund of transactions) {
    if (refund.id === credit.id || refund.kind !== "refund") continue;
    for (const allocation of refund.refundAllocations ?? [])
      alreadyAllocated.set(
        allocation.transactionId,
        (alreadyAllocated.get(allocation.transactionId) ?? 0) +
          allocation.amount,
      );
  }
  return transactions
    .filter((purchase) => {
      const age =
        (Date.parse(credit.date) - Date.parse(purchase.date)) / 86400000;
      return (
        purchase.amount < 0 &&
        !purchase.parentId &&
        !purchase.isTransfer &&
        !purchase.transferPairId &&
        purchase.currency === credit.currency &&
        !!purchase.isDemo === !!credit.isDemo &&
        age >= 0 &&
        age <= 90 &&
        normalizeMerchant(
          purchase.sourceMerchant ?? purchase.merchant ?? purchase.description,
        ) === merchant &&
        -purchase.amount - (alreadyAllocated.get(purchase.id) ?? 0) >=
          credit.amount
      );
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

/** A potential refund must be reviewed, rather than automatically inflating
 * income. Explicitly reviewed normal credits and confirmed transfers survive. */
export function markRefundCandidates(
  transactions: Transaction[],
): Transaction[] {
  return transactions.map((transaction) =>
    transaction.amount > 0 &&
    !transaction.isReviewed &&
    !transaction.isTransfer &&
    !transaction.transferPairId &&
    transaction.kind !== "card_repayment" &&
    transaction.kind !== "transfer" &&
    (transaction.categoryId === "refund" ||
      /\b(?:REFUND|REIMBURSEMENT|REVERSAL|CREDIT NOTE)\b/i.test(
        transaction.description,
      ) ||
      refundCandidates(transaction, transactions).length > 0)
      ? {
          ...transaction,
          kind: "refund",
          isReviewed: false,
          categoryId: undefined,
          subcategoryId: undefined,
          categorySource: undefined,
          categoryRuleId: undefined,
        }
      : transaction,
  );
}

export function needsReview(transaction: Transaction): boolean {
  if (transaction.parentId) return false;
  if (!transaction.isReviewed) return true;
  if (
    transaction.kind === "refund" ||
    (transaction.amount > 0 && transaction.categoryId === "refund")
  )
    return !transaction.refundAllocations?.length;
  if (transaction.kind === "split_parent") return false;
  return (
    !transaction.categoryId &&
    !transaction.isTransfer &&
    transaction.type !== "transfer" &&
    !transaction.transferPairId
  );
}

export function ledgerTransactions(transactions: Transaction[]): Transaction[] {
  return transactions.filter(
    (transaction) => !transaction.parentId && transaction.source !== "split",
  );
}
