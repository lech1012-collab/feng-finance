// Entirely fictitious coordinate fixtures for supported UK statement layouts.
import type { PageTextItem } from "../domain/models";
export function layoutItems(bank: "amex" | "revolut") {
  const items: PageTextItem[] = [];
  const row = (page: number, y: number, values: [number, string][]) =>
    values.forEach(([x, text]) =>
      items.push({
        page,
        y,
        x,
        text,
        width: text.length * 4.4,
        height: 10,
        confidence: 1,
      }),
    );
  if (bank === "amex") {
    row(1, 35, [[428, "americanexpress.co.uk"]]);
    row(1, 125, [[14, "Statement of Account"]]);
    row(1, 145, [
      [14, "Prepared for"],
      [288, "Membership Number"],
      [520, "Date"],
    ]);
    row(1, 157, [
      [14, "FICTIONAL CARDHOLDER"],
      [288, "xxxx-xxxxxx-10444"],
      [485, "05/10/26"],
    ]);
    row(1, 200, [
      [65, "Previous Closing Balance"],
      [197, "New Credits"],
      [295, "New Debits"],
      [379, "Closing Balance"],
    ]);
    row(1, 218, [
      [89, "£1,200.00"],
      [143, "-"],
      [185, "£1,210.00"],
      [237, "+"],
      [281, "£170.00"],
      [333, "="],
      [374, "£"],
      [381, "160.00"],
    ]);
    for (let n = 0; n < 28; n++)
      row(1, 260 + n * 7, [[14, `Information paragraph ${n + 1}`]]);
    row(1, 510, [
      [14, "Statement Period"],
      [187, "From 6 September to 5 October 2026"],
    ]);
    for (const p of [2, 3]) {
      row(p, 88, [[14, "Statement of Account"]]);
      row(p, 142, [
        [14, "Transaction"],
        [58, "Process"],
      ]);
      row(p, 150, [
        [14, "Date"],
        [58, "Date"],
        [101, "Transaction Details"],
        [377, "Foreign Spend"],
        [504, "Amount £"],
      ]);
    }
    row(2, 170, [
      [14, "Sep 23"],
      [58, "Sep 23"],
      [101, "PAYMENT RECEIVED - THANK YOU"],
      [491, "1,200.00"],
    ]);
    row(2, 183, [[519, "CR"]]);
    row(2, 205, [
      [14, "Sep 5"],
      [58, "Sep 5"],
      [101, "FICTIONAL SHOP"],
      [505, "100.00"],
    ]);
    row(2, 214, [[101, "LONDON BRANCH"]]);
    row(2, 240, [
      [14, "Sep 9"],
      [58, "Sep 10"],
      [101, "FICTIONAL CAFE"],
      [505, "20.00"],
    ]);
    row(2, 270, [
      [14, "Sep 9"],
      [58, "Sep 10"],
      [101, "FICTIONAL CAFE"],
      [505, "20.00"],
    ]);
    row(2, 755, [
      [14, "Sep 30"],
      [58, "Sep 30"],
      [101, "TFL"],
      [510, "5.00"],
    ]);
    row(2, 764, [[101, "CONTACTLESS"]]);
    row(3, 170, [
      [14, "Oct 2"],
      [58, "Oct 3"],
      [101, "FICTIONAL HOTEL"],
      [377, "USD 32.00"],
      [505, "25.00"],
    ]);
    row(3, 179, [[101, "EXCHANGE RATE 1.28"]]);
    row(3, 205, [
      [14, "Oct 3"],
      [58, "Oct 3"],
      [101, "SHOP REFUND"],
      [505, "10.00"],
    ]);
    row(3, 218, [[519, "CR"]]);
    row(3, 250, [
      [14, "Total new spend transactions for FICTIONAL CARDHOLDER"],
      [491, "160.00"],
    ]);
    row(3, 280, [[14, "How you can pay your statement"]]);
    row(4, 150, [[14, "Your Cashback Statement"]]);
    row(4, 262, [
      [351, "Closing Cashback Balance"],
      [485, "£12.00"],
    ]);
  } else {
    row(1, 80, [[48, "PERSONAL ACCOUNT MIGRATION"]]);
    row(1, 115, [[48, "Revolut Bank UK Ltd migration information"]]);
    row(1, 300, [[48, "Migration Date: 08/07/2026"]]);
    for (const p of [2, 3]) row(p, 85, [[416, "GBP Statement"]]);
    row(2, 98, [[449, "1 September 2026 - 30 September 2026"]]);
    row(2, 176, [
      [353, "IBAN"],
      [419, "GB00 REVO 0000 0000 9999 8888"],
    ]);
    row(2, 189, [
      [353, "BIC"],
      [419, "REVOGB00"],
    ]);
    row(2, 224, [
      [353, "Account Number"],
      [419, "12345678"],
    ]);
    row(2, 274, [[40, "Balance summary"]]);
    row(2, 300, [[526, "Closing"]]);
    row(2, 306, [
      [43, "Product"],
      [253, "Opening balance"],
      [335, "Money out"],
      [417, "Money in"],
    ]);
    row(2, 312, [[527, "balance"]]);
    for (const [y, label] of [
      [331, "Account (Current Account)"],
      [350, "Total"],
    ] as const)
      row(2, y, [
        [43, label],
        [253, "£500.00"],
        [335, "£510.00"],
        [417, "£950.00"],
        [530, "£940.00"],
      ]);
    row(2, 415, [
      [40, "Account transactions from 1 September 2026 to 30 September 2026"],
    ]);
    for (const [p, y] of [
      [2, 441],
      [3, 150],
    ])
      row(p, y, [
        [43, "Date"],
        [125, "Description"],
        [335, "Money out"],
        [417, "Money in"],
        [526, "Balance"],
      ]);
    row(2, 460, [
      [43, "1 Sept 2026"],
      [125, "Payment from FICTIONAL PERSON"],
      [417, "£200.00"],
      [519, "£700.00"],
    ]);
    row(2, 467, [[125, "Reference: GIFT"]]);
    row(2, 489, [
      [43, "3 Sept 2026"],
      [125, "Payment from FICTIONAL TENANT"],
      [417, "£750.00"],
      [519, "£1,450.00"],
    ]);
    row(2, 496, [[125, "Reference: RENT"]]);
    row(2, 518, [
      [43, "10 Sept 2026"],
      [125, "To Tax Free Childcare"],
      [335, "£300.00"],
      [519, "£1,150.00"],
    ]);
    row(2, 547, [
      [43, "25 Sept 2026"],
      [125, "To AMERICAN EXP 9999"],
      [335, "£160.00"],
      [519, "£990.00"],
    ]);
    row(2, 555, [[125, "Reference: FICTIONAL CARD"]]);
    row(2, 577, [
      [43, "28 Sept 2026"],
      [125, "FICTIONAL SHOP"],
      [335, "£25.00"],
      [519, "£965.00"],
    ]);
    row(2, 585, [[125, "Card: 411111******1111"]]);
    row(3, 180, [
      [43, "28 Sept 2026"],
      [125, "FICTIONAL SHOP"],
      [335, "£25.00"],
      [519, "£940.00"],
    ]);
    for (const p of [2, 3]) {
      row(p, 746, [[85, "Report lost or stolen card"]]);
      row(p, 768, [[188, "Revolut Bank UK Ltd legal footer"]]);
    }
  }
  return items;
}
