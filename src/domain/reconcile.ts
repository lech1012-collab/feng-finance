import type { Reconciliation } from "./models";
import { safeSum } from "./money";
export function reconcile(
  opening: number | undefined,
  closing: number | undefined,
  amounts: number[],
): Reconciliation {
  return reconcileWithPolicy(opening, closing, amounts);
}

/** Historical imports retain their original one-minor-unit tolerance. */
export function reconciliationTolerance(policy?: "exact-v2.2") {
  return policy === "exact-v2.2" ? 0 : 1;
}

export function reconcileWithPolicy(
  opening: number | undefined,
  closing: number | undefined,
  amounts: readonly number[],
  policy?: "exact-v2.2",
): Reconciliation {
  if (opening === undefined || closing === undefined)
    return { status: "unavailable", reported: closing };
  const calculated = safeSum([opening, ...amounts]);
  const difference = closing - calculated;
  return {
    status:
      Math.abs(difference) <= reconciliationTolerance(policy)
        ? "reconciled"
        : "warning",
    calculated,
    reported: closing,
    difference,
  };
}
