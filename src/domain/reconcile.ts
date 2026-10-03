import type { Reconciliation } from "./models";
import { safeSum } from "./money";
export function reconcile(
  opening: number | undefined,
  closing: number | undefined,
  amounts: number[],
): Reconciliation {
  if (opening === undefined || closing === undefined)
    return { status: "unavailable", reported: closing };
  const calculated = safeSum([opening, ...amounts]);
  const difference = closing - calculated;
  return {
    status: Math.abs(difference) <= 1 ? "reconciled" : "warning",
    calculated,
    reported: closing,
    difference,
  };
}
