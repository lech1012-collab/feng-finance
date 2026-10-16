import type { RecurringSeries } from "../domain/models";
export const savedBill: RecurringSeries = {
  id: "saved-netflix",
  matchKey: "manual-netflix",
  accountId: "a1",
  name: "Netflix",
  currency: "GBP",
  cadence: "monthly",
  expectedAmountMinor: -1099,
  amountHistory: [],
  nextDue: "2026-10-04",
  status: "active",
};
export const detectedBill: RecurringSeries = {
  ...savedBill,
  id: "detected-netflix",
  matchKey: JSON.stringify(["a1", "GBP", "NETFLIX.COM", false]),
  name: "NETFLIX.COM",
  expectedAmountMinor: -1249,
  amountHistory: [{ date: "2026-09-04", amountMinor: -1249 }],
};
