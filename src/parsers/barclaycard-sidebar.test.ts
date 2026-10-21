import { describe, expect, it } from "vitest";
import { sidebarCardFixture } from "../tests/barclaycard-sidebar";
import { reconstructRows } from "../import/layout";
import { BarclaycardStatementParser } from "./barclaycard";
import { prepareBankAdapterReading } from "../import/bank-adapter-proof";

describe("Barclaycard ledger beside account-information panels", () => {
  const parser = new BarclaycardStatementParser();
  it("reads 23 posted transactions without treating limits as purchases or merchant text", () => {
    const fixture = sidebarCardFixture();
    const rows = reconstructRows(fixture.items);
    const parsed = parser.parse(rows);
    expect(parsed.transactions).toHaveLength(23);
    expect(
      parsed.transactions.find((t) => t.description.includes("BEAUTY")),
    ).toMatchObject({ description: "FICTIONAL BEAUTY SHOP", amount: -2300 });
    expect(
      parsed.transactions.find((t) => t.description.includes("RESTAURANT")),
    ).toMatchObject({ description: "FICTIONAL RESTAURANT", amount: -4600 });
    expect(
      parsed.transactions.every((t) => t.extractionConfidence >= 0.8),
    ).toBe(true);
    expect(
      parsed.transactions.some((t) =>
        /AVAILABLE|CONTACTLESS|WITHDRAW/.test(t.description),
      ),
    ).toBe(false);
    expect(
      parsed.transactions.filter(
        (t) => t.description === "REPEATED FICTIONAL CAFE",
      ),
    ).toHaveLength(2);
    expect(
      parsed.transactions.find((t) => t.description.includes("20.00 EURO")),
    ).toMatchObject({ amount: -1800 });
    expect(
      parsed.transactions.find((t) => t.type === "transfer"),
    ).toMatchObject({ amount: 31500 });
    expect(parsed.openingBalance).toBe(-31500);
    expect(parsed.closingBalance).toBe(-fixture.purchases);
    expect(parser.validate(parsed)).toMatchObject({
      status: "reconciled",
      difference: 0,
    });
    expect(parsed.warnings).toEqual([]);
    const proof = prepareBankAdapterReading(parsed, rows);
    expect(proof.bankSource.reconciledExactly).toBe(true);
    expect(proof.parsed.rowsNeedingReview).toBe(0);
    expect(proof.parsed.rowsTotalChecked).toBe(23);
  });
  it("still flags an unreadable ledger amount even with readable limits on the same line", () => {
    const { items } = sidebarCardFixture(true);
    const rows = reconstructRows(items);
    const parsed = parser.parse(rows);
    expect(parsed.transactions).toHaveLength(22);
    expect(
      parsed.warnings.some((w) => w.includes("no readable GBP amount")),
    ).toBe(true);
    expect(parser.validate(parsed).status).toBe("warning");
    expect(
      prepareBankAdapterReading(parsed, rows).bankSource.reconciledExactly,
    ).toBe(false);
  });
});
