import { describe, expect, it } from "vitest";
import source from "../../tests/synthetic-barclaycard-pdf-text.json";
import { reconstructCardRegions } from "./card-regions";
import { genericFixture } from "./fixtures";
import { parseGenericStatement } from "./engine";
import type {
  ExtractedTextItem,
  ReconstructedTable,
  SourcePage,
} from "./types";

const items: ExtractedTextItem[] = source.items.map((item) => ({
  ...item,
  parseSource: "text",
}));
const pages: SourcePage[] = source.pages;
function reading(table: ReconstructedTable, id: string) {
  const row = table.rows.find((row) => row.id === id)!;
  const role = (name: string) =>
    row.cells
      .filter(
        (cell) =>
          table.columns.find((column) => column.id === cell.columnId)
            ?.inferredRole === name,
      )
      .map((cell) => cell.text)
      .join(" ");
  return {
    date: role("date"),
    description: role("description"),
    amount: role("amount"),
  };
}

describe("Barclaycard reading-panel reconstruction", () => {
  it("separates real PDF.js combined date/merchant runs into six source rows", () => {
    const table = reconstructCardRegions(items, pages)!;
    const rows = table.rows.filter((row) => row.kind === "transaction");
    expect(rows).toHaveLength(6);
    expect(rows.map((row) => reading(table, row.id))).toEqual([
      {
        date: "28 Sep",
        description: "Direct Debit - Payment",
        amount: "£900.00",
      },
      { date: "02 Sep", description: "WAITROSE", amount: "£80.00" },
      { date: "05 Sep", description: "FICTIONAL CAFE", amount: "£12.34" },
      { date: "05 Sep", description: "FICTIONAL CAFE", amount: "£12.34" },
      { date: "08 Sep", description: "MERCHANT REFUND", amount: "£5.00 CR" },
      { date: "10 Sep", description: "TRAVEL SHOP", amount: "£10.00" },
    ]);
    expect(rows[0].section).toContain("Payments towards your account");
    expect(rows[1].section).toContain("How you've used your card");
    const foreign = table.rows.find((row) =>
      row.cells.some((cell) => cell.text.includes("20 Euro")),
    )!;
    expect(foreign.kind).toBe("continuation");
    expect(foreign.continuesRowId).toBe(rows[5].id);
    expect(
      table.rows.some(
        (row) =>
          row.kind === "transaction" &&
          row.cells.some((cell) => cell.text.includes("Your new balance")),
      ),
    ).toBe(false);
  });

  it("retains original page/cell coordinates and assigns unique IDs to both panels", () => {
    const table = reconstructCardRegions(items, pages)!;
    expect(table.pages).toEqual(pages);
    expect(new Set(table.columns.map((column) => column.id)).size).toBe(
      table.columns.length,
    );
    expect(new Set(table.rows.map((row) => row.id)).size).toBe(
      table.rows.length,
    );
    const waitrose = table.rows.find(
      (row) => reading(table, row.id).description === "WAITROSE",
    )!;
    const amount = waitrose.cells.find((cell) => cell.text === "£80.00")!;
    expect(amount.rect).toMatchObject({
      page: 2,
      x: 260,
      y: 185,
      height: 10,
    });
    expect(amount.rect.width).toBeCloseTo(30.58, 10);
    expect(waitrose.rect).toMatchObject({
      page: 2,
      x: 52,
      y: 185,
      height: 10,
    });
    expect(waitrose.rect.width).toBeCloseTo(238.58, 10);
    const marker = waitrose.cells.find((cell) => cell.text === "e")!;
    expect(
      table.columns.find((column) => column.id === marker.columnId)
        ?.inferredRole,
    ).toBe("ignore");
    expect(
      table.columns.every((column) => column.x0 >= 0 && column.x1 <= 600),
    ).toBe(true);
  });

  it("keeps corrupt monetary text and invalid dated rows for review", () => {
    const corrupted = items.map((item) =>
      item.text === "£80.00"
        ? { ...item, text: "£8O.OO" }
        : item.text === "05 Sep FICTIONAL CAFE" && item.y === 199
          ? { ...item, text: "31 Sep FICTIONAL CAFE" }
          : item,
    );
    const table = reconstructCardRegions(corrupted, pages)!;
    const rows = table.rows.filter((row) => row.kind === "transaction");
    expect(rows).toHaveLength(6);
    expect(rows.map((row) => reading(table, row.id))).toContainEqual({
      date: "02 Sep",
      description: "WAITROSE",
      amount: "£8O.OO",
    });
    expect(rows.map((row) => reading(table, row.id))).toContainEqual({
      date: "31 Sep",
      description: "FICTIONAL CAFE",
      amount: "£12.34",
    });
    const unreadablePayment = parseGenericStatement(
      items.map((item) =>
        item.page === 2 && item.y === 126 && item.text === "£900.00"
          ? { ...item, text: "£9OO.OO" }
          : item,
      ),
      pages,
      {
        period: { start: "2026-09-02", end: "2026-10-04" },
        account: {
          accountType: "credit",
          currency: "GBP",
          maskedAccountIdentifier: "•••• 4444",
        },
        evidence: { openingBalance: -90000, closingBalance: -10968 },
      },
    );
    const paymentCheck = unreadablePayment.rowChecks.find(
      (check) => check.readings[0].description === "DIRECT DEBIT - PAYMENT",
    )!;
    expect(paymentCheck.issues).toContain("invalid-amount");
    expect(paymentCheck.amountRects).toHaveLength(1);
    expect(paymentCheck.amountRects[0]).toMatchObject({
      page: 2,
      x: 250,
      y: 126,
    });
  });

  it("retains a further blank-date purchase and a split amount line", () => {
    const added: ExtractedTextItem[] = [
      {
        ...items[0],
        page: 2,
        x: 85,
        y: 227,
        text: "ANOTHER PURCHASE",
        width: 90,
      },
      { ...items[0], page: 2, x: 260, y: 241, text: "£1.00", width: 26 },
    ];
    const table = reconstructCardRegions([...items, ...added], pages)!;
    const rows = table.rows.filter((row) => row.kind === "transaction");
    expect(rows).toHaveLength(7);
    const addedRow = rows.find(
      (row) => reading(table, row.id).description === "ANOTHER PURCHASE",
    )!;
    expect(
      table.rows
        .find((row) => row.continuesRowId === addedRow.id)
        ?.cells.some((cell) => cell.text === "£1.00"),
    ).toBe(true);
  });

  it("declines ordinary single-table layouts and ambiguous third date anchors", () => {
    const single = genericFixture("T3");
    expect(reconstructCardRegions(single.items, single.pages)).toBeUndefined();
    const withPostingDates = single.items.flatMap((item) =>
      item.x === 30 && [215, 245].includes(item.y)
        ? [item, { ...item, x: 70 }]
        : [item],
    );
    expect(
      reconstructCardRegions(withPostingDates, single.pages),
    ).toBeUndefined();
    expect(
      reconstructCardRegions(
        [...items, { ...items[0], page: 2, x: 180, y: 300, text: "12 Sep" }],
        pages,
      ),
    ).toBeUndefined();
  });

  it("normalizes the whole generated PDF with exact gross totals and card debt signs", () => {
    const result = parseGenericStatement(items, pages, {
      period: { start: "2026-09-02", end: "2026-10-04" },
      account: {
        accountType: "credit",
        currency: "GBP",
        maskedAccountIdentifier: "•••• 4444",
      },
      evidence: { openingBalance: -90000, closingBalance: -10968 },
    });
    expect(result.parsed?.transactions).toHaveLength(6);
    expect(
      result.parsed?.transactions
        .map((transaction) => transaction.amount)
        .sort((a, b) => a - b),
    ).toEqual([-8000, -1234, -1234, -1000, 500, 90000]);
    expect(result.checks.calculatedMoneyIn).toBe(90500);
    expect(result.checks.calculatedMoneyOut).toBe(11468);
    expect(result.checks.reconciledExactly).toBe(true);
    expect(result.checks.needsReviewRows).toBe(0);
    expect(
      result.parsed?.transactions.find((transaction) =>
        transaction.description.startsWith("TRAVEL SHOP"),
      )?.description,
    ).toContain("20 EURO AT EXCHANGE RATE 2.00");
  });

  it("retains every transaction when all left-panel amounts are unreadable or absent", () => {
    const unreadable = items.map((item) =>
      item.page === 2 &&
      [126, 185, 199, 213].includes(item.y) &&
      item.text.startsWith("£")
        ? { ...item, text: "£?.??" }
        : item,
    );
    const options = {
      period: { start: "2026-09-02", end: "2026-10-04" },
      account: {
        accountType: "credit" as const,
        currency: "GBP",
        maskedAccountIdentifier: "•••• 4444",
      },
      evidence: { openingBalance: -90000, closingBalance: -10968 },
    };
    const result = parseGenericStatement(unreadable, pages, options);
    expect(result.rowChecks).toHaveLength(6);
    expect(
      result.rowChecks.filter((row) => row.issues.includes("invalid-amount")),
    ).toHaveLength(4);
    expect(result.checks.reconciledExactly).toBe(false);
    const absent = unreadable.filter((item) => item.text !== "£?.??");
    const withoutAmounts = parseGenericStatement(absent, pages, options);
    expect(withoutAmounts.rowChecks).toHaveLength(6);
    expect(
      withoutAmounts.rowChecks.filter((row) =>
        row.issues.includes("invalid-amount"),
      ),
    ).toHaveLength(4);
  });
});
