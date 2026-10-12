import { describe, expect, it } from "vitest";
import { layoutItems } from "../../tests/statement-layouts";
import source from "../../tests/synthetic-revolut-uk-pdf-text.json";
import { parseGenericStatement } from "./engine";
import type {
  ExtractedTextItem,
  GenericParseOptions,
  SourcePage,
} from "./types";

const pages: SourcePage[] = [1, 2, 3].map((page) => ({
  page,
  width: 600,
  height: 850,
  rotation: 0,
}));
const options: GenericParseOptions = {
  period: { start: "2026-09-01", end: "2026-09-30" },
  account: {
    accountType: "current",
    currency: "GBP",
    maskedAccountIdentifier: "•••• 5678",
  },
  evidence: {
    openingBalance: 50000,
    closingBalance: 94000,
    printedMoneyIn: 95000,
    printedMoneyOut: 51000,
  },
};
function revolutItems(): ExtractedTextItem[] {
  return layoutItems("revolut").map((item) => ({
    ...item,
    fontSize: item.height,
    parseSource: "text",
  }));
}
function cell(x: number, text: string): ExtractedTextItem {
  return {
    page: 3,
    y: 210,
    x,
    text,
    width: text.length * 4.4,
    height: 10,
    fontSize: 10,
    parseSource: "text",
    confidence: 1,
  };
}

describe("repeated statement metadata above continuation-page headers", () => {
  it("reconciles all six rows in actual PDF.js text from the fictitious UK layout", () => {
    const items: ExtractedTextItem[] = source.items.map((item) => ({
      ...item,
      parseSource: "text",
    }));
    const result = parseGenericStatement(items, source.pages, options);
    expect(
      result.table.rows.filter((row) => row.kind === "transaction"),
    ).toHaveLength(6);
    expect(result.rowChecks).toHaveLength(6);
    expect(result.parsed?.transactions).toHaveLength(6);
    expect(result.checks).toMatchObject({
      reconciledExactly: true,
      calculatedMoneyIn: 95000,
      calculatedMoneyOut: 51000,
      needsReviewRows: 0,
    });
    expect(result.parsed?.closingBalance).toBe(94000);
  });

  it("excludes the repeated GBP statement title from the six financial source rows", () => {
    const result = parseGenericStatement(revolutItems(), pages, options);
    expect(
      result.table.rows.filter((row) => row.kind === "transaction"),
    ).toHaveLength(6);
    expect(result.rowChecks).toHaveLength(6);
    expect(result.parsed?.transactions).toHaveLength(6);
    expect(result.checks).toMatchObject({
      reconciledExactly: true,
      calculatedMoneyIn: 95000,
      calculatedMoneyOut: 51000,
      needsReviewRows: 0,
    });
    expect(result.parsed?.closingBalance).toBe(94000);
    expect(
      result.rowChecks.some((check) =>
        check.readings.some((reading) =>
          reading.description.includes("GBP STATEMENT"),
        ),
      ),
    ).toBe(false);
  });

  it("retains the same title in a malformed source row below the transaction header", () => {
    const result = parseGenericStatement(
      [
        ...revolutItems(),
        cell(43, "GBP Statement"),
        cell(125, "UNREADABLE PURCHASE"),
        cell(335, "£2O.OO"),
        cell(519, "£920.00"),
      ],
      pages,
      options,
    );
    expect(result.rowChecks).toHaveLength(7);
    const row = result.table.rows.find((row) =>
      row.cells.some((cell) => cell.text === "GBP Statement"),
    );
    expect(row?.kind).toBe("transaction");
    const check = result.rowChecks.find((check) => check.rowId === row?.id);
    expect(check?.issues).toContain("invalid-date");
    expect(check?.issues).toContain("invalid-amount");
    expect(result.checks.reconciledExactly).toBe(false);
  });

  it("keeps a valid purchase whose merchant is GBP Statement", () => {
    const result = parseGenericStatement(
      [
        ...revolutItems(),
        cell(43, "29 Sept 2026"),
        cell(125, "GBP Statement"),
        cell(335, "£20.00"),
        cell(519, "£920.00"),
      ],
      pages,
      {
        ...options,
        evidence: {
          ...options.evidence,
          closingBalance: 92000,
          printedMoneyOut: 53000,
        },
      },
    );
    expect(result.rowChecks).toHaveLength(7);
    expect(result.parsed?.transactions).toContainEqual(
      expect.objectContaining({
        date: "2026-09-29",
        description: "GBP STATEMENT",
        amount: -2000,
      }),
    );
    expect(result.checks).toMatchObject({
      reconciledExactly: true,
      calculatedMoneyIn: 95000,
      calculatedMoneyOut: 53000,
    });
  });
});
