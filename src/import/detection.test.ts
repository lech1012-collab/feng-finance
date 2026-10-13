import { describe, expect, it } from "vitest";
import { rows } from "../tests/helpers";
import { detectBank } from "./detection";

describe("bank issuer detection without generic profiles", () => {
  it.each([
    ["Barclays Bank UK PLC is registered in England", "Barclays"],
    ["barclaycard.co.uk", "Barclays"],
    ["American Express Services Europe Limited", "American Express"],
    ["americanexpress.co.uk", "American Express"],
    ["Revolut Ltd is registered in England", "Revolut"],
    ["revolut.com", "Revolut"],
  ] as const)(
    "recognises an issuer footer when its logo has no PDF text: %s",
    (footer, institution) => {
      const input = rows([
        [[30, "Statement of account"]],
        [[30, "Account number: 00000000"]],
        [
          [30, "Date"],
          [150, "Description"],
          [400, "Amount"],
        ],
        [
          [30, "01 Sep 2026"],
          [150, "FICTIONAL SHOP"],
          [400, "12.00"],
        ],
      ]);
      input.push(
        ...rows([[[30, footer]]]).map((row) => ({
          ...row,
          y: 760,
          items: row.items.map((item) => ({ ...item, y: 760 })),
        })),
      );
      expect(detectBank(input).institution).toBe(institution);
    },
  );

  it.each([
    "American Express Services Europe Limited",
    "Revolut Ltd",
    "americanexpress.co.uk",
  ])(
    "does not identify the bank from a wrapped payee at the foot of a ledger: %s",
    (payee) => {
      const input = rows([
        [[30, "HSBC statement"]],
        [
          [30, "Date"],
          [150, "Description"],
          [400, "Money out"],
        ],
        [
          [30, "01 Sep 2026"],
          [150, "Payment to"],
          [400, "12.00"],
        ],
      ]);
      input.push(
        ...rows([[[150, payee]]]).map((row) => ({
          ...row,
          y: 760,
          items: row.items.map((item) => ({ ...item, y: 760 })),
        })),
      );
      expect(detectBank(input).institution).toBe("Other");
    },
  );

  it.each([
    "PAYMENT TO AMERICAN EXPRESS",
    "DIRECT DEBIT TO BARCLAYCARD",
    "TRANSFER TO REVOLUT",
    "To revolut.com",
    "PAYMENT TO AMERICAN EXPRESS SERVICES EUROPE LIMITED",
  ])("does not treat a ledger payee as the issuer: %s", (payee) => {
    expect(
      detectBank(
        rows([
          [[30, "HSBC statement"]],
          [
            [30, "Date"],
            [150, "Description"],
            [400, "Money out"],
          ],
          [
            [30, "01 Sep 2026"],
            [150, payee],
            [400, "12.00"],
          ],
        ]),
      ).institution,
    ).toBe("Other");
  });

  it("recognises Revolut's own BIC when the logo is graphical", () => {
    expect(
      detectBank(
        rows([
          [[30, "GBP Statement"]],
          [[30, "BIC: REVOGB21"]],
          [
            [30, "Date"],
            [150, "Description"],
            [400, "Money out"],
            [500, "Balance"],
          ],
        ]),
      ).institution,
    ).toBe("Revolut");
  });
});
