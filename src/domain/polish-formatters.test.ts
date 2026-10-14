import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { compactMoney, decimalMoney, money } from "./money";
import { formatDateRange, formatLocalDateTime, formatUkDate } from "./dates";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-14T12:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("release UI money formatting", () => {
  it.each([
    [-1, "GBP", false, false, "−£0.01"],
    [-123456, "GBP", false, false, "−£1,234.56"],
    [-123456, "EUR", true, true, "−≈€1,234.56"],
    [123456, "GBP", true, true, "+≈£1,234.56"],
    [123456, "EUR", false, true, "≈ €1,234.56"],
    [0, "GBP", true, false, "£0.00"],
    [-1234, "JPY", false, false, "−JP¥1,234"],
  ] as const)(
    "formats %s %s with an unambiguous sign and exact minor units",
    (minor, currency, signed, approximate, expected) => {
      expect(money(minor, currency, signed, approximate)).toBe(expected);
    },
  );

  it("keeps compact calendar labels signed while leaving portable decimals exact", () => {
    expect(compactMoney(-125912, "GBP")).toBe("−£1.3k");
    expect(compactMoney(-85000, "GBP")).toBe("−£850");
    expect(decimalMoney(-125912, "GBP")).toBe("-1259.12");
    expect(money(-1234, "KWD")).toContain("−KWD");
    expect(money(-1234, "KWD")).toContain("1.234");
  });
});

describe("release UI UK date formatting", () => {
  it("uses day before month, the true weekday and three-letter September", () => {
    expect(formatUkDate("2026-09-05", true)).toBe("Sat 5 Sep");
    expect(formatUkDate("2025-09-05", true)).toBe("Fri, 5 Sep 2025");
    expect(formatUkDate("2026-09-05")).toBe("5 Sep");
  });

  it.each([
    ["2026-09-01", "2026-09-30", "1 to 30 Sep 2026"],
    ["2026-08-06", "2026-09-05", "6 Aug to 5 Sep 2026"],
    ["2025-12-15", "2026-01-14", "15 Dec 2025 to 14 Jan 2026"],
    ["2024-02-29", "2024-03-01", "29 Feb to 1 Mar 2024"],
  ])(
    "formats %s to %s without ISO or ambiguous US order",
    (from, to, label) => {
      expect(formatDateRange(from, to)).toBe(label);
    },
  );

  it("reports unavailable dates explicitly rather than leaking invalid values", () => {
    expect(formatUkDate("invalid")).toBe("Date unavailable");
    expect(formatDateRange("invalid", "2026-09-30")).toBe("Dates unavailable");
    expect(formatLocalDateTime("invalid")).toBe("Build date unavailable");
    const build = formatLocalDateTime("2026-09-05T12:34:00Z");
    expect(build).toMatch(/^5 Sep 2026,/);
    expect(build).not.toContain("2026-09-05");
    expect(build).not.toContain("T12:");
  });
});
