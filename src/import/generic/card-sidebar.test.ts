import { describe, expect, it } from "vitest";
import { sidebarCardFixture } from "../../tests/barclaycard-sidebar";
import { parseGenericStatement } from "./engine";
import { fieldCorrections, selectedSourceReading } from "./review-decision";

describe("source correction for a card ledger with an adjacent information panel", () => {
  it("reads coverage from the issue date and dated ledger when no period is printed", () => {
    const fixture = sidebarCardFixture();
    fixture.items = fixture.items.filter(
      (item) => !item.text.startsWith("Statement period:"),
    );
    const result = parseGenericStatement(fixture.items, fixture.pages);
    expect(result.errorCode).toBeUndefined();
    expect(result.parsed).toMatchObject({
      periodStart: "2026-09-02",
      periodEnd: "2026-10-04",
      statementDate: "2026-10-04",
      periodSource: "transaction-coverage",
    });
    expect(result.parsed?.transactions).toHaveLength(23);
    expect(result.checks.reconciledExactly).toBe(true);
    expect(fieldCorrections(result.rowChecks)).toHaveLength(0);
    expect(result.parsed?.warnings).toEqual([
      expect.stringContaining("no period start"),
    ]);
  });

  it("keeps printed periods ahead of issue-date coverage", () => {
    const fixture = sidebarCardFixture();
    const result = parseGenericStatement(fixture.items, fixture.pages);
    expect(result.parsed).toMatchObject({
      periodStart: "2026-09-01",
      periodEnd: "2026-09-30",
      periodSource: "printed",
    });
  });

  it("updates derived coverage from a corrected date without changing a printed date range", () => {
    const fixture = sidebarCardFixture();
    fixture.items = fixture.items.filter(
      (item) => !item.text.startsWith("Statement period:"),
    );
    const initial = parseGenericStatement(fixture.items, fixture.pages);
    const row = initial.rowChecks.find(
      (row) =>
        selectedSourceReading(row)?.description === "FICTIONAL PURCHASE 1",
    )!;
    const result = parseGenericStatement(fixture.items, fixture.pages, {
      actions: {
        [row.rowId]: {
          kind: "correct",
          date: "2026-09-01",
          description: "FICTIONAL PURCHASE 1",
          amount: -350,
        },
      },
    });
    expect(result.parsed?.periodStart).toBe("2026-09-01");
    expect(result.parsed?.periodSource).toBe("transaction-coverage");
    expect(result.checks.reconciledExactly).toBe(true);
    expect(fieldCorrections(result.rowChecks)).toHaveLength(0);
  });

  it.each([
    "due-date-only",
    "conflicting-issue-dates",
    "conflicting-periods",
    "unread-period",
  ])(
    "requires date review for %s rather than inventing a period",
    (scenario) => {
      const fixture = sidebarCardFixture();
      fixture.items = fixture.items.filter(
        (item) =>
          !item.text.startsWith("Statement period:") &&
          !(scenario === "due-date-only" && item.text.includes("issued on")),
      );
      const template = fixture.items[0];
      const labels =
        scenario === "conflicting-issue-dates"
          ? ["Statement date: 05 October 2026"]
          : scenario === "conflicting-periods"
            ? [
                "Statement period: 01 Aug 2026 to 31 Aug 2026",
                "Statement period: 01 Sep 2026 to 30 Sep 2026",
              ]
            : scenario === "unread-period"
              ? ["Statement period: 31 February 2026 to 30 September 2026"]
              : [];
      fixture.items.push(
        ...labels.map((text, i) => ({ ...template, y: 20 + i * 15, text })),
      );
      const result = parseGenericStatement(fixture.items, fixture.pages);
      expect(result.errorCode).toBe("missing-period");
      expect(result.parsed).toBeUndefined();
    },
  );

  it("does not apply Barclaycard coverage inference to an unknown bank", () => {
    const fixture = sidebarCardFixture();
    fixture.items = fixture.items.filter(
      (item) =>
        !item.text.startsWith("Statement period:") &&
        !item.text.includes("barclaycard"),
    );
    const result = parseGenericStatement(fixture.items, fixture.pages);
    expect(result.errorCode).toBe("missing-period");
    expect(result.profileId).toBeUndefined();
  });

  it("resolves yearless December dates against a January issue date", () => {
    const fixture = sidebarCardFixture();
    fixture.items = fixture.items
      .filter((item) => !item.text.startsWith("Statement period:"))
      .map((item) => ({
        ...item,
        text: item.text
          .replaceAll(" Sep", " Dec")
          .replaceAll("October 2026", "January 2027"),
      }));
    const result = parseGenericStatement(fixture.items, fixture.pages);
    expect(result.parsed).toMatchObject({
      periodStart: "2026-12-02",
      periodEnd: "2027-01-04",
      periodSource: "transaction-coverage",
    });
    expect(
      result.parsed?.transactions.every((t) => t.date.startsWith("2026-12")),
    ).toBe(true);
    expect(result.checks.reconciledExactly).toBe(true);
  });

  it("builds 23 source rows, excluding information panels and subsequent help pages", () => {
    const fixture = sidebarCardFixture();
    const result = parseGenericStatement(fixture.items, fixture.pages);
    expect(result.rowChecks).toHaveLength(23);
    expect(result.parsed?.transactions).toHaveLength(23);
    expect(result.checks.calculatedMoneyIn).toBe(31500);
    expect(result.checks.calculatedMoneyOut).toBe(fixture.purchases);
    expect(result.checks.reconciledExactly).toBe(true);
    expect(fieldCorrections(result.rowChecks)).toHaveLength(0);
  });
  it("asks for only the unread purchase and rechecks the full total after correction", () => {
    const fixture = sidebarCardFixture(true);
    const result = parseGenericStatement(fixture.items, fixture.pages);
    expect(result.rowChecks).toHaveLength(23);
    const corrections = fieldCorrections(result.rowChecks);
    expect(corrections).toHaveLength(1);
    const row = corrections[0];
    expect(selectedSourceReading(row)?.description).toBe(
      "FICTIONAL BEAUTY SHOP",
    );
    expect(row.issues).toContain("invalid-amount");
    expect(row.amountRects[0]).toMatchObject({ page: 2, y: 282 });
    expect(result.checks.reconciledExactly).toBe(false);
    const corrected = parseGenericStatement(fixture.items, fixture.pages, {
      actions: {
        [row.rowId]: {
          kind: "correct",
          date: "2026-09-06",
          description: "FICTIONAL BEAUTY SHOP",
          amount: -2300,
        },
      },
    });
    expect(fieldCorrections(corrected.rowChecks)).toHaveLength(0);
    expect(corrected.checks.reconciledExactly).toBe(true);
    expect(corrected.parsed?.transactions).toHaveLength(23);
  });
  it("keeps standalone full-year dates intact instead of treating the year as money", () => {
    const fixture = sidebarCardFixture();
    for (const item of fixture.items)
      if (item.page === 2 && item.text === "28 Sep") item.text = "28 Sep 2026";
    const result = parseGenericStatement(fixture.items, fixture.pages);
    expect(result.rowChecks).toHaveLength(23);
    expect(fieldCorrections(result.rowChecks)).toHaveLength(0);
    expect(
      result.parsed?.transactions.find((t) => t.amount === 31500)?.date,
    ).toBe("2026-09-28");
    expect(result.checks.reconciledExactly).toBe(true);
  });
});
