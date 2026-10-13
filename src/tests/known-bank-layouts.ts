// Entirely fictional PDFs cover the supported layouts without retaining source statements.
import type { PageTextItem } from "../domain/models";
import { groupedBarclaysItems } from "./barclays-grouped";
import { layoutItems } from "./statement-layouts";

export type KnownBankLayout =
  | "barclays-current"
  | "barclaycard"
  | "amex"
  | "revolut"
  | "hsbc"
  | "barclays-malformed";

export function knownBankItems(layout: KnownBankLayout): PageTextItem[] {
  const items: PageTextItem[] = [];
  const row = (page: number, y: number, cells: [number, string][]) =>
    cells.forEach(([x, text]) =>
      items.push({
        page,
        y,
        x,
        text,
        width: text.length * 4,
        height: 8,
        fontSize: 8,
        parseSource: "text",
        confidence: 1,
      }),
    );

  if (layout === "barclays-current") {
    items.push(...groupedBarclaysItems());
    for (const page of [1, 2]) {
      row(page, 776, [
        [
          30,
          "Barclays Bank UK PLC. Authorised by the Prudential Regulation Authority.",
        ],
      ]);
      row(page, 786, [
        [
          30,
          `and the Prudential Regulation Authority (Financial Services Register No. 999111). Page ${page}`,
        ],
      ]);
    }
    return items;
  }

  if (layout === "amex" || layout === "revolut") {
    const result = layoutItems(layout).map((item) => ({ ...item }));
    // The older deliberately unverified fixture has purchase AND posting on
    // Sep 5 outside the Sep 6 start. These dates both belong to this statement.
    if (layout === "amex")
      for (const item of result)
        if (item.page === 2 && item.y === 205 && item.x < 95)
          item.text = "Sep 6";
    return result;
  }

  if (layout === "barclaycard") {
    row(1, 45, [[48, "Your Platinum Visa statement"]]);
    row(1, 60, [[48, "Number 4111 1111 1111 4444"]]);
    row(1, 75, [[330, "barclaycard.co.uk/login"]]);
    row(1, 95, [[48, "Statement period: 01 Sep 2026 to 30 Sep 2026"]]);
    row(1, 150, [
      [48, "Your previous balance:"],
      [240, "£900.00"],
    ]);
    row(1, 170, [
      [48, "Payments towards your account:"],
      [240, "£900.00"],
    ]);
    row(1, 190, [
      [48, "Your new balance:"],
      [240, "£109.68"],
    ]);
    row(1, 818, [[360, "Page 1 of 2 // issued on 04 October 2026"]]);
    row(2, 60, [[48, "Your transactions"]]);
    row(2, 90, [
      [48, "Your previous balance"],
      [240, "£900.00"],
    ]);
    row(2, 118, [
      [48, "Payments towards your account"],
      [240, "£900.00"],
    ]);
    row(2, 136, [
      [52, "28 Sep"],
      [85, "Direct Debit - Payment"],
      [250, "£900.00"],
    ]);
    row(2, 162, [
      [48, "Transactions, interest and charges"],
      [240, "£109.68"],
    ]);
    row(2, 181, [
      [48, "How you've used your card"],
      [240, "£109.68"],
    ]);
    row(2, 195, [
      [52, "02 Sep"],
      [85, "WAITROSE"],
      [244, "e"],
      [260, "£80.00"],
    ]);
    for (const y of [209, 223])
      row(2, y, [
        [52, "05 Sep"],
        [85, "FICTIONAL CAFE"],
        [260, "£12.34"],
      ]);
    row(2, 60, [
      [330, "08 Sep"],
      [365, "MERCHANT REFUND"],
      [540, "£5.00 CR"],
    ]);
    row(2, 74, [
      [330, "10 Sep"],
      [365, "TRAVEL SHOP"],
      [540, "£10.00"],
    ]);
    row(2, 88, [[365, "20 Euro at exchange rate 2.00"]]);
    row(2, 150, [
      [330, "Your new balance"],
      [540, "£109.68"],
    ]);
    return items;
  }

  const bank = layout === "hsbc" ? "HSBC UK Bank plc" : "Barclays";
  row(1, 35, [[30, bank]]);
  row(1, 55, [[30, "Current account statement"]]);
  row(1, 75, [[30, "Statement period: 01 Sep 2026 to 30 Sep 2026"]]);
  row(1, 95, [[30, "Account number: 22223333"]]);
  row(1, 115, [[30, "Currency: GBP"]]);
  row(1, 140, [
    [30, "Opening balance"],
    [500, "£500.00"],
  ]);
  row(1, 160, [
    [30, "Money in"],
    [500, "£2,000.00"],
  ]);
  row(1, 180, [
    [30, "Money out"],
    [500, "£80.00"],
  ]);
  row(1, 205, [
    [30, "Date"],
    [110, "Description"],
    [320, "Money out"],
    [400, "Money in"],
    [500, "Balance"],
  ]);
  row(1, 230, [
    [30, "01 Sep 2026"],
    [110, "FICTIONAL EMPLOYER"],
    [400, "£2,000.00"],
    [500, "£2,500.00"],
  ]);
  row(1, 260, [
    [30, "02 Sep 2026"],
    [110, "FICTIONAL GROCER"],
    // A clearly printed wrong figure cannot be fixed by rereading it with OCR.
    [320, layout === "hsbc" ? "£80.00" : "£81.00"],
    [500, "£2,420.00"],
  ]);
  row(1, 295, [
    [30, "Closing balance"],
    [500, "£2,420.00"],
  ]);
  return items;
}
