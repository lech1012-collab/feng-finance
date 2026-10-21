import type { ExtractedTextItem, SourcePage } from "../import/generic/types";

/** Entirely fictitious single-ledger card statement with adjacent information
 * panels. Amounts in those panels are limits, never posted transactions. */
export function sidebarCardFixture(unreadAmount = false) {
  const items: ExtractedTextItem[] = [];
  const cell = (page: number, y: number, x: number, text: string) =>
    items.push({
      page,
      y,
      x,
      text,
      width: text.length * 4,
      height: 8,
      fontSize: 8,
      confidence: 1,
      parseSource: "text",
    });
  const money = (amount: number) =>
    `£${(amount / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const amounts = [
    350, 1250, 275, 499, 2300, 4600, 825, 999, 1500, 1800, 2499, 3500, 999, 450,
    450, 1750, 875, 1250, 1200, 299, 599, 3200,
  ];
  const purchases = amounts.reduce((sum, amount) => sum + amount, 0);
  const closing = money(purchases);
  cell(1, 45, 48, "Your Platinum Visa statement");
  cell(1, 65, 48, "Number 4111 1111 1111 4444");
  cell(1, 85, 330, "barclaycard.co.uk/login");
  cell(1, 105, 48, "Statement period: 01 Sep 2026 to 30 Sep 2026");
  // Real PDFs often draw issue/due dates as standalone text items. These two
  // X positions on the cover must not veto the single ledger on page two.
  cell(1, 125, 48, "Please pay by:");
  cell(1, 125, 235, "27 October 2026");
  cell(1, 135, 326, "04 October 2026");
  cell(1, 150, 48, "Your previous balance:");
  cell(1, 150, 250, "£315.00");
  cell(1, 175, 48, "Payments towards your account:");
  cell(1, 175, 250, "£315.00");
  cell(1, 200, 48, "Your new balance:");
  cell(1, 200, 250, closing);
  cell(1, 815, 330, "Page 1 of 4 // issued on 04 October 2026");
  cell(2, 60, 48, "Your transactions");
  cell(2, 90, 48, "Your previous balance");
  cell(2, 90, 250, "£315.00");
  cell(2, 118, 48, "Payments towards your account");
  cell(2, 118, 250, "£315.00");
  cell(2, 136, 52, "28 Sep");
  cell(2, 136, 85, "Payment By Direct Debit");
  cell(2, 136, 250, "£315.00");
  cell(2, 162, 48, "Transactions, interest and charges");
  cell(2, 162, 250, closing);
  cell(2, 181, 48, "How you've used your card");
  cell(2, 181, 250, closing);
  amounts.forEach((amount, index) => {
    const y = 202 + index * 20 + (index > 9 ? 20 : 0);
    const date = `${Math.min(27, index + 2)} Sep`;
    const description =
      index === 4
        ? "FICTIONAL BEAUTY SHOP"
        : index === 5
          ? "FICTIONAL RESTAURANT"
          : [13, 14].includes(index)
            ? "REPEATED FICTIONAL CAFE"
            : `FICTIONAL PURCHASE ${index + 1}`;
    cell(2, y, 52, [13, 14].includes(index) ? "16 Sep" : date);
    cell(2, y, 85, description);
    cell(2, y, 238, "e");
    const text = unreadAmount && index === 4 ? "£?.??" : money(amount);
    cell(2, y, 285 - text.length * 4, text);
    if (index === 9) {
      cell(2, y + 9, 85, "20.00 Euro, exchange rate 0.90");
      cell(2, y + 18, 85, "Incl Non Sterling Trans Fee of £0.45");
    }
  });
  cell(2, 72, 326, "Promotional transactions");
  cell(2, 72, 535, "£0.00");
  cell(2, 100, 326, "Interest and charges");
  cell(2, 100, 535, "£0.00");
  cell(2, 150, 330, "Your new balance");
  cell(2, 150, 530, closing);
  cell(2, 220, 326, "Using your card");
  cell(2, 263, 334, "Your cash withdrawal limit is £850.00.");
  // Two separate money runs on the same Y as a real purchase expose accidental
  // rightmost-amount selection; a nearby line must not join its description.
  cell(2, 282, 334, "You have");
  cell(2, 282, 375, "£2,750.00");
  cell(2, 282, 425, "available or");
  cell(2, 282, 500, "£850.00");
  cell(2, 291, 334, "withdraw as cash. Recent transactions may affect this.");
  cell(2, 302, 334, "The limit each time you use Contactless is");
  cell(2, 302, 500, "£100.00");
  cell(2, 720, 48, "Ways to pay");
  cell(2, 740, 52, "Direct Debit");
  cell(2, 755, 52, "Fictitious payment instructions start in the date band.");
  cell(2, 770, 52, "Use bank transfer to make a payment.");
  cell(2, 770, 250, "£50.00");
  for (const page of [3, 4]) {
    cell(page, 50, 48, page === 3 ? "How to pay" : "Summary box");
    for (let index = 0; index < 35; index++)
      cell(page, 90 + index * 16, 52, `Fictitious help text ${index + 1}`);
  }
  const pages: SourcePage[] = [1, 2, 3, 4].map((page) => ({
    page,
    width: 600,
    height: 842,
    rotation: 0,
  }));
  return { items, pages, purchases, amounts };
}
