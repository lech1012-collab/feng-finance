import type { ExtractedTextItem, SourcePage } from "./types";
export interface Fixture {
  items: ExtractedTextItem[];
  pages: SourcePage[];
  name: string;
}
export function genericFixture(
  id:
    | "T1"
    | "T2"
    | "T3"
    | "T4"
    | "T5GBP"
    | "T5EUR"
    | "T6"
    | "T7"
    | "T8"
    | "T9"
    | "T10"
    | "T11",
): Fixture {
  const items: ExtractedTextItem[] = [];
  const pages: SourcePage[] = Array.from(
    { length: ["T1", "T2", "T7", "T8", "T10", "T11"].includes(id) ? 3 : 1 },
    (_, n) => ({ page: n + 1, width: 600, height: 800, rotation: 0 }),
  );
  const row = (p: number, y: number, cells: [number, string][]) =>
    cells.forEach(([x, text]) =>
      items.push({
        page: p,
        x,
        y,
        text,
        width: text.length * 5,
        height: 10,
        fontSize: 10,
        parseSource: "text",
        confidence: 1,
      }),
    );
  const issuer =
    id === "T6"
      ? "Fictional Birch Bank"
      : id === "T3"
        ? "Barclaycard"
        : id === "T4"
          ? "American Express"
          : id.startsWith("T5")
            ? "Revolut"
            : "Barclays";
  row(1, 25, [[30, issuer]]);
  row(1, 45, [[30, "Account number 11112222"]]);
  row(1, 65, [
    [
      30,
      id === "T9"
        ? "Statement period 20 December 2025 to 19 January 2026"
        : "Statement period 1 September 2026 to 30 September 2026",
    ],
  ]);
  row(1, 85, [[30, id === "T5EUR" ? "Currency EUR" : "Currency GBP"]]);
  const credit = id === "T3" || id === "T4";
  const symbol = id === "T5EUR" ? "€" : "£";
  row(1, 105, [
    [30, credit ? "Previous balance" : "Opening balance"],
    [480, symbol + "1,000.00"],
  ]);
  if (credit) {
    row(1, 125, [
      [30, "New credits"],
      [480, symbol + "200.00"],
    ]);
    row(1, 145, [
      [30, "New debits"],
      [480, symbol + "125.50"],
    ]);
    row(1, 165, [
      [30, "New balance"],
      [480, symbol + "925.50"],
    ]);
    row(1, 195, [
      [30, "Date"],
      [110, "Details"],
      [470, "Amount"],
    ]);
    row(1, 215, [
      [30, "2 Sep"],
      [110, "PAYMENT RECEIVED THANK YOU"],
      [470, "200.00 CR"],
    ]);
    row(1, 245, [
      [30, "3 Sep"],
      [110, "FICTIONAL SHOP"],
      [485, "125.50"],
    ]);
    return { items, pages, name: id };
  }
  const closing = id === "T9" ? "975.00" : "1,074.50";
  row(1, 125, [
    [30, "Closing balance"],
    [480, symbol + closing],
  ]);
  const altered = id === "T2";
  const dateX = altered ? 480 : 30,
    descX = altered ? 30 : 110,
    outX = altered ? 340 : 320,
    inX = altered ? 240 : 400,
    balanceX = altered ? 400 : 500;
  const headers = (
    [
      [dateX, altered ? "Posting date" : "Date"],
      [descX, altered ? "Details" : "Description"],
      [outX, altered ? "Debit" : "Money out"],
      [inX, altered ? "Credit" : "Money in"],
      [balanceX, "Balance"],
    ] as [number, string][]
  ).sort((a, b) => a[0] - b[0]);
  for (const page of pages) row(page.page, page.page === 1 ? 180 : 60, headers);
  const transaction = (
    p: number,
    y: number,
    date: string,
    desc: string,
    out: string,
    income: string,
    balance: string,
  ) =>
    row(
      p,
      y,
      (
        [
          [dateX, date],
          [descX, desc],
          ...(out ? [[outX, out] as [number, string]] : []),
          ...(income ? [[inX, income] as [number, string]] : []),
          [balanceX, balance],
        ] as [number, string][]
      ).sort((a, b) => a[0] - b[0]),
    );
  if (id === "T9") {
    transaction(1, 210, "25 Dec", "FICTIONAL CAFE", "10.00", "", "990.00");
    transaction(1, 240, "5 Jan", "FICTIONAL SHOP", "15.00", "", "975.00");
    return { items, pages, name: id };
  }
  transaction(
    1,
    210,
    "1 Sep 2026",
    "FICTIONAL SALARY",
    "",
    "200.00",
    "1,200.00",
  );
  transaction(
    1,
    240,
    "2 Sep",
    "FICTIONAL SHOP",
    id === "T11" ? "100.01" : "100.00",
    "",
    "1,100.00",
  );
  if (pages.length > 1) {
    row(1, 280, [
      [descX, "Balance carried forward"],
      [balanceX, "1,100.00"],
    ]);
    row(2, 35, [
      [descX, "Balance brought forward"],
      [balanceX, "1,100.00"],
    ]);
    transaction(2, 100, "3 Sep", "FICTIONAL CAFE", "25.50", "", "1,074.50");
    row(2, 280, [
      [descX, "Balance carried forward"],
      [balanceX, "1,074.50"],
    ]);
    row(3, 35, [
      [descX, "Balance brought forward"],
      [balanceX, "1,074.50"],
    ]);
  } else
    transaction(1, 270, "3 Sep", "FICTIONAL CAFE", "25.50", "", "1,074.50");
  if (id === "T10") row(1, 250, [[descX, "LONDON BRANCH"]]);
  if (id === "T7") {
    items.length = 0;
  }
  if (id === "T8")
    for (const item of items.filter((i) => i.y >= 180)) {
      item.text = "��� ¤§ ¯\\";
    }
  return { items, pages, name: id };
}
