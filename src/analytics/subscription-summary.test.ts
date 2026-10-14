import { expect, it } from "vitest";
import { recurringReportingTotal } from "./subscription-summary";

it("withholds the whole recurring total if just one currency cannot be converted", () => {
  const charges = [
    { annual: 12000, currency: "GBP" },
    { annual: 24000, currency: "EUR" },
  ];
  expect(recurringReportingTotal(charges, "GBP", "2026-09-30", [])).toEqual({
    value: undefined,
    missingRates: true,
    approximate: true,
    originals: [
      { currency: "GBP", amount: 12000 },
      { currency: "EUR", amount: 24000 },
    ],
  });
  expect(charges[1].annual).toBe(24000);
});
it("sums converted recurring charges in integer money while keeping their originals", () => {
  expect(
    recurringReportingTotal(
      [
        { annual: 12000, currency: "GBP" },
        { annual: 24000, currency: "EUR" },
      ],
      "GBP",
      "2026-09-30",
      [
        {
          id: "test",
          date: "2026-09-30",
          base: "EUR",
          quote: "GBP",
          rate: "0.9",
          source: "manual",
        },
      ],
    ),
  ).toMatchObject({ value: 33600, missingRates: false, approximate: true });
});
it("distinguishes no charges from a known zero annual charge", () => {
  expect(
    recurringReportingTotal([], "USD", "2026-09-30", []).value,
  ).toBeUndefined();
  expect(
    recurringReportingTotal(
      [{ annual: 0, currency: "GBP" }],
      "GBP",
      "2026-09-30",
      [],
    ),
  ).toMatchObject({ value: 0, missingRates: false });
});
