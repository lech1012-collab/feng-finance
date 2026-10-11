import { describe, expect, it } from "vitest";
import { monthReviewCalendar } from "./reminders";

describe("monthly-review calendar export", () => {
  const config = { enabled: true, day: 5 };
  it("starts in the next month and repeats without financial details", () => {
    const calendar = monthReviewCalendar(config, "2026-10", "2026-10-08");
    expect(calendar).toContain("DTSTART:20261105T090000");
    expect(calendar).toContain("DTSTAMP:20261008T000000Z");
    expect(calendar).toContain("RRULE:FREQ=MONTHLY");
    expect(calendar).toContain("SUMMARY:Update statements in Feng Finance");
    expect(calendar.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(calendar).not.toMatch(/£|€|GBP|EUR|account|merchant|amount/i);
  });
  it("never exports a reminder in the past when reviewing an older month", () => {
    expect(monthReviewCalendar(config, "2026-08", "2026-10-08")).toContain(
      "DTSTART:20261105T090000",
    );
  });
  it("uses the configured day and rolls across the year boundary", () => {
    expect(
      monthReviewCalendar({ enabled: false, day: 28 }, "2026-12", "2026-12-08"),
    ).toContain("DTSTART:20270128T090000");
  });
});
