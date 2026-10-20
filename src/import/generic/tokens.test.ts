import { describe, expect, it } from "vitest";
import { readDate } from "./tokens";

describe("yearless source date inference", () => {
  it("resolves a June purchase in a June/July statement", () => {
    expect(readDate("13 Jun", { start: "2026-06-01", end: "2026-07-02" })).toBe(
      "2026-06-13",
    );
  });
  it("resolves both sides of a year-crossing statement", () => {
    const period = { start: "2025-12-20", end: "2026-01-19" };
    expect(readDate("28 Dec", period)).toBe("2025-12-28");
    expect(readDate("Jan 5", period)).toBe("2026-01-05");
  });
  it("does not guess between two calendar occurrences", () => {
    expect(
      readDate("13 Jun", { start: "2025-01-01", end: "2026-12-31" }),
    ).toBeUndefined();
  });
  it("keeps malformed partial years unread", () => {
    expect(
      readDate("13/06/6", { start: "2026-06-01", end: "2026-07-02" }),
    ).toBeUndefined();
  });
});
