import { describe, it, expect } from "vitest";
import { rows } from "../tests/helpers";
import { BarclaycardStatementParser } from "./barclaycard";
import { getParser } from ".";
import { detectBank } from "../import/detection";

export function cardRows() {
  const header = rows([
    [[48, "Your Platinum Visa statement"]],
    [[48, "Number 4111 1111 1111 4444"]],
    [[330, "barclaycard.co.uk/login"]],
    [
      [48, "Your previous balance:"],
      [240, "£900.00"],
    ],
    [
      [48, "Payments towards your account:"],
      [240, "£900.00"],
    ],
    [
      [48, "Your new balance:"],
      [240, "£109.68"],
    ],
    [[450, "Page 1 of 2 // issued on 04 October 2026"]],
  ]);
  const table = rows([
    [
      [48, "Your transactions"],
      [330, "08 Sep"],
      [365, "MERCHANT REFUND"],
      [540, "£5.00 CR"],
    ],
    [
      [48, "Your previous balance"],
      [240, "£900.00"],
      [330, "10 Sep"],
      [365, "TRAVEL SHOP"],
      [540, "£10.00"],
    ],
    [[365, "20 Euro at exchange rate 2.00"]],
    [
      [48, "Payments towards your account"],
      [240, "£900.00"],
    ],
    [
      [52, "28 Sep"],
      [85, "Direct Debit - Payment"],
      [250, "£900.00"],
    ],
    [
      [48, "Transactions, interest and charges"],
      [240, "£109.68"],
    ],
    [
      [48, "How you've used your card"],
      [240, "£109.68"],
    ],
    [
      [52, "02 Sep"],
      [85, "WAITROSE"],
      [244, "e"],
      [260, "£80.00"],
    ],
    [
      [52, "05 Sep"],
      [85, "FICTIONAL CAFE"],
      [260, "£12.34"],
    ],
    [
      [52, "05 Sep"],
      [85, "FICTIONAL CAFE"],
      [260, "£12.34"],
    ],
  ]).map((r) => ({
    ...r,
    page: 2,
    items: r.items.map((i) => ({ ...i, page: 2 })),
  }));
  return [...header, ...table];
}

describe("Barclaycard two-column adapter", () => {
  const parser = new BarclaycardStatementParser();
  it("detects the provider and selects the credit-card layout", () => {
    const input = cardRows();
    expect(detectBank(input)).toMatchObject({
      institution: "Barclays",
      confidence: 1,
    });
    expect(getParser("Barclays", input)).toBeInstanceOf(
      BarclaycardStatementParser,
    );
    expect(parser.identifyAccount(input)).toEqual({
      identifier: "•••• 4444",
      accountType: "credit",
    });
  });
  it("extracts both columns, payments, refunds and repeated purchases without mixing descriptions", () => {
    const parsed = parser.parse(cardRows());
    expect(parsed.transactions).toHaveLength(6);
    expect(parsed.transactions.map((t) => t.amount)).toEqual([
      -8000, -1234, -1234, 500, -1000, 90000,
    ]);
    expect(
      parsed.transactions.find((t) => t.type === "transfer")?.description,
    ).toBe("DIRECT DEBIT - PAYMENT");
    expect(
      parsed.transactions.find((t) => t.description.includes("WAITROSE"))
        ?.description,
    ).toBe("WAITROSE");
    const travel = parsed.transactions.find(
      (t) => t.merchant === "TRAVEL SHOP",
    );
    expect(travel?.description).toContain("20 EURO");
    expect(travel?.amount).toBe(-1000);
    expect(parser.validate(parsed)).toMatchObject({
      status: "reconciled",
      difference: 0,
    });
    expect(parsed.openingBalance).toBe(-90000);
    expect(parsed.closingBalance).toBe(-10968);
  });
  it("accepts dates and merchants combined in one PDF text item", () => {
    const input = cardRows();
    for (const row of input.filter((r) => r.page === 2)) {
      for (const dateItem of row.items.filter((i) =>
        /^\d{2} Sep$/.test(i.text),
      )) {
        const merchant = row.items.find(
          (i) => i.x > dateItem.x && i.x < dateItem.x + 80,
        )!;
        dateItem.text += " " + merchant.text;
        dateItem.width += merchant.width + 8;
        row.items = row.items.filter((i) => i !== merchant);
      }
    }
    const parsed = parser.parse(input);
    expect(parsed.transactions).toHaveLength(6);
    expect(parser.validate(parsed).status).toBe("reconciled");
    expect(parsed.transactions[0].extractionConfidence).toBe(0.85);
  });
  it("labels transaction coverage when only an issue date is printed", () => {
    const parsed = parser.parse(cardRows());
    expect(parsed.periodSource).toBe("transaction-coverage");
    expect(parsed.statementDate).toBe("2026-10-04");
    expect(parsed.periodStart).toBe("2026-09-02");
    expect(parsed.periodEnd).toBe("2026-10-04");
    expect(parsed.warnings).toHaveLength(1);
    expect(parsed.warnings[0]).toContain("no period start");
  });
  it("uses printed periods where available and never derives dates from the payment due date", () => {
    const input = cardRows();
    input.splice(
      1,
      0,
      ...rows([[[48, "1 September 2026 to 30 September 2026"]]]),
    );
    expect(parser.parse(input).periodSource).toBe("printed");
    const missing = cardRows().filter((r) => !r.text.includes("issued on"));
    missing.unshift(...rows([[[48, "Please pay by: 27 October 2026"]]]));
    expect(() => parser.parse(missing)).toThrow("Statement dates");
  });
  it("keeps explicit debit suffixes as expenses", () => {
    const input = cardRows();
    const item = input
      .flatMap((r) => r.items)
      .find((i) => i.text === "£80.00")!;
    item.text = "£80.00 DR";
    expect(parser.parse(input).transactions[0].amount).toBe(-8000);
  });
  it("does not silently lose an unreadable dated amount", () => {
    const input = cardRows();
    const item = input
      .flatMap((r) => r.items)
      .find((i) => i.text === "£80.00")!;
    item.text = "£8O.OO";
    const parsed = parser.parse(input);
    expect(
      parsed.warnings.some((w) => w.includes("no readable GBP amount")),
    ).toBe(true);
    expect(parser.validate(parsed).status).toBe("warning");
  });
  it("accepts manual dates with a required source-review warning", () => {
    const parsed = parser.parse(cardRows(), {
      start: "2026-09-01",
      end: "2026-10-04",
    });
    expect(parsed.periodSource).toBe("manual");
    expect(parsed.warnings).toContain(
      "Statement dates were entered manually. Check both dates against the source PDF before importing.",
    );
  });
});
