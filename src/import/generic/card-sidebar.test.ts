import { describe, expect, it } from "vitest";
import { sidebarCardFixture } from "../../tests/barclaycard-sidebar";
import { parseGenericStatement } from "./engine";
import { fieldCorrections, selectedSourceReading } from "./review-decision";

describe("source correction for a card ledger with an adjacent information panel", () => {
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
