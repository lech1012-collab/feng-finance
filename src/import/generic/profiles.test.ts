import { describe, expect, it } from "vitest";
import type { PageTextItem } from "../../domain/models";
import { bankRows } from "../../tests/helpers";
import { layoutItems } from "../../tests/statement-layouts";
import cardSource from "../../tests/synthetic-barclaycard-pdf-text.json";
import { detectProfile } from "./profiles";
import type { ExtractedTextItem } from "./types";

const enhance = (items: PageTextItem[]): ExtractedTextItem[] =>
  items.map((item) => ({
    ...item,
    fontSize: item.height,
    parseSource: "text",
  }));

function statementWithPayee(issuer: string, payee: string) {
  return enhance(
    bankRows(issuer)
      .flatMap((row) => row.items)
      .map((item) =>
        item.text === "JOHN LEWIS" ? { ...item, text: payee } : item,
      ),
  );
}

describe("statement issuer detection excludes transaction counterparties", () => {
  it.each([
    "DIRECT DEBIT TO BARCLAYCARD",
    "BILL PAYMENT TO AMERICAN EXPRESS",
    "TRANSFER TO REVOLUT",
  ])("keeps Barclays current-account signs for the payee %s", (payee) => {
    expect(detectProfile(statementWithPayee("Barclays", payee))).toMatchObject({
      id: "barclays-current",
      institution: "Barclays",
      accountTypeHint: "current",
      signConventionHint: "in_out_columns",
    });
  });

  it.each([
    "TO BARCLAYCARD CREDIT CARD",
    "TO AMERICAN EXPRESS",
    "PAYMENT TO BARCLAYS",
  ])("keeps the Revolut issuer when its payee is %s", (payee) => {
    expect(detectProfile(statementWithPayee("Revolut", payee))?.id).toBe(
      "revolut",
    );
  });

  it("keeps Amex credit-card signs when a payment mentions Barclays", () => {
    expect(
      detectProfile(
        statementWithPayee(
          "American Express",
          "PAYMENT RECEIVED FROM BARCLAYS CURRENT ACCOUNT",
        ),
      ),
    ).toMatchObject({
      id: "amex",
      accountTypeHint: "credit",
      signConventionHint: "signed_positive_out",
    });
  });

  it.each([
    "DIRECT DEBIT TO BARCLAYCARD",
    "PAYMENT TO AMERICAN EXPRESS",
    "TRANSFER TO REVOLUT",
    "PAYMENT FROM BARCLAYS",
  ])("leaves an unknown issuer unknown despite the payee %s", (payee) => {
    expect(
      detectProfile(statementWithPayee("Fictional Birch Bank", payee)),
    ).toBeUndefined();
  });

  it.each(["BARCLAYCARD", "AMERICAN EXPRESS", "REVOLUT", "BARCLAYS"])(
    "does not infer an issuer from a headerless dated %s payment",
    (payee) => {
      const items = statementWithPayee("Fictional Birch Bank", payee);
      const firstTransactionY = Math.min(
        ...items.filter((item) => item.text === "01 Sep").map((item) => item.y),
      );
      expect(
        detectProfile(items.filter((item) => item.y >= firstTransactionY)),
      ).toBeUndefined();
    },
  );

  it("identifies the generated card statement from its issuer URL and card summary", () => {
    const items = enhance(
      cardSource.items.map((item) => ({
        ...item,
        parseSource: "text" as const,
      })),
    );
    expect(detectProfile(items)).toMatchObject({
      id: "barclaycard",
      accountTypeHint: "credit",
      signConventionHint: "signed_positive_out",
    });
  });

  it("finds Amex's issuer URL and membership header before its low-page period", () => {
    const items = enhance(
      layoutItems("amex").map((item) =>
        item.text === "PAYMENT RECEIVED - THANK YOU"
          ? { ...item, text: "PAYMENT RECEIVED FROM BARCLAYS" }
          : item,
      ),
    );
    expect(detectProfile(items)?.id).toBe("amex");
  });

  it("identifies Revolut's migration cover rather than its Amex payment", () => {
    expect(detectProfile(enhance(layoutItems("revolut")))?.id).toBe("revolut");
  });

  it("uses source coordinates when PDF text items arrive in reverse order", () => {
    const items = statementWithPayee("Barclays", "TO BARCLAYCARD");
    expect(detectProfile(items.reverse())?.id).toBe("barclays-current");
  });

  it("returns no profile for an empty extraction", () => {
    expect(detectProfile([])).toBeUndefined();
  });
});
