import { describe, expect, it } from "vitest";
import { transaction } from "../tests/helpers";
import {
  matchesTransactionCategory,
  quickTransactionFilterCounts,
  transactionCategoryIndex,
} from "./transaction-filters";

describe("transaction quick-filter counts", () => {
  it("counts split payments once in every matching category without counting child rows", () => {
    const rows = [
      transaction({ id: "parent", kind: "split_parent", amount: -1000 }),
      transaction({
        id: "first",
        parentId: "parent",
        categoryId: "groceries",
        amount: -300,
      }),
      transaction({
        id: "second",
        parentId: "parent",
        categoryId: "groceries",
        amount: -300,
      }),
      transaction({
        id: "third",
        parentId: "parent",
        categoryId: "property",
        amount: -400,
      }),
    ];
    const categories = transactionCategoryIndex(rows);
    expect(matchesTransactionCategory(rows[0], "groceries", categories)).toBe(
      true,
    );
    expect(quickTransactionFilterCounts(rows, categories)).toEqual({
      groceries: 1,
      property: 1,
      income: 0,
      salary: 0,
    });
  });

  it("uses credit signs for salary income while excluding refunds and every transfer marker", () => {
    const rows = [
      transaction({
        id: "salary",
        categoryId: "salary",
        amount: 10000,
        type: "expense",
      }),
      transaction({ id: "refund", kind: "refund", amount: 1000 }),
      transaction({ id: "older-refund", categoryId: "refund", amount: 1000 }),
      transaction({ id: "top-up", type: "transfer", amount: 1000 }),
      transaction({ id: "card", kind: "card_repayment", amount: 1000 }),
      transaction({ id: "linked", transferPairId: "pair", amount: 1000 }),
    ];
    expect(
      quickTransactionFilterCounts(rows, transactionCategoryIndex(rows)),
    ).toEqual({ groceries: 0, property: 0, income: 1, salary: 1 });
  });
});
