import { expect, it } from "vitest";
import { accounts, transaction } from "../tests/helpers";
import { manualCashBalance } from "./manual-cash";
const account = { ...accounts[0], tracking: "manual" as const };
const opening = {
  id: "opening",
  accountId: account.id,
  date: "2026-09-01",
  valueMinor: 10000,
  note: "Cash opening balance",
};
it("never invents a cash balance without an opening observation", () => {
  expect(
    manualCashBalance(
      account,
      [],
      [transaction({ source: "manual", amount: -500 })],
      "2026-09-30",
    ).valueMinor,
  ).toBeUndefined();
});
it("includes same-day payments after the explicit opening, refunds and transfers but no split children", () => {
  const rows = [
    transaction({
      id: "parent",
      source: "manual",
      date: "2026-09-01",
      amount: -1000,
      kind: "split_parent",
    }),
    transaction({
      id: "child",
      source: "split",
      parentId: "parent",
      amount: -1000,
    }),
    transaction({
      id: "refund",
      source: "manual",
      date: "2026-09-02",
      amount: 400,
      kind: "refund",
    }),
    transaction({
      id: "transfer",
      source: "manual",
      date: "2026-09-03",
      amount: 2000,
      type: "transfer",
      isTransfer: true,
    }),
    transaction({
      id: "future",
      source: "manual",
      date: "2026-10-01",
      amount: -5000,
    }),
  ];
  expect(
    manualCashBalance(account, [opening], rows, "2026-09-30"),
  ).toMatchObject({
    valueMinor: 11400,
    date: "2026-09-03",
    valuationDate: "2026-09-01",
  });
});
it("a later closing valuation resets the baseline and remains a dated observation", () => {
  const closing = {
    ...opening,
    id: "closing",
    date: "2026-09-15",
    valueMinor: 7000,
    note: "Cash counted by user",
  };
  const rows = [
    transaction({
      id: "included",
      source: "manual",
      date: "2026-09-15",
      amount: -1000,
    }),
    transaction({
      id: "after",
      source: "manual",
      date: "2026-09-16",
      amount: -500,
    }),
  ];
  expect(
    manualCashBalance(account, [opening, closing], rows, "2026-09-30")
      .valueMinor,
  ).toBe(6500);
  expect(
    manualCashBalance(account, [opening, closing], rows, "2026-09-14")
      .valueMinor,
  ).toBe(10000);
});
