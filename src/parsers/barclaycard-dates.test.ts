import { describe, expect, it } from "vitest";
import { rows } from "../tests/helpers";
import { reconstructRows } from "../import/layout";
import { sidebarCardFixture } from "../tests/barclaycard-sidebar";
import { barclaycardIssueDate } from "./barclaycard-dates";
import { BarclaycardStatementParser } from "./barclaycard";

describe("Barclaycard issue-date evidence", () => {
  it.each([
    ["Page 1 of 4 // issued on 04 October 2026", "2026-10-04"],
    ["Statement date: 04/10/2026", "2026-10-04"],
    ["Statement issue date: 2026-10-04", "2026-10-04"],
  ])("reads the explicit label %s", (label, expected) => {
    expect(barclaycardIssueDate(rows([[[30, label]]]))).toBe(expected);
  });
  it("reads a date split onto the next line, ignoring a standalone payment deadline", () => {
    expect(
      barclaycardIssueDate(
        rows([
          [[30, "Please pay by: 27 October 2026"]],
          [[330, "Page 1 of 4 // issued on"]],
          [[330, "04 October 2026"]],
        ]),
      ),
    ).toBe("2026-10-04");
  });
  it("uses the repeated issue footer when the first page footer is unread", () => {
    const fixture = sidebarCardFixture();
    fixture.items = fixture.items.filter(
      (item) => !item.text.startsWith("Statement period:") && item.y !== 815,
    );
    const template = fixture.items[0];
    fixture.items.push({
      ...template,
      page: 2,
      y: 815,
      text: "Page 2 of 4 // issued on 04 October 2026",
    });
    const parsed = new BarclaycardStatementParser().parse(
      reconstructRows(fixture.items),
    );
    expect(parsed).toMatchObject({
      periodStart: "2026-09-02",
      periodEnd: "2026-10-04",
      statementDate: "2026-10-04",
      periodSource: "transaction-coverage",
    });
    expect(parsed.transactions).toHaveLength(23);
  });
  it.each([
    ["Please pay by: 27 October 2026"],
    ["04 October 2026", "Please pay by: 27 October 2026"],
    ["issued on 31 February 2026"],
    ["issued on 04 October 2026", "issued on 05 October 2026"],
  ])("does not guess an issue date from %j", (...labels) => {
    expect(
      barclaycardIssueDate(rows(labels.map((label) => [[30, label]]))),
    ).toBeUndefined();
  });
});
