import { expect, it } from "vitest";
import { reviewDate, reviewPriceChanges } from "./month-review-details";
import { transaction } from "../tests/helpers";

const charges = (currency: string) =>
  [1000, 1000, 1000, 1200, 1200].map((amount, i) =>
    transaction({
      id: `${currency}:${i}`,
      currency,
      merchant: "NETFLIX",
      date: `2026-${String(i + 6).padStart(2, "0")}-05`,
      amount: -amount,
      categoryId: "subscriptions",
    }),
  );
it("reviews every native currency at the selected period cutoff, preserving its historical rise", () => {
  const result = reviewPriceChanges(
    [...charges("GBP"), ...charges("EUR")],
    [],
    "2026-09-01",
    "2026-10-01",
    "2026-10-08",
  );
  expect(result.map((s) => s.currency)).toEqual(["GBP", "EUR"]);
  expect(
    result.every(
      (s) =>
        s.amount === 1200 &&
        s.previousMedian === 1000 &&
        s.increase === 200 &&
        s.annual === 14400,
    ),
  ).toBe(true);
  expect(
    reviewPriceChanges(
      charges("EUR"),
      [],
      "2026-10-01",
      "2026-11-01",
      "2026-10-08",
    ),
  ).toEqual([]);
});
it("cuts off future history and excludes a dismissed price change", () => {
  expect(reviewDate("2026-10-01", "2026-10-08")).toBe("2026-09-30");
  expect(reviewDate("2026-11-01", "2026-10-08")).toBe("2026-10-08");
  const rows = charges("EUR"),
    [rise] = reviewPriceChanges(
      rows,
      [],
      "2026-09-01",
      "2026-10-01",
      "2026-10-08",
    );
  expect(
    reviewPriceChanges(
      rows,
      [
        {
          key: "subscription:synthetic",
          value: JSON.stringify({
            groupKey: rise.key,
            status: "keep",
            date: "2026-09-06",
            amount: 1200,
          }),
        },
      ],
      "2026-09-01",
      "2026-10-01",
      "2026-10-08",
    ),
  ).toEqual([]);
});
