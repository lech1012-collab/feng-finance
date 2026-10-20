import { genericFixture } from "../import/generic/fixtures";
import type { ExtractedTextItem } from "../import/generic/types";

/** Fictitious eleven-page card statement; no real source statements are stored. */
export function largeCardFixture(
  mode: "exact" | "difference" | "amount" | "date" | "layout" = "exact",
) {
  const sample = genericFixture("T3");
  const items = sample.items
    .filter((item) => item.y < 195)
    .map((item) => ({ ...item }));
  for (const item of items) {
    if (item.y === 145 && item.x === 480) item.text = "£256.50";
    if (item.y === 165 && item.x === 480)
      item.text = mode === "difference" ? "£1,056.51" : "£1,056.50";
  }
  const cell = (
    page: number,
    x: number,
    y: number,
    text: string,
  ): ExtractedTextItem => ({
    page,
    x,
    y,
    text,
    width: text.length * 4,
    height: 8,
    fontSize: 8,
    parseSource: "text",
    confidence: 1,
  });
  const pages = Array.from({ length: 11 }, (_, index) => ({
    page: index + 1,
    width: 600,
    height: 842,
    rotation: 0,
  }));
  for (const { page } of pages) {
    const y = page === 1 ? 195 : 60;
    items.push(
      cell(page, 30, y, "Date"),
      cell(page, 110, y, "Details"),
      cell(page, 470, y, "Amount"),
    );
  }
  for (let index = 0; index < 133; index++) {
    const page = Math.floor(index / 13) + 1;
    const y = (page === 1 ? 230 : 95) + (index % 13) * 34;
    items.push(
      cell(
        page,
        30,
        y,
        mode === "date" && index === 72
          ? "31 Sep"
          : index === 0
            ? "2 Sep"
            : "13 Sep",
      ),
      cell(
        page,
        110,
        y,
        index === 0
          ? "PAYMENT RECEIVED THANK YOU"
          : `FICTIONAL PURCHASE ${index}`,
      ),
      cell(
        page,
        470,
        y,
        mode === "layout" || (mode === "amount" && index === 72)
          ? "UNREAD"
          : index === 0
            ? "200.00 CR"
            : index === 1
              ? "125.50"
              : "1.00",
      ),
    );
  }
  return { items, pages };
}
