import type { ExtractedTextItem, SourcePage } from "../import/generic/types";

/** Fictional annual totals, deliberately drawn beside the period column. */
export function annualCardFixture() {
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
  cell(1, 50, 48, "Your Platinum Visa annual statement");
  cell(1, 80, 48, "Number 4111 1111 1111 4444");
  cell(1, 100, 330, "barclaycard.co.uk/login");
  cell(1, 280, 324, "Annual summary");
  cell(1, 300, 48, "Transactions:");
  cell(1, 300, 250, "£3,210.45");
  cell(1, 302, 324, "1 Sep 2025 to 31 Aug 2026");
  cell(1, 320, 48, "Total interest:");
  cell(1, 320, 250, "£4.55");
  cell(1, 340, 48, "Fees:");
  cell(1, 340, 250, "£23.40");
  cell(1, 360, 48, "Payments:");
  cell(1, 360, 250, "£3,000.00");
  cell(1, 340, 324, "Your annual statement is a summary of your spending.");
  cell(1, 356, 324, "This is not a bill.");
  cell(1, 810, 340, "Page 1 of 2 // issued on 04 September 2026");
  cell(2, 50, 48, "Your annual overview");
  cell(2, 90, 48, "Purchase transactions");
  cell(2, 110, 48, "Sterling purchases");
  cell(2, 110, 250, "£2,950.45");
  cell(2, 140, 48, "Non-sterling purchases");
  cell(2, 140, 250, "£200.00");
  cell(2, 170, 48, "Total for purchases");
  cell(2, 170, 250, "£3,150.45");
  cell(2, 200, 48, "Total for cash transactions");
  cell(2, 200, 250, "£60.00");
  cell(2, 100, 330, "Bank of England Base Rate");
  cell(2, 125, 330, "Starting 1 Sep 2025: 4.00%");
  cell(2, 150, 330, "Ending 31 Aug 2026: 3.00%");
  cell(2, 250, 330, "Your monthly statement date");
  cell(2, 270, 330, "Monthly statements contain your individual transactions.");
  cell(2, 780, 48, "Barclaycard is a trading name of Barclays Bank UK PLC.");
  const pages: SourcePage[] = [1, 2].map((page) => ({
    page,
    width: 600,
    height: 842,
    rotation: 0,
  }));
  return { items, pages };
}
