import { describe, it, expect } from "vitest";
import { bankRows } from "../../tests/helpers";
import { groupedBarclaysItems } from "../../tests/barclays-grouped";
import { BarclaysStatementParser } from "../../parsers/barclays";
import { RevolutStatementParser } from "../../parsers/revolut";
import { reconstructRows } from "../../import/layout";
import { parseGenericStatement } from "./engine";
import { compareLegacyTransactions } from "./legacy-comparison";
import type { ExtractedTextItem, SourcePage } from "./types";
import generatedBarclays from "../../tests/synthetic-barclays-pdf-text.json";
const geometry: SourcePage[] = [
  { page: 1, width: 620, height: 850, rotation: 0 },
];
const enhance = (
  items: ReturnType<typeof groupedBarclaysItems>,
): ExtractedTextItem[] =>
  items.map((item) => ({
    ...item,
    fontSize: item.height,
    parseSource: "text",
  }));
describe("legacy adapters remain independently compared", () => {
  it("reconciles the actual two-page synthetic PDF text including its repeated issuer banner and all ten transactions", () => {
    // Captured locally with PDF.js from scripts/fixtures.mjs's fictitious PDF,
    // including merged text-run widths and the real 16pt second-page banner.
    const items = generatedBarclays.items.map((item) => ({
      ...item,
      parseSource: "text" as const,
    }));
    const generic = parseGenericStatement(items, generatedBarclays.pages);
    const old = new BarclaysStatementParser().parse(
      reconstructRows(
        items.map((item) => ({ ...item, y: item.y + item.height })),
      ),
    );
    expect(generic.rowChecks).toHaveLength(10);
    expect(generic.parsed?.transactions).toHaveLength(10);
    expect(generic.checks).toMatchObject({
      reconciledExactly: true,
      calculatedMoneyIn: 712000,
      calculatedMoneyOut: 431765,
      balanceRowsPassed: 10,
      needsReviewRows: 0,
    });
    expect(generic.parsed?.closingBalance).toBe(380235);
    expect(
      compareLegacyTransactions(generic, "barclays-current", old.transactions)
        .legacyStatus,
    ).toBe("matched");
    expect(
      generic.table.columns.filter(
        (column) =>
          column.id.startsWith("p2-") && column.inferredRole === "date",
      ),
    ).toHaveLength(1);
  });
  for (const [bank, profileId, parser] of [
    ["Barclays", "barclays-current", new BarclaysStatementParser()],
    ["Revolut", "revolut", new RevolutStatementParser()],
  ] as const)
    it(`matches the ${bank} adapter's occurrence-preserving digital readings`, () => {
      const rows = bankRows(bank);
      const generic = parseGenericStatement(
        enhance(rows.flatMap((row) => row.items)),
        geometry,
      );
      expect(generic.checks.reconciledExactly).toBe(true);
      expect(
        compareLegacyTransactions(
          generic,
          profileId,
          parser.parse(rows).transactions,
        ).legacyStatus,
      ).toBe("matched");
    });
  it("keeps wrapped, blank-date grouped Barclays rows and labels missing individual anchors as checked against statement totals", () => {
    const items = groupedBarclaysItems();
    const old = new BarclaysStatementParser().parse(reconstructRows(items));
    const generic = parseGenericStatement(enhance(items), [
      ...geometry,
      { ...geometry[0], page: 2 },
    ]);
    expect(
      generic.parsed?.transactions.map((row) => [row.date, row.amount]),
    ).toEqual(old.transactions.map((row) => [row.date, row.amount]));
    expect(generic.parsed?.transactions[4].description).toBe(
      "DIRECT DEBIT TO EXAMPLE WATER COMPANY",
    );
    expect(generic.rowChecks).toHaveLength(6);
    expect(generic.checks.reconciliation.difference).toBe(0);
    expect(generic.checks.reconciledExactly).toBe(true);
    expect(generic.rowChecks.some((row) => row.checkLevel === "total")).toBe(
      true,
    );
  });
});
