import { it, expect } from "vitest";
import { parseGenericStatement } from "./engine";
import { genericFixture } from "./fixtures";
import type { ExtractedTextItem, SourcePage } from "./types";
it("keeps candidate enumeration bounded over a ten-page thousand-row statement", () => {
  const base = genericFixture("T5GBP");
  const items = base.items.filter((item) => item.y < 180);
  const pages: SourcePage[] = [];
  items.find((item) => item.text === "£1,074.50")!.text = "£990.00";
  const row = (p: number, y: number, values: [number, string][]) =>
    values.forEach(([x, text]) =>
      items.push({
        page: p,
        x,
        y,
        text,
        width: text.length * 5,
        height: 5,
        fontSize: 9,
        parseSource: "text",
      } as ExtractedTextItem),
    );
  let minor = 100000;
  for (let page = 1; page <= 10; page++) {
    pages.push({ page, width: 600, height: 1000, rotation: 0 });
    const y = page === 1 ? 180 : 50;
    row(page, y, [
      [30, "Date"],
      [110, "Description"],
      [320, "Money out"],
      [400, "Money in"],
      [500, "Balance"],
    ]);
    for (let index = 0; index < 100; index++) {
      minor--;
      row(page, y + 20 + index * 7, [
        [30, "1 Sep"],
        [110, "FICTIONAL SHOP"],
        [320, "0.01"],
        [500, (minor / 100).toFixed(2)],
      ]);
    }
  }
  const started = performance.now();
  const result = parseGenericStatement(items, pages);
  const duration = performance.now() - started;
  expect(result.parsed?.transactions).toHaveLength(1000);
  expect(result.checks.reconciledExactly).toBe(true);
  expect(result.candidates.length).toBeLessThanOrEqual(32);
  console.info(
    `Synthetic ten-page parser: ${duration.toFixed(1)} ms, ${result.candidates.length} bounded readings. Physical iPhone timing remains a manual measurement.`,
  );
});
