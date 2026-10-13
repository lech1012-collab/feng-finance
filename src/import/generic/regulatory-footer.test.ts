import { describe, expect, it } from "vitest";
import { parseGenericStatement } from "./engine";
import { genericFixture } from "./fixtures";
import type { ExtractedTextItem } from "./types";

const disclosure =
  "and the Prudential Regulation Authority (Financial Services Register No. 999111). Page 1";

function item(x: number, y: number, text: string): ExtractedTextItem {
  return {
    page: 1,
    x,
    y,
    text,
    width: text.length * 3.2,
    height: 7,
    fontSize: 7,
    parseSource: "text",
    confidence: 1,
  };
}

function footerStart(y = 738): ExtractedTextItem {
  return item(
    30,
    y,
    "Barclays Bank UK PLC. Authorised by the Prudential Regulation Authority.",
  );
}

describe("wrapped regulatory disclosures at a financial table boundary", () => {
  for (const splitPageNumber of [false, true])
    it(`keeps the disclosure out of financial rows when its page marker is ${splitPageNumber ? "a separate PDF text item" : "part of one PDF text item"}`, () => {
      const fixture = genericFixture("T5GBP");
      fixture.items.push(footerStart());
      if (splitPageNumber)
        fixture.items.push(
          item(30, 748, disclosure.replace(/ Page 1$/, "")),
          item(560, 748, "Page 1"),
        );
      else fixture.items.push(item(30, 748, disclosure));

      const result = parseGenericStatement(fixture.items, fixture.pages);
      expect(result.rowChecks).toHaveLength(3);
      expect(result.parsed?.transactions).toHaveLength(3);
      expect(result.checks).toMatchObject({
        reconciledExactly: true,
        needsReviewRows: 0,
        calculatedMoneyIn: 20000,
        calculatedMoneyOut: 12550,
      });
      expect(result.table.rows.find((row) => row.rect.y === 748)?.kind).toBe(
        "footer",
      );
    });

  it("keeps the same words inside the financial table as source evidence", () => {
    const fixture = genericFixture("T5GBP");
    fixture.items.push(footerStart(288), item(30, 298, disclosure));
    const result = parseGenericStatement(fixture.items, fixture.pages);
    expect(result.rowChecks).toHaveLength(4);
    expect(result.checks.reconciledExactly).toBe(false);
    expect(result.table.rows.find((row) => row.rect.y === 298)?.kind).toBe(
      "transaction",
    );
  });

  it("requires an established footer boundary before interpreting the text as a disclosure", () => {
    const fixture = genericFixture("T5GBP");
    fixture.items.push(item(30, 748, disclosure));
    const result = parseGenericStatement(fixture.items, fixture.pages);
    expect(result.rowChecks).toHaveLength(4);
    expect(result.checks.reconciledExactly).toBe(false);
    expect(result.table.rows.find((row) => row.rect.y === 748)?.kind).toBe(
      "transaction",
    );
  });

  it("retains an unreadable amount beside a purported regulatory disclosure", () => {
    const fixture = genericFixture("T5GBP");
    fixture.items.push(
      footerStart(),
      item(30, 748, disclosure),
      item(320, 748, "£2O.OO"),
    );
    const result = parseGenericStatement(fixture.items, fixture.pages);
    expect(result.rowChecks).toHaveLength(4);
    expect(result.rowChecks.at(-1)?.issues).toContain("invalid-amount");
    expect(result.checks.reconciledExactly).toBe(false);
  });

  it("keeps a real purchase whose merchant uses the same regulatory wording", () => {
    const fixture = genericFixture("T5GBP");
    fixture.items.push(
      footerStart(),
      item(30, 748, "4 Sep 2026"),
      item(110, 748, disclosure),
      item(320, 748, "25.00"),
      item(500, 748, "1,049.50"),
    );
    const result = parseGenericStatement(fixture.items, fixture.pages, {
      evidence: {
        openingBalance: 100000,
        closingBalance: 104950,
        printedMoneyIn: 20000,
        printedMoneyOut: 15050,
      },
    });
    expect(result.rowChecks).toHaveLength(4);
    expect(result.parsed?.transactions).toContainEqual(
      expect.objectContaining({ date: "2026-09-04", amount: -2500 }),
    );
    expect(result.checks.reconciledExactly).toBe(true);
  });
});
