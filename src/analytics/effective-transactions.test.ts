import { describe, expect, it } from "vitest";
import { transaction, accounts } from "../tests/helpers";
import { cashFlow, categorySpending, monthlySeries } from "./calculations";
import {
  allocateMinor,
  effectiveTransactions,
  ledgerTransactions,
  markRefundCandidates,
  needsReview,
  refundCandidates,
} from "./effective-transactions";
import {
  findTransferProposals,
  eligibleAutomaticProposals,
} from "../transfers/engine";
import { safeSum } from "../domain/money";
import { defaultCategories } from "../storage/database";

describe("refund and split reporting projections", () => {
  const purchase = transaction({
    id: "purchase",
    date: "2026-08-20",
    amount: -4000,
    merchant: "CLOTHING SHOP",
    categoryId: "shopping",
  });
  const refund = transaction({
    id: "refund",
    date: "2026-09-03",
    amount: 4000,
    kind: "refund",
    refundAllocations: [{ transactionId: purchase.id, amount: 4000 }],
  });
  it("nets a September refund in August, without September income", () => {
    const series = monthlySeries([purchase, refund], "2026-09", 2, "GBP");
    expect(
      series.map(({ income, expenses, net }) => ({ income, expenses, net })),
    ).toEqual([
      { income: 0, expenses: 0, net: 0 },
      { income: 0, expenses: 0, net: 0 },
    ]);
    expect(purchase.amount).toBe(-4000);
    expect(refund.amount).toBe(4000);
  });
  it("nets multiple partial reimbursements only once", () => {
    const one = {
      ...refund,
      id: "one",
      amount: 1000,
      refundAllocations: [{ transactionId: purchase.id, amount: 1000 }],
    };
    const two = {
      ...refund,
      id: "two",
      amount: 1500,
      refundAllocations: [{ transactionId: purchase.id, amount: 1500 }],
    };
    const projected = effectiveTransactions([purchase, one, two]);
    expect(cashFlow(projected, "GBP")).toEqual({
      income: 0,
      expenses: 1500,
      net: -1500,
    });
    expect(effectiveTransactions(projected)).toEqual(projected);
  });
  it("does not count an unlinked refund as income", () => {
    const pending = {
      ...refund,
      refundAllocations: undefined,
      isReviewed: false,
    };
    expect(cashFlow([pending], "GBP").income).toBe(0);
    expect(needsReview(pending)).toBe(true);
    expect(
      cashFlow(
        [transaction({ amount: 4000, categoryId: "refund", kind: undefined })],
        "GBP",
      ).income,
    ).toBe(0);
  });
  it("uses split children in categories and only the parent in balances", () => {
    const parent = transaction({
      id: "tesco",
      kind: "split_parent",
      amount: -6000,
    });
    const groceries = transaction({
      id: "food",
      parentId: parent.id,
      source: "split",
      amount: -4500,
      categoryId: "groceries",
    });
    const household = transaction({
      id: "home",
      parentId: parent.id,
      source: "split",
      amount: -1500,
      categoryId: "household",
    });
    const rows = [parent, groceries, household];
    expect(cashFlow(rows, "GBP").expenses).toBe(6000);
    expect(
      categorySpending(rows, defaultCategories, "GBP").map(
        ({ id, amount }) => ({ id, amount }),
      ),
    ).toEqual([
      { id: "groceries", amount: 4500 },
      { id: "household", amount: 1500 },
    ]);
    expect(ledgerTransactions(rows)).toEqual([parent]);
    expect(
      cashFlow(
        effectiveTransactions(rows).filter(
          (row) => row.categoryId === "groceries",
        ),
        "GBP",
      ).expenses,
    ).toBe(4500);
  });
  it("distributes a parent refund proportionally across split categories with exact pennies", () => {
    const parent = {
      ...purchase,
      kind: "split_parent" as const,
      amount: -6001,
    };
    const children = [
      transaction({
        id: "a",
        parentId: parent.id,
        amount: -4500,
        categoryId: "groceries",
      }),
      transaction({
        id: "b",
        parentId: parent.id,
        amount: -1501,
        categoryId: "household",
      }),
    ];
    const partial = {
      ...refund,
      amount: 1001,
      refundAllocations: [{ transactionId: parent.id, amount: 1001 }],
    };
    expect(cashFlow([parent, ...children, partial], "GBP").expenses).toBe(5000);
    expect(
      safeSum(
        effectiveTransactions([parent, ...children, partial]).map(
          (row) => row.amount,
        ),
      ),
    ).toBe(-5000);
  });
  it("allocates cumulative partial refunds once so remainder pennies never over-refund a split line", () => {
    const parent = transaction({
      id: "pennies",
      kind: "split_parent",
      amount: -2,
    });
    const children = [
      transaction({
        id: "penny-a",
        parentId: parent.id,
        amount: -1,
        categoryId: "groceries",
      }),
      transaction({
        id: "penny-b",
        parentId: parent.id,
        amount: -1,
        categoryId: "household",
      }),
    ];
    const refunds = ["first", "second"].map((id) =>
      transaction({
        id,
        kind: "refund",
        amount: 1,
        refundAllocations: [{ transactionId: parent.id, amount: 1 }],
      }),
    );
    expect(
      effectiveTransactions([parent, ...children, ...refunds]).map(
        (row) => row.amount,
      ),
    ).toEqual([0, 0]);
    expect(cashFlow([parent, ...children, ...refunds], "GBP")).toEqual({
      income: 0,
      expenses: 0,
      net: 0,
    });
    for (let original = 2; original <= 100; original++) {
      const split = [Math.floor(original / 2), Math.ceil(original / 2)];
      const rows = [
        transaction({ ...parent, amount: -original }),
        ...children.map((child, index) => ({
          ...child,
          amount: -split[index],
        })),
        ...Array.from({ length: original }, (_, index) =>
          transaction({
            id: `refund-${index}`,
            kind: "refund",
            amount: 1,
            refundAllocations: [{ transactionId: parent.id, amount: 1 }],
          }),
        ),
      ];
      expect(effectiveTransactions(rows).map((row) => row.amount)).toEqual([
        0, 0,
      ]);
    }
  });
  it("suggests the same merchant within 90 days and flags explicit refunds", () => {
    const credit = transaction({
      id: "credit",
      date: "2026-09-03",
      amount: 4000,
      merchant: purchase.merchant,
      isReviewed: false,
    });
    expect(refundCandidates(credit, [purchase])).toEqual([purchase]);
    expect(markRefundCandidates([purchase, credit])[1].kind).toBe("refund");
    expect(
      markRefundCandidates([
        transaction({
          amount: 4000,
          description: "CARD REFUND",
          isReviewed: false,
        }),
      ])[0].kind,
    ).toBe("refund");
    expect(
      refundCandidates({ ...credit, date: "2027-01-01" }, [purchase]),
    ).toEqual([]);
    expect(refundCandidates(credit, [{ ...purchase, amount: -3999 }])).toEqual(
      [],
    );
  });
  it("keeps reviewed normal income and ignores split children in the review count", () => {
    expect(
      markRefundCandidates([
        purchase,
        transaction({
          amount: 4000,
          merchant: purchase.merchant,
          isReviewed: true,
        }),
      ])[1].kind,
    ).toBeUndefined();
    expect(
      needsReview(transaction({ categoryId: "groceries", isReviewed: false })),
    ).toBe(false);
    expect(
      needsReview(transaction({ categoryId: undefined, isReviewed: true })),
    ).toBe(true);
    expect(
      needsReview(transaction({ parentId: "parent", isReviewed: false })),
    ).toBe(false);
  });
});

