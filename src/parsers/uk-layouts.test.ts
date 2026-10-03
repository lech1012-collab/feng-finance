import { describe, it, expect } from "vitest";
import { layoutItems } from "../tests/statement-layouts";
import { reconstructRows } from "../import/layout";
import { AmexStatementParser } from "./amex";
import { RevolutStatementParser } from "./revolut";
import { parseDate } from "../domain/dates";
import { detectBank } from "../import/detection";
const fixture = (bank: "amex" | "revolut") =>
  reconstructRows(layoutItems(bank));
describe("UK Amex layout", () => {
  const parser = new AmexStatementParser();
  it("rejects unsupported column layouts and preserves explicit debit markers", () => {
    const shifted = layoutItems("amex");
    shifted.find((i) => i.text === "Amount £")!.x = 420;
    expect(() => parser.parse(reconstructRows(shifted))).toThrow(
      "layout or currency is unsupported",
    );
    const debit = layoutItems("amex");
    debit.find((i) => i.text === "CR" && i.page === 3)!.text = "DR";
    expect(
      parser
        .parse(reconstructRows(debit))
        .transactions.find((t) => t.description === "SHOP REFUND")?.amount,
    ).toBe(-1000);
  });
  it("reads a low-page explicit period and membership identifier", () => {
    const s = parser.parse(fixture("amex"));
    expect(s).toMatchObject({
      periodStart: "2026-09-06",
      periodEnd: "2026-10-05",
      accountIdentifier: "•••• 0444",
      accountType: "credit",
      currency: "GBP",
      openingBalance: -120000,
      closingBalance: -16000,
    });
    expect(detectBank(fixture("amex")).institution).toBe("American Express");
  });
  it("keeps low-page purchases, booking dates, multiline credits, foreign references and duplicate purchases", () => {
    const s = parser.parse(fixture("amex"));
    expect(s.transactions).toHaveLength(7);
    expect(
      s.transactions.filter((t) => t.type === "transfer").map((t) => t.amount),
    ).toEqual([120000]);
    expect(s.transactions.filter((t) => t.amount === -2000)).toHaveLength(2);
    expect(s.transactions.find((t) => t.amount === -2000)?.bookingDate).toBe(
      "2026-09-10",
    );
    expect(s.transactions.find((t) => t.amount === -500)?.description).toBe(
      "TFL CONTACTLESS",
    );
    expect(
      s.transactions.find((t) => t.amount === -2500)?.description,
    ).toContain("USD 32.00");
    expect(s.transactions.find((t) => t.amount === 1000)?.type).toBe("income");
    expect(parser.validate(s)).toMatchObject({
      status: "reconciled",
      difference: 0,
    });
    expect(s.warnings).toEqual([
      "1 transaction dates fall outside the statement period. Review them before import.",
    ]);
  });
  it("does not substitute payment due dates for the statement period", () => {
    const input = fixture("amex").filter(
      (r) => !r.text.includes("Statement Period"),
    );
    input.push(
      ...reconstructRows([
        {
          page: 1,
          x: 14,
          y: 515,
          width: 200,
          height: 10,
          text: "Payment Due Date 30 October 2026",
        },
      ]),
    );
    expect(() => parser.parse(input)).toThrow("Statement dates");
  });
  it("rejects corrupt summaries and warns about missing amounts or unsupported dates", () => {
    const items = layoutItems("amex");
    items.find((i) => i.text === "£170.00")!.text = "£I70.00";
    expect(() => parser.parse(reconstructRows(items))).toThrow(
      "summary amounts",
    );
    const missing = layoutItems("amex");
    missing.find((i) => i.text === "5.00")!.text = "S.OO";
    const s = parser.parse(reconstructRows(missing));
    expect(s.warnings.join(" ")).toMatch(/missing.*summary/);
    expect(parser.validate(s).status).toBe("warning");
    const badDate = layoutItems("amex");
    badDate.find((i) => i.text === "Sep 30" && i.x < 45)!.text = "Sep 99";
    expect(parser.parse(reconstructRows(badDate)).warnings.join(" ")).toContain(
      "unsupported Amex transaction date",
    );
  });
  it("checks credit and debit totals even when the net balance reconciles", () => {
    const items = layoutItems("amex");
    items.find((i) => i.text === "£1,210.00")!.text = "£1,220.00";
    items.find((i) => i.text === "£170.00")!.text = "£180.00";
    const s = parser.parse(reconstructRows(items));
    expect(parser.validate(s).status).toBe("reconciled");
    expect(s.warnings.join(" ")).toContain(
      "differ from the printed account summary",
    );
  });
});
describe("UK Revolut layout", () => {
  const parser = new RevolutStatementParser();
  it("skips the migration cover, reads the account number and split summary headings", () => {
    const s = parser.parse(fixture("revolut"));
    expect(s).toMatchObject({
      periodStart: "2026-09-01",
      periodEnd: "2026-09-30",
      accountIdentifier: "•••• 5678",
      accountType: "current",
      currency: "GBP",
      openingBalance: 50000,
      closingBalance: 94000,
    });
    expect(s.transactions).toHaveLength(6);
    expect(parser.validate(s)).toMatchObject({
      status: "reconciled",
      difference: 0,
    });
    expect(s.transactions.at(-1)?.description).toBe("FICTIONAL SHOP");
    expect(s.transactions.some((t) => t.description.includes("FOOTER"))).toBe(
      false,
    );
    expect(s.transactions.filter((t) => t.amount === -2500)).toHaveLength(2);
  });
  it("marks an issuer payment as a transfer with mandatory ownership review", () => {
    const s = parser.parse(fixture("revolut"));
    expect(s.transactions.find((t) => t.amount === -16000)?.type).toBe(
      "transfer",
    );
    expect(s.warnings).toEqual([
      "A payment to Amex was marked as a transfer. Confirm it pays your own credit card; otherwise change its type before importing.",
    ]);
    const items = layoutItems("revolut");
    items.find((i) => i.text === "To AMERICAN EXP 9999")!.text =
      "To FICTIONAL PERSON";
    expect(
      parser
        .parse(reconstructRows(items))
        .transactions.find((t) => t.amount === -16000)?.type,
    ).toBe("expense");
  });
  it("checks gross totals independently and rejects multiple products", () => {
    const items = layoutItems("revolut");
    items.find((i) => i.text === "£510.00")!.text = "£520.00";
    expect(parser.parse(reconstructRows(items)).warnings.join(" ")).toContain(
      "differs from the printed summary",
    );
    const multi = fixture("revolut");
    const product = multi.find((r) => r.text.startsWith("Account (Current"))!;
    multi.push({ ...product, y: 340 });
    expect(() => parser.parse(multi)).toThrow(
      "multiple or unreadable products",
    );
  });
  it("rejects mixed statement currencies", () => {
    const items = layoutItems("revolut");
    items.find((i) => i.page === 3 && i.text === "GBP Statement")!.text =
      "EUR Statement";
    expect(() => parser.parse(reconstructRows(items))).toThrow(
      "multiple currencies",
    );
  });
});
it("parses explicit month-first dates without guessing a year", () => {
  expect(parseDate("Sep 4", "2026-09-05")).toBe("2026-09-04");
  expect(parseDate("Dec 31", "2026-01-05")).toBe("2025-12-31");
  expect(parseDate("September 4 2026")).toBe("2026-09-04");
  expect(() => parseDate("Sep 4")).toThrow("year required");
  expect(() => parseDate("Sep 99", "2026-09-05")).toThrow(
    "Invalid statement date",
  );
});
