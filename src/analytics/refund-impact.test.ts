import { describe, expect, it } from "vitest";
import { transaction } from "../tests/helpers";
import { refundAllocationImpact, refundCountedMonths } from "./refund-impact";

describe("refund allocation preview", () => {
  const purchase = transaction({
    id: "purchase",
    date: "2026-08-20",
    amount: -4000,
    categoryId: "shopping",
  });
  const refund = transaction({
    id: "refund",
    date: "2026-09-03",
    amount: 4000,
    kind: "refund",
    isReviewed: false,
  });
  it("previews the original month and category reduction without changing the arrival date", () => {
    const allocations = [{ transactionId: purchase.id, amount: 4000 }];
    expect(refundAllocationImpact(refund, [purchase], [], allocations)).toEqual(
      [{ month: "2026-08", categoryId: "shopping", amount: -4000 }],
    );
    expect(
      refundCountedMonths({ ...refund, refundAllocations: allocations }, [
        purchase,
      ]),
    ).toEqual(["2026-08"]);
    expect(refund.date).toBe("2026-09-03");
  });
  it("previews exact cumulative split pennies and an allocation moved between purchases", () => {
    const parent = {
      ...purchase,
      amount: -2,
      kind: "split_parent" as const,
      categoryId: undefined,
    };
    const children = [
      transaction({
        id: "a",
        parentId: parent.id,
        amount: -1,
        categoryId: "groceries",
        date: parent.date,
      }),
      transaction({
        id: "b",
        parentId: parent.id,
        amount: -1,
        categoryId: "household",
        date: parent.date,
      }),
    ];
    const first = {
      ...refund,
      id: "first",
      amount: 1,
      refundAllocations: [{ transactionId: parent.id, amount: 1 }],
    };
    expect(
      refundAllocationImpact(
        { ...refund, amount: 1 },
        [parent, ...children],
        [first],
        [{ transactionId: parent.id, amount: 1 }],
      ),
    ).toEqual([{ month: "2026-08", categoryId: "household", amount: -1 }]);
    const other = transaction({
      id: "other",
      date: "2026-09-01",
      amount: -4000,
      categoryId: "groceries",
    });
    expect(
      refundAllocationImpact(
        {
          ...refund,
          refundAllocations: [{ transactionId: purchase.id, amount: 4000 }],
        },
        [purchase, other],
        [],
        [{ transactionId: other.id, amount: 4000 }],
      ),
    ).toEqual([
      { month: "2026-08", categoryId: "shopping", amount: 4000 },
      { month: "2026-09", categoryId: "groceries", amount: -4000 },
    ]);
  });
  it("uses the configured reporting period for labels", () => {
    const settings = [
      {
        key: "period:start",
        value: JSON.stringify({ mode: "fixed", day: 15 }),
      },
    ];
    expect(
      refundCountedMonths(
        {
          ...refund,
          refundAllocations: [{ transactionId: purchase.id, amount: 4000 }],
        },
        [purchase],
        settings,
      ),
    ).toEqual(["2026-09"]);
  });
});
