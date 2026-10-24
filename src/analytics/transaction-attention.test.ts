import { describe, expect, it } from "vitest";
import { transaction } from "../tests/helpers";
import {
  needsCategory,
  needsReview,
  transactionReviewReason,
} from "./effective-transactions";

describe("actionable transaction attention", () => {
  it.each([
    { categoryId: "groceries", categorySource: "rule" as const },
    { categoryId: "salary", amount: 350000, type: "income" as const },
    { categoryId: "shopping", categorySource: "manual" as const },
    {
      categoryId: "groceries",
      extractionConfidence: 0.6,
      checkLevel: "ocr" as const,
    },
    { categoryId: "groceries", checkLevel: "manual_override" as const },
    { subcategoryId: "property-repairs" },
    { type: "transfer" as const },
    { isTransfer: true },
    { transferPairId: "linked" },
    { kind: "transfer" as const },
    { kind: "card_repayment" as const },
    {
      kind: "refund" as const,
      amount: 500,
      refundAllocations: [{ transactionId: "purchase", amount: 500 }],
    },
  ])("does not ask for a redundant manual stamp on %j", (patch) => {
    const row = transaction({ ...patch, isReviewed: false });
    const before = structuredClone(row);
    expect(needsReview(row)).toBe(false);
    expect(needsCategory(row)).toBe(false);
    expect(transactionReviewReason(row)).toBeUndefined();
    expect(row).toEqual(before);
  });
  it("keeps 189 rule-categorised payments out of the queue without marking them manually reviewed", () => {
    const rows = Array.from({ length: 189 }, (_, index) =>
      transaction({
        id: `classified-${index}`,
        categoryId: "groceries",
        categorySource: "rule",
        isReviewed: false,
      }),
    );
    expect(rows.filter(needsReview)).toEqual([]);
    expect(rows.every((row) => !row.isReviewed)).toBe(true);
  });
  it.each([
    [{}, "category"],
    [{ isReviewed: true }, "category"],
    [{ kind: "refund", amount: 500, isReviewed: true }, "refund"],
    [{ categoryId: "refund", amount: 500 }, "refund"],
    [{ kind: "split_parent", categoryId: "groceries" }, "split"],
    [{ categoryId: "groceries", checkLevel: "review" }, "source"],
  ] as const)("preserves the real decision for %j", (patch, reason) => {
    const row = transaction({ isReviewed: false, ...patch });
    expect(transactionReviewReason(row)).toBe(reason);
    expect(needsReview(row)).toBe(true);
    expect(needsCategory(row)).toBe(reason === "category");
  });
  it("does not turn split children into separate review chores", () => {
    expect(
      needsReview(
        transaction({
          parentId: "parent",
          isReviewed: false,
          checkLevel: "review",
        }),
      ),
    ).toBe(false);
    expect(
      needsReview(transaction({ kind: "split_parent", isReviewed: true })),
    ).toBe(false);
  });
  it("keeps categorisation pending after a source confirmation when the category is missing", () => {
    const row = transaction({ isReviewed: true, checkLevel: "review" });
    expect(transactionReviewReason(row)).toBe("category");
  });
});
