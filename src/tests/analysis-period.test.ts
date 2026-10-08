import { describe, expect, it } from "vitest";
import { analysisPeriod, monthsInRange } from "../analytics/analysis-period";

describe("shared analysis date scope", () => {
  it.each([1, 3, 6, 12])(
    "drives exactly %i monthly chart points and an equal previous period",
    (count) => {
      const scope = analysisPeriod("2026-09", String(count), "", "");
      expect(scope.months).toHaveLength(count);
      expect(scope.months.at(-1)).toBe("2026-09");
      expect(scope.end).toBe("2026-10-01");
      expect(
        monthsInRange(scope.previousStart, scope.previousEnd),
      ).toHaveLength(count);
      expect(scope.previousEnd).toBe(scope.start);
    },
  );
  it("keeps year-to-date and calendar-year totals aligned with their charts", () => {
    const ytd = analysisPeriod("2026-09", "ytd", "", "");
    expect(ytd.start).toBe("2026-01-01");
    expect(ytd.end).toBe("2026-10-01");
    expect(ytd.months).toHaveLength(9);
    const annual = analysisPeriod("2026-09", "annual", "", "");
    expect(annual.end).toBe("2027-01-01");
    expect(annual.months).toHaveLength(12);
  });
  it("includes a custom final day and only the months touched by that range", () => {
    const scope = analysisPeriod(
      "2026-09",
      "custom",
      "2026-07-18",
      "2026-09-05",
    );
    expect(scope.end).toBe("2026-09-06");
    expect(scope.months).toEqual(["2026-07", "2026-08", "2026-09"]);
    expect(Date.parse(scope.end) - Date.parse(scope.start)).toBe(
      Date.parse(scope.previousEnd) - Date.parse(scope.previousStart),
    );
  });
  it("does not add an extra month at an exclusive month boundary", () => {
    expect(monthsInRange("2026-08-01", "2026-09-01")).toEqual(["2026-08"]);
  });
  it("rejects empty and reversed ranges without inventing points", () => {
    expect(analysisPeriod("2026-09", "custom", "", "").valid).toBe(false);
    expect(
      analysisPeriod("2026-09", "custom", "2026-10-01", "2026-09-01").valid,
    ).toBe(false);
  });
});
