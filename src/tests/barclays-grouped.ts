import type { PageTextItem } from "../domain/models";
export function groupedBarclaysItems(): PageTextItem[] {
  const items: PageTextItem[] = [];
  const row = (page: number, y: number, cells: [number, string][]) =>
    cells.forEach(([x, text]) =>
      items.push({
        text,
        x,
        y,
        width: text.length * 4,
        height: 8,
        page,
        confidence: 1,
      }),
    );
  const header = (page: number, y: number) =>
    row(page, y, [
      [30, "Date"],
      [100, "Description"],
      [320, "Money out"],
      [400, "Money in"],
      [480, "Balance"],
    ]);
  row(1, 30, [[30, "Barclays Account statement"]]);
  row(1, 50, [[30, "Statement period: 01 Sep 2026 to 30 Sep 2026"]]);
  row(1, 70, [[30, "Account number: 12344321"]]);
  row(1, 90, [[30, "Currency: GBP"]]);
  row(1, 110, [
    [30, "Start balance"],
    [480, "1,000.00"],
  ]);
  row(1, 130, [
    [30, "Money in"],
    [480, "200.00"],
  ]);
  row(1, 150, [
    [30, "Money out"],
    [480, "150.00"],
  ]);
  header(1, 180);
  row(1, 200, [
    [30, "03 Sep"],
    [100, "Card Payment to Fictional Music"],
    [320, "10.00"],
  ]);
  row(1, 214, [[100, "Monthly plan"]]);
  row(1, 240, [
    [100, "Received From Example Employer"],
    [400, "200.00"],
    [480, "1,190.00"],
  ]);
  row(1, 270, [
    [100, "Direct Debit to Example Club"],
    [320, "30.00"],
  ]);
  row(1, 284, [[100, "Ref: TEST-CLUB"]]);
  row(1, 310, [[480, "Continued"]]);
  row(1, 330, [[30, "Registered in England. Test footer 12345678"]]);
  row(2, 30, [[30, "Sort code 00-00-00 Account number 12344321"]]);
  row(2, 50, [[30, "Your transactions"]]);
  header(2, 70);
  row(2, 90, [
    [100, "Direct Debit to Example Council"],
    [320, "40.00"],
  ]);
  row(2, 110, [[100, "Ref: 12345"]]);
  row(2, 140, [[100, "Direct Debit to Example"]]);
  row(2, 154, [
    [100, "Water Company"],
    [320, "20.00"],
  ]);
  row(2, 180, [
    [30, "04 Sep"],
    [100, "Direct Debit to Example Finance"],
    [320, "50.00"],
    [480, "1,050.00"],
  ]);
  row(2, 210, [
    [30, "30 Sep"],
    [100, "End balance"],
    [480, "1,050.00"],
  ]);
  row(2, 250, [
    [100, "Information only"],
    [320, "999.00"],
  ]);
  return items;
}