describe("minor-unit allocation properties", () => {
  it("preserves totals and signs across 500 seeded uneven allocations", () => {
    let state = 90210;
    const random = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state;
    };
    for (let run = 0; run < 500; run++) {
      const weights = Array.from(
        { length: 2 + (random() % 19) },
        () => random() % 100000,
      );
      const total = (random() % 100000000) * (random() % 2 ? 1 : -1);
      const allocation = allocateMinor(total, weights);
      expect(safeSum(allocation)).toBe(total);
      expect(
        allocation.every(
          (value) =>
            Number.isSafeInteger(value) &&
            (value === 0 || Math.sign(value) === Math.sign(total)),
        ),
      ).toBe(true);
    }
  });
  it("handles zero weights and large safe amounts without decimal drift", () => {
    expect(allocateMinor(5, [0, 0, 0])).toEqual([2, 2, 1]);
    expect(
      safeSum(allocateMinor(Number.MAX_SAFE_INTEGER, [1000, 333, 666])),
    ).toBe(Number.MAX_SAFE_INTEGER);
    expect(() => allocateMinor(1.1, [1, 2])).toThrow();
  });
});

describe("transfer proposals with manual default", () => {
  const debit = transaction({
    id: "out",
    date: "2026-09-01",
    amount: -95000,
    accountId: accounts[0].id,
  });
  const credit = transaction({
    id: "in",
    date: "2026-09-03",
    amount: 95000,
    accountId: accounts[2].id,
  });
  it("proposes a card repayment without changing ledger rows", () => {
    const proposal = findTransferProposals([debit, credit], accounts);
    expect(proposal).toHaveLength(1);
    expect(proposal[0]).toMatchObject({
      status: "pending",
      pairKind: "card_repayment",
    });
    expect(debit.isTransfer).toBe(false);
    expect(eligibleAutomaticProposals(proposal, [debit, credit])).toHaveLength(
      1,
    );
  });
  it("allows a weekend delay, but auto matching needs two days or less", () => {
    const later = { ...credit, date: "2026-09-05" };
    const proposal = findTransferProposals([debit, later], accounts);
    expect(proposal).toHaveLength(1);
    expect(eligibleAutomaticProposals(proposal, [debit, later])).toHaveLength(
      0,
    );
    expect(
      findTransferProposals([debit, later], accounts, { dateWindow: 3 }),
    ).toHaveLength(0);
  });
  it("does not auto choose between ambiguous equal-valued transactions", () => {
    const duplicate = { ...credit, id: "also-in" };
    const proposals = findTransferProposals(
      [debit, credit, duplicate],
      accounts,
    );
    expect(proposals).toHaveLength(2);
    expect(
      eligibleAutomaticProposals(proposals, [debit, credit, duplicate]),
    ).toHaveLength(0);
  });
  it("excludes same account, children, refunds, linked and wrong amounts", () => {
    for (const patch of [
      { accountId: debit.accountId },
      { parentId: "parent" },
      { kind: "refund" as const },
      { transferPairId: "linked" },
      { amount: 94999 },
    ])
      expect(
        findTransferProposals([debit, { ...credit, ...patch }], accounts),
      ).toHaveLength(0);
  });
  it("only proposes cross-currency matches with rates, always manually", () => {
    const foreign = { ...credit, currency: "EUR", amount: 100000 };
    expect(findTransferProposals([debit, foreign], accounts)).toHaveLength(0);
    const proposals = findTransferProposals([debit, foreign], accounts, {
      crossCurrencyValue: (row) => (row.amount < 0 ? -95000 : 95001),
    });
    expect(proposals[0].crossCurrency).toBe(true);
    expect(
      eligibleAutomaticProposals(proposals, [debit, foreign]),
    ).toHaveLength(0);
    expect(
      findTransferProposals([debit, foreign], accounts, {
        crossCurrencyValue: (row) => (row.amount < 0 ? -95000 : 98000),
      }),
    ).toHaveLength(0);
  });
});
