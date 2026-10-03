import { describe, it, expect } from "vitest";
import { parseMoney, decimalMoney, money, safeSum } from "./money";
import { parseDate, monthOffset, dayDistance } from "./dates";
import {
  normalizeDescription,
  normalizeMerchant,
  fingerprint,
  sha256,
} from "./normalize";
import { reconcile } from "./reconcile";
import {
  cashFlow,
  categorySpending,
  propertyFlow,
  monthlySeries,
  comparisons,
  recurring,
} from "../analytics/calculations";
import { transaction } from "../tests/helpers";
import { defaultCategories } from "../storage/database";
describe("integer money", () => {
  it.each([
    ["£1,285.30", 128530],
    ["-82.45", -8245],
    ["(20.10)", -2010],
    ["15.00 CR", 1500],
    ["15.00 DR", -1500],
    ["+5,000", 500000],
    ["0.01", 1],
    ["82.4", 8240],
  ])("parses %s exactly", (s, expected) =>
    expect(parseMoney(s)).toBe(expected),
  );
  it.each(["1,28.30", "NaN", "1.2345", "12,34", "1e8", "<script>", ""])(
    "rejects unsafe or ambiguous amounts %s",
    (s) => expect(() => parseMoney(s)).toThrow(),
  );
  it("supports explicit currency precision", () => {
    expect(parseMoney("120", "JPY")).toBe(120);
    expect(parseMoney("1.234", "KWD")).toBe(1234);
    expect(() => parseMoney("1.23", "JPY")).toThrow();
    expect(() => parseMoney("1", "XYZ")).toThrow();
  });
  it("formats currency and sums without decimal drift", () => {
    expect(decimalMoney(-8245)).toBe("-82.45");
    expect(money(128530)).toBe("£1,285.30");
    expect(safeSum([10, 20, 30])).toBe(60);
    expect(() => safeSum([Number.MAX_SAFE_INTEGER, 1])).toThrow();
  });
});
describe("dates and normalization", () => {
  it.each([
    ["2026-09-18", "2026-09-18"],
    ["18/09/2026", "2026-09-18"],
    ["18.09.26", "2026-09-18"],
    ["18 Sep 2026", "2026-09-18"],
    ["18 September", "2026-09-18"],
    ["30 Dec", "2025-12-30"],
  ])("parses %s", (raw, expected) =>
    expect(parseDate(raw, "2026-09-30")).toBe(expected),
  );
  it.each(["31 Feb 2026", "2026-13-01", "09/31/2026", "Sep 18, 2026"])(
    "rejects bad dates %s",
    (raw) => expect(() => parseDate(raw)).toThrow(),
  );
  it("handles year changes and day distance", () => {
    expect(monthOffset("2026-01", -1)).toBe("2025-12");
    expect(dayDistance("2026-09-04", "2026-09-07")).toBe(3);
  });
  it("normalizes descriptions and merchants safely", () => {
    expect(normalizeDescription("  Waitrose\n\tFulham\u0000 ")).toBe(
      "WAITROSE FULHAM",
    );
    expect(normalizeMerchant("POS WAITROSE 12345 FULHAM")).toBe(
      "WAITROSE FULHAM",
    );
  });
  it("uses deterministic SHA256", async () => {
    expect(await sha256(new TextEncoder().encode("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
  it("fingerprints distinguish repeated purchase occurrences and balances", async () => {
    const t = transaction();
    expect(await fingerprint(t)).toBe(
      await fingerprint({ ...t, description: "waitrose " }),
    );
    expect(await fingerprint(t)).not.toBe(
      await fingerprint({ ...t, occurrence: 1 }),
    );
    expect(await fingerprint(t)).not.toBe(
      await fingerprint({ ...t, balanceAfterTransaction: 400 }),
    );
  });
});
describe("reconciliation", () => {
  it.each([
    ["perfect", 10000, 9500, [-500], "reconciled", 0],
    ["rounding", 10000, 9501, [-500], "reconciled", 1],
    ["missing", 10000, 9000, [-500], "warning", -500],
    ["OCR number", 10000, 9000, [-100], "warning", -900],
    ["wrong debit sign", 10000, 9000, [1000], "warning", -2000],
    ["duplicated row", 10000, 9000, [-1000, -1000], "warning", 1000],
    ["no opening", undefined, 9000, [-1000], "unavailable", undefined],
    ["no closing", 10000, undefined, [-1000], "unavailable", undefined],
  ] as const)("%s", (_n, opening, closing, amounts, status, difference) => {
    const r = reconcile(opening, closing, [...amounts]);
    expect(r.status).toBe(status);
    expect(r.difference).toBe(difference);
  });
});
describe("financial aggregation", () => {
  const items = [
    transaction({
      id: "salary",
      amount: 500000,
      type: "income",
      categoryId: "salary",
    }),
    transaction({
      id: "rent",
      amount: 210000,
      type: "income",
      categoryId: "property-income",
    }),
    transaction({ id: "food", amount: -8245, categoryId: "groceries" }),
    transaction({
      id: "mortgage",
      amount: -62000,
      categoryId: "property",
      subcategoryId: "property-mortgage-financing",
    }),
    transaction({
      id: "transfer",
      amount: -200000,
      type: "transfer",
      isTransfer: true,
    }),
    transaction({ id: "foreign", amount: -10000, currency: "EUR" }),
  ];
  it("separates currencies and excludes transfers", () =>
    expect(cashFlow(items, "GBP")).toEqual({
      income: 710000,
      expenses: 70245,
      net: 639755,
    }));
  it("computes property independently", () =>
    expect(propertyFlow(items, "GBP")).toEqual({
      income: 210000,
      expenses: 62000,
      net: 148000,
    }));
  it("aggregates categories and percentages", () => {
    const c = categorySpending(items, defaultCategories, "GBP");
    expect(c[0].name).toBe("Property");
    expect(c[0].amount).toBe(62000);
    expect(c.reduce((s, x) => s + x.percent, 0)).toBeCloseTo(100);
  });
  it("buckets months and zero-fills gaps", () => {
    const series = monthlySeries(items, "2026-09", 6, "GBP");
    expect(series).toHaveLength(6);
    expect(series[0].net).toBe(0);
    expect(series[5].net).toBe(639755);
  });
  it("compares with months that contain data", () => {
    const t = [
      transaction({
        date: "2026-08-01",
        categoryId: "shopping",
        amount: -10000,
      }),
      transaction({
        date: "2026-09-01",
        categoryId: "shopping",
        amount: -15000,
      }),
    ];
    const c = comparisons(t, defaultCategories, "2026-09", "GBP");
    expect(c.average).toBe(10000);
    expect(c.difference).toBe(5000);
    expect(c.items[0].change).toBe(50);
    expect(c.text).toContain("£50.00 higher");
    expect(c.sampleMonths).toBe(1);
  });
  it("requires recurrence evidence", () => {
    const r = ["2026-06-01", "2026-07-01", "2026-08-01"].map((date, i) =>
      transaction({ id: String(i), date, merchant: "NETFLIX", amount: -1299 }),
    );
    expect(recurring(r, "GBP")).toHaveLength(1);
    expect(recurring(r.slice(0, 2), "GBP")).toHaveLength(0);
    expect(
      recurring(
        [
          ...r,
          transaction({
            date: "2026-08-05",
            merchant: "NETFLIX",
            amount: -1299,
          }),
        ],
        "GBP",
      ),
    ).toHaveLength(0);
  });
});

it("preserves exact CSV decimals and rejects intermediate overflow", () => {
  expect(decimalMoney(Number.MAX_SAFE_INTEGER, "GBP")).toBe(
    "90071992547409.91",
  );
  expect(() => safeSum([Number.MAX_SAFE_INTEGER, 2, -2])).toThrow();
  expect(money(-0)).toBe("£0.00");
});
it("reports a meaningful category decrease even when current spend is zero", () => {
  const items = [
    transaction({
      date: "2026-08-01",
      amount: -15000,
      categoryId: "transport",
    }),
    transaction({
      date: "2026-09-01",
      amount: -10000,
      categoryId: "groceries",
    }),
  ];
  const c = comparisons(items, defaultCategories, "2026-09", "GBP");
  expect(c.items.find((c) => c.id === "transport")?.difference).toBe(-15000);
  expect(c.text).toContain("Lower Transport spending");
});
it("formats every accepted minor unit exactly, including extremes and tiny signs", () => {
  expect(money(Number.MAX_SAFE_INTEGER)).toBe("£90,071,992,547,409.91");
  expect(money(-1, "GBP", true)).toBe("-£0.01");
  expect(money(1, "GBP", true)).toBe("+£0.01");
  expect(money(1234, "KWD")).toContain("1.234");
});
