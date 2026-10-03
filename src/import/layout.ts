import type { PageTextItem, TextRow } from "../domain/models";
export function reconstructRows(
  items: PageTextItem[],
  tolerance = 2.8,
): TextRow[] {
  const rows: TextRow[] = [];
  for (const item of [...items].sort(
    (a, b) => a.page - b.page || a.y - b.y || a.x - b.x,
  )) {
    if (!item.text.trim()) continue;
    const row = rows.at(-1);
    if (
      row &&
      row.page === item.page &&
      Math.abs(row.y - item.y) <=
        Math.max(
          tolerance,
          (item.confidence ?? 1) < 0.8 ? 6 : 0,
          Math.min(item.height, 10) * 0.25,
        )
    )
      row.items.push(item);
    else rows.push({ page: item.page, y: item.y, items: [item], text: "" });
  }
  for (const row of rows) {
    row.items.sort((a, b) => a.x - b.x);
    const merged: PageTextItem[] = [];
    for (const item of row.items) {
      const previous = merged.at(-1);
      if (
        previous &&
        (item.confidence ?? 1) < 0.8 &&
        (previous.confidence ?? 1) < 0.8 &&
        item.x - (previous.x + previous.width) <= 10
      ) {
        previous.text += " " + item.text;
        previous.width = item.x + item.width - previous.x;
        previous.confidence = Math.min(
          previous.confidence ?? 1,
          item.confidence ?? 1,
        );
      } else merged.push({ ...item });
    }
    row.items = merged;
    row.text = row.items
      .map((i) => i.text)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }
  return rows;
}
