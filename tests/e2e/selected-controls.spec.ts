import { expect, test, type Locator } from "./fixtures";

test.use({ serviceWorkers: "block" });

async function expectVisibleInStrip(button: Locator) {
  await expect
    .poll(() =>
      button.evaluate((item) => {
        const strip = item.parentElement!;
        const left = strip.getBoundingClientRect().left + strip.clientLeft;
        const bounds = item.getBoundingClientRect();
        return (
          bounds.left >= left - 1 &&
          bounds.right <= left + strip.clientWidth + 1
        );
      }),
    )
    .toBe(true);
}

test("direct Forecast and YTD links reveal the selected control on a narrow phone", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  await page.goto("/#/planning?tab=forecast");
  const forecast = page.getByRole("tab", { name: "Forecast" });
  await expect(forecast).toHaveAttribute("aria-selected", "true");
  await expectVisibleInStrip(forecast);
  await forecast.focus();
  await page.keyboard.press("ArrowRight");
  const budgets = page.getByRole("tab", { name: "Budgets" });
  await expect(budgets).toBeFocused();
  await expectVisibleInStrip(budgets);

  await page.goto("/#/analysis?period=ytd");
  const ytd = page.getByRole("button", { name: "Year to date" });
  await expect(ytd).toHaveAttribute("aria-pressed", "true");
  await expectVisibleInStrip(ytd);

  // Enlarging the text can change the widths of all five options.
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "100%";
  });
  await expectVisibleInStrip(ytd);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  await expectVisibleInStrip(ytd);

  // WebKit resets the scroll offset as soon as the smaller labels fit. Exercise
  // the case where both layouts happen before the next resize notification.
  await ytd.evaluate((button) => {
    const root = button.ownerDocument.documentElement;
    root.style.fontSize = "100%";
    button.getBoundingClientRect();
    root.style.fontSize = "200%";
  });
  await expectVisibleInStrip(ytd);

  // Changing only the tray's width must reveal YTD without moving the document.
  const strip = ytd.locator("..");
  expect(await strip.evaluate((node) => node.scrollWidth)).toBeGreaterThan(
    await strip.evaluate((node) => node.clientWidth),
  );
  await page.evaluate(() => {
    window.scrollTo(0, 500);
  });
  const before = await page.evaluate(() => window.scrollY);
  expect(before).toBeGreaterThan(0);
  await strip.evaluate((node) => {
    node.scrollLeft = 0;
    node.style.maxWidth = "225px";
  });
  await expectVisibleInStrip(ytd);
  expect(await page.evaluate(() => window.scrollY)).toBe(before);
});
