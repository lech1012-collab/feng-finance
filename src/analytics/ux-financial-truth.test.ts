import { expect, it } from "vitest";
import { debtPayoff } from "./planning-v2";
import { excludedReportingFlows } from "./home-summary";
import { money, parseMoney } from "../domain/money";
import { accounts, transaction } from "../tests/helpers";

it("requires actual loan terms instead of inventing a credit-card minimum", () => {
  const mortgage = {
    id: "mortgage",
    name: "Mortgage",
    balanceMinor: 28000000,
    apr: 4.5,
    accountType: "mortgage" as const,
    currency: "GBP",
  };
  const missing = debtPayoff([mortgage], 30000, "avalanche", "2026-10");
  expect(missing.reason).toContain("actual monthly payment");
  expect(missing.points).toEqual([]);
  const known = debtPayoff(
    [{ ...mortgage, minimumMinor: 125912 }],
    30000,
    "avalanche",
    "2026-10",
  );
  expect(known.requiredMinimumMinor).toBe(125912);
  expect(known.reason).toContain("£1,259.12");
  expect(known.reason).not.toContain("minor units");
});

it("uses a supplied loan payment exactly and preserves principal plus interest", () => {
  const result = debtPayoff(
    [
      {
        id: "loan",
        name: "Loan",
        balanceMinor: 100000,
        apr: 12,
        accountType: "loan",
        minimumMinor: 20000,
        currency: "GBP",
      },
    ],
    20000,
    "avalanche",
    "2026-10",
  );
  expect(result.reason).toBeUndefined();
  expect(result.points[0].paidMinor).toBe(20000);
  expect(result.totalPaidMinor - result.totalInterestMinor).toBe(100000);
  expect(result.points.at(-1)?.balanceMinor).toBe(0);
});

it("keeps missing transfer conversions unknown without modifying native records", () => {
  const row = transaction({
    id: "foreign-transfer",
    amount: -10000,
    currency: "EUR",
    date: "2026-09-20",
    type: "transfer",
    isTransfer: true,
    merchant: "To own savings",
  });
  expect(excludedReportingFlows([row], accounts, "2026-09", "GBP", [])).toEqual(
    {
      internal: undefined,
      card: 0,
      count: 1,
      originals: [{ currency: "EUR", internal: 10000, card: 0 }],
    },
  );
  expect(row.amount).toBe(-10000);
  expect(row.currency).toBe("EUR");
});

it("distinguishes a genuinely empty transfer total from an unknown total", () => {
  expect(excludedReportingFlows([], accounts, "2026-09", "USD", [])).toEqual({
    internal: 0,
    card: 0,
    count: 0,
    originals: [],
  });
});

it("formats a true minus sign, puts approximation after the sign and accepts old ASCII input", () => {
  expect(money(-125912, "GBP")).toBe("−£1,259.12");
  expect(money(-5000, "EUR", true, true)).toBe("−≈€50.00");
  expect(parseMoney("−£1,259.12")).toBe(-125912);
  expect(parseMoney("-£1,259.12")).toBe(-125912);
});
