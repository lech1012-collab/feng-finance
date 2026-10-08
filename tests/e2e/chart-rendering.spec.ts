import { test, expect, type Locator } from "@playwright/test";

async function expectSignedBars(chart: Locator) {
  await expect
    .poll(() => chart.locator('rect[data-series="expenses"]').count())
    .toBeGreaterThan(0);
  const geometry = await chart.evaluate((element) => {
    const reference = element.querySelector(".recharts-reference-line line");
    return {
      zero: reference ? Number(reference.getAttribute("y1")) : null,
      bars: Array.from(element.querySelectorAll("rect[data-series]")).map(
        (bar) => ({
          series: bar.getAttribute("data-series"),
          y: Number(bar.getAttribute("y")),
          height: Number(bar.getAttribute("height")),
          width: Number(bar.getAttribute("width")),
          paintedHeight: bar.getBoundingClientRect().height,
        }),
      ),
    };
  });
  expect(geometry.zero).not.toBeNull();
  expect(geometry.bars.some((bar) => bar.series === "income")).toBe(true);
  for (const bar of geometry.bars) {
    expect(bar.height).toBeGreaterThan(0);
    expect(bar.width).toBeGreaterThan(0);
    // This checks the actual browser SVG rendering, not only chart data/table.
    expect(bar.paintedHeight).toBeGreaterThan(0);
    if (bar.series === "expenses") {
      expect(bar.y).toBeCloseTo(geometry.zero!, 2);
      expect(bar.y + bar.height).toBeGreaterThan(geometry.zero!);
    } else {
      expect(bar.y).toBeLessThan(geometry.zero!);
      expect(bar.y + bar.height).toBeCloseTo(geometry.zero!, 2);
    }
  }
}

test("cash charts paint spending below zero and retain real gaps across mobile and desktop periods", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-10-07T12:00:00Z"));
  await page.goto("/#/settings");
  await page
    .getByRole("button", { name: "Load demo data", exact: true })
    .click();
  await expect(
    page.getByText("Fictitious demo data added.", { exact: true }),
  ).toBeVisible();
  await page.goto("/#/");
  await expectSignedBars(page.locator(".flow-card"));
  await page.goto("/#/analysis");
  await page
    .getByRole("combobox", { name: "Period", exact: true })
    .selectOption("12");
  const chart = page.locator("section.card").filter({
    has: page.getByRole("heading", {
      name: "Income, expenses & net cash flow",
      exact: true,
    }),
  });
  await chart.getByText("View chart values", { exact: true }).click();
  await expect(chart.locator("tbody tr")).toHaveCount(12);
  const values = await chart
    .locator("tbody tr")
    .evaluateAll((rows) =>
      rows.map((row) =>
        Array.from(
          row.querySelectorAll("td"),
          (cell) => cell.textContent ?? "",
        ),
      ),
    );
  const spendingMonths = values.filter(
    (cells) => /^-£[\d,]+\.\d{2}$/.test(cells[2]) && cells[2] !== "-£0.00",
  );
  const missingMonths = values.filter((cells) => cells[0] === "No data");
  expect(spendingMonths.length).toBeGreaterThan(0);
  expect(missingMonths.length).toBeGreaterThan(0);
  for (const cells of missingMonths) {
    expect(cells).toEqual([
      "No data",
      "No statements",
      "No statements",
      "No statements",
    ]);
  }
  await expect(chart.locator('rect[data-series="expenses"]')).toHaveCount(
    spendingMonths.length,
  );
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await expectSignedBars(chart);
    await expect
      .poll(() =>
        chart
          .locator(
            ".recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value",
          )
          .evaluateAll((labels) => {
            const boxes = labels
              .map((label) => label.getBoundingClientRect())
              .sort((a, b) => a.left - b.left);
            return (
              boxes.length >= 2 &&
              boxes.every(
                (box, index) =>
                  index === 0 || box.left >= boxes[index - 1].right + 2,
              )
            );
          }),
      )
      .toBe(true);
  }
});
