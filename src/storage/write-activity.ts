// Page-local activity only. No record, amount or identifier is exposed.
let pending = 0;
const listeners = new Set<() => void>();
export const hasPendingFinancialWrites = () => pending > 0;
export function subscribeFinancialWrites(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function notify() {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      /* UI observers cannot interrupt a financial write. */
    }
  }
}
export async function duringFinancialWrite<T>(
  operation: () => Promise<T>,
): Promise<T> {
  pending++;
  notify();
  try {
    return await operation();
  } finally {
    pending--;
    notify();
  }
}
