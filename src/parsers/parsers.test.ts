import { describe, it, expect } from "vitest";
import { bankRows, rows } from "../tests/helpers";
import { BarclaysStatementParser } from "./barclays";
import { AmexStatementParser } from "./amex";
import { RevolutStatementParser } from "./revolut";
import { detectBank } from "../import/detection";
import { reconstructRows } from "../import/layout";
describe("PDF layout and detection", () => {
  it("orders shuffled coordinates with vertical tolerance", () => {
    const row = reconstructRows([
      { text: "£82.45", x: 400, y: 101, width: 40, height: 10, page: 1 },
      { text: "WAITROSE", x: 100, y: 100, width: 60, height: 10, page: 1 },
      { text: "18 Sep", x: 20, y: 100.5, width: 40, height: 10, page: 1 },
    ]);
    expect(row).toHaveLength(1);
    expect(row[0].text).toBe("18 Sep WAITROSE £82.45");
  });
  it.each(["Barclays", "American Express", "Revolut"])(
    "detects %s with multiple signals",
    (bank) => {
      const detection = detectBank(bankRows(bank));
      expect(detection.institution).toBe(bank);
      expect(detection.confidence).toBeGreaterThanOrEqual(0.7);
    },
  );
  it("returns unknown for unrecognized statements", () =>
    expect(detectBank(rows([[[10, "Unknown Bank"]]])).institution).toBe(
      "Other",
    ));
});
describe("Barclays adapter", () => {
  const parser = new BarclaysStatementParser();
  it("normalizes dates, signs, balances, multiline merchants and identical purchases", () => {
    const p = parser.parse(bankRows());
    expect(p.transactions).toHaveLength(4);
    expect(p.transactions[0].amount).toBe(-12050);
    expect(p.transactions[0].description).toBe("JOHN LEWIS LONDON STORE");
    expect(p.transactions[1].amount).toBe(500000);
    expect(p.transactions[2].date).toBe(p.transactions[3].date);
    expect(p.transactions[2].balanceAfterTransaction).not.toBe(
      p.transactions[3].balanceAfterTransaction,
    );
    expect(parser.validate(p).status).toBe("reconciled");
    expect(p.accountIdentifier).toBe("•••• 4321");
  });
  it("keeps page-spanning rows and marks missing rows", () => {
    const r = bankRows();
    r[8].page = 2;
    r[8].items.forEach((i) => (i.page = 2));
    expect(parser.parse(r).transactions[0].description).toContain("LONDON");
    const incomplete = bankRows();
    incomplete[7].items = incomplete[7].items.filter((i) => i.x < 380);
    incomplete[7].text = "01 Sep JOHN LEWIS";
    expect(
      parser
        .parse(incomplete)
        .warnings.some((w) => w.includes("no readable amount")),
    ).toBe(true);
  });
  it("rejects unidentifiable periods, currencies and multiple accounts", () => {
    expect(() =>
      parser.parse(
        bankRows().filter((r) => !r.text.includes("Statement period")),
      ),
    ).toThrow("period");
    expect(() =>
      parser.parse(bankRows().filter((r) => !r.text.includes("Currency"))),
    ).toThrow("currency");
    expect(() =>
      parser.parse([
        ...bankRows(),
        ...rows([[[20, "Account number: 55558888"]]]),
      ]),
    ).toThrow("multiple accounts");
  });
  it("does not silently omit unsupported dated rows", () => {
    const r = bankRows();
    r[7].items[0].text = "01/99/2026";
    r[7].text = "01/99/2026 JOHN LEWIS 120.50";
    expect(parser.parse(r).warnings.length).toBeGreaterThan(0);
  });
});
describe("Amex liability adapter", () => {
  it("treats purchases as outflows, payments/refunds as inflows and balances as liabilities", () => {
    const parser = new AmexStatementParser();
    const r = rows([
      [[30, "American Express Statement of Account"]],
      [[30, "Statement period: 01 Sep 2026 to 30 Sep 2026"]],
      [[30, "Card ending: 1008"]],
      [[30, "Currency: GBP"]],
      [
        [30, "Previous balance"],
        [550, "1,000.00"],
      ],
      [
        [30, "Date"],
        [140, "Description"],
        [550, "Amount"],
      ],
      [
        [30, "01 Sep"],
        [140, "JOHN LEWIS"],
        [550, "120.50"],
      ],
      [
        [30, "02 Sep"],
        [140, "REFUND"],
        [550, "20.00 CR"],
      ],
      [
        [30, "03 Sep"],
        [140, "BARCLAYS PAYMENT RECEIVED"],
        [550, "500.00 CR"],
      ],
      [
        [30, "04 Sep"],
        [140, "MERCHANT CREDIT"],
        [550, "-10.00"],
      ],
      [
        [30, "New balance"],
        [550, "590.50"],
      ],
    ]);
    const p = parser.parse(r);
    expect(p.transactions.map((t) => t.amount)).toEqual([
      -12050, 2000, 50000, 1000,
    ]);
    expect(p.openingBalance).toBe(-100000);
    expect(p.transactions[2].type).toBe("transfer");
    expect(p.closingBalance).toBe(-59050);
    expect(parser.validate(p).status).toBe("reconciled");
  });
});
describe("Revolut adapter", () => {
  it("handles a currency account and ignores foreign reference amounts in descriptions", () => {
    const parser = new RevolutStatementParser();
    const r = bankRows("Revolut");
    r[4].text = "Currency: EUR";
    r[4].items[0].text = "Currency: EUR";
    r.splice(
      8,
      0,
      ...rows([[[140, "Original amount USD 151.00 exchange rate 1.25"]]]),
    );
    const p = parser.parse(r);
    expect(p.currency).toBe("EUR");
    expect(p.transactions).toHaveLength(4);
    expect(p.transactions[0].description).toContain("USD");
    expect(parser.validate(p).status).toBe("reconciled");
  });
  it("rejects a multi-currency header", () => {
    const r = bankRows("Revolut");
    r[4].text = "Currency: GBP EUR";
    expect(() => new RevolutStatementParser().parse(r)).toThrow(
      "multiple currencies",
    );
  });
});
