import { describe, it, expect } from "vitest";
import { reportingPeriod, periodMonth } from "./period";
import { transaction } from "../tests/helpers";
describe("reporting periods", () => {
  it("keeps calendar months as the default", () =>
    expect(reportingPeriod("2026-10")).toEqual(["2026-10-01", "2026-11-01"]));
  it("assigns 26 September to October when the month starts on the 25th", () => {
    const settings = [
      {
        key: "period:start",
        value: JSON.stringify({ mode: "fixed", day: 25 }),
      },
    ];
    expect(reportingPeriod("2026-10", settings)).toEqual([
      "2026-09-25",
      "2026-10-25",
    ]);
    expect(periodMonth("2026-09-26", settings)).toBe("2026-10");
    expect(periodMonth("2026-09-24", settings)).toBe("2026-09");
  });
  it("uses salary dates and falls back to the last weekday", () => {
    const settings = [
      { key: "period:start", value: '{"mode":"payday","day":25}' },
    ];
    expect(
      reportingPeriod("2026-10", settings, [
        transaction({
          date: "2026-09-25",
          amount: 500000,
          categoryId: "salary",
        }),
      ]),
    ).toEqual(["2026-09-25", "2026-10-30"]);
  });
});
