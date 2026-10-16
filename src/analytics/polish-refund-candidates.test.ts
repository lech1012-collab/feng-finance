import { expect, it } from "vitest";
import { refundCandidates } from "./effective-transactions";
import { transaction } from "../tests/helpers";

it("restricts refund suggestions to the same original merchant, at most 90 days old, with enough unrefunded value and newest first", () => {
  const credit = transaction({
    id: "credit",
    amount: 5000,
    date: "2026-09-30",
    merchant: "John Lewis",
    sourceMerchant: "JOHN LEWIS",
    description: "JOHN LEWIS REFUND",
    type: "income",
    kind: "refund",
  });
  const purchase = (id: string, date: string, patch = {}) =>
    transaction({
      id,
      date,
      amount: -10000,
      merchant: "Edited shop nickname",
      sourceMerchant: "JOHN LEWIS",
      description: "JOHN LEWIS",
      ...patch,
    });
  const atNinetyDays = purchase("ninety", "2026-07-02");
  const recent = purchase("recent", "2026-09-20");
  const alreadyRefunded = purchase("already-refunded", "2026-09-25");
  const sourceRows = [
    atNinetyDays,
    recent,
    alreadyRefunded,
    purchase("too-old", "2026-07-01"),
    purchase("future", "2026-10-01"),
    purchase("too-small", "2026-09-29", { amount: -4999 }),
    purchase("another-merchant", "2026-09-29", {
      merchant: "LITTLE OAK NURSERY",
      sourceMerchant: "LITTLE OAK NURSERY",
    }),
    purchase("foreign", "2026-09-29", { currency: "EUR" }),
    purchase("demo", "2026-09-29", { isDemo: true }),
    purchase("transfer", "2026-09-29", { isTransfer: true }),
    purchase("child", "2026-09-29", { parentId: "split-parent" }),
    transaction({
      id: "previous-refund",
      amount: 5001,
      kind: "refund",
      refundAllocations: [{ transactionId: alreadyRefunded.id, amount: 5001 }],
    }),
  ];
  const snapshot = structuredClone(sourceRows);
  expect(refundCandidates(credit, sourceRows)).toEqual([recent, atNinetyDays]);
  expect(sourceRows).toEqual(snapshot);
  expect(credit.refundAllocations).toBeUndefined();
});
