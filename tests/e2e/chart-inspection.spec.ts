import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Locator, type Page } from "./fixtures";
import { categoryHistoryFixture } from "../../src/tests/category-history";

test.use({ hasTouch: true });

async function seed(page: Page) {
  await page.clock.setFixedTime(new Date("2026-11-08T12:00:00Z"));
  await page.evaluate(
    (source) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("feng-finance");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const names = ["accounts", "statements", "transactions"] as const;
          const tx = database.transaction([...names], "readwrite");
          for (const name of names)
            for (const row of source[name]) tx.objectStore(name).put(row);
          tx.oncomplete = () => {
            database.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    categoryHistoryFixture(),
  );
  await page.reload();
  await page.getByLabel("Selected month").fill("2026-10");
}

async function savedRows(page: Page) {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open("feng-finance");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const names = [
            "accounts",
            "statements",
            "transactions",
            "rules",
            "categories",
          ];
          const tx = database.transaction(names, "readonly");
          const reads = names.map(
            (name) => [name, tx.objectStore(name).getAll()] as const,
          );
          tx.oncomplete = () => {
            database.close();
            resolve(
              Object.fromEntries(
                reads.map(([name, result]) => [name, result.result]),
              ),
            );
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
}

async function coordinates(inspector: Locator) {
  return inspector.locator("[data-chart-coordinates]").evaluate((marker) => {
    const svg = (marker as SVGGElement).ownerSVGElement!;
    const box = svg.getBoundingClientRect();
    const view = svg.viewBox.baseVal;
    const line = marker.querySelector("line")!;
    const y =
      (Number(line.getAttribute("y1")) + Number(line.getAttribute("y2"))) / 2;
    return {
      xs: (marker.getAttribute("data-chart-coordinates") ?? "")
        .split(",")
        .map((x) => box.x + (Number(x) * box.width) / view.width),
      y: box.y + (y * box.height) / view.height,
    };
  });
}

test("cash flow scrubbing leaves a visible marker and fixed readings without obscuring the plot or blocking vertical touch scroll", async ({
  page,
  browserName,
  context,
}) => {
  await seed(page);
  const chart = page.locator(".flow-card");
  const inspector = chart.getByRole("slider", { name: "Inspect cash flow" });
  const readout = chart.getByRole("group", {
    name: "Selected cash flow values",
  });
  await inspector.scrollIntoViewIfNeeded();
  await expect(chart.locator("[data-chart-coordinates]")).toHaveCount(1);
  const before = await savedRows(page);
  await inspector.focus();
  await inspector.press("Home");
  const initialTop = (await inspector.boundingBox())!.y;
  await expect(readout).toContainText("May 2026");
  await expect(readout).toContainText("−£1,000.00");
  for (let index = 1; index < 6; index++) {
    await inspector.press("ArrowRight");
    expect(
      Math.abs((await inspector.boundingBox())!.y - initialTop),
    ).toBeLessThanOrEqual(1);
  }
  await expect(readout).toContainText("October 2026");
  const points = await coordinates(inspector);
  await page.touchscreen.tap(points.xs[2], points.y);
  await expect(readout).toHaveAttribute("data-selected-key", "2026-07");
  await expect(inspector).toBeFocused();
  await page.mouse.move(points.xs[0], points.y);
  await page.mouse.down();
  await page.mouse.move(points.xs[4], points.y, { steps: 12 });
  await page.mouse.up();
  await expect(inspector).toBeFocused();
  await expect(readout).toHaveAttribute("data-selected-key", "2026-09");
  await expect(chart.locator(".chart-selection-marker")).toHaveAttribute(
    "data-selected-key",
    "2026-09",
  );
  await page.mouse.move(5, 5);
  await expect(readout).toHaveAttribute("data-selected-key", "2026-09");
  await expect(
    chart.locator(".recharts-tooltip-wrapper, .chart-tooltip"),
  ).toHaveCount(0);
  const readoutBox = (await readout.boundingBox())!;
  const plotBox = (await inspector.boundingBox())!;
  expect(readoutBox.y + readoutBox.height).toBeLessThanOrEqual(plotBox.y + 1);

  if (browserName === "chromium") {
    const session = await context.newCDPSession(page);
    const point = await coordinates(inspector);
    const scrollBefore = await page.evaluate(() => scrollY);
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: point.xs[0], y: point.y }],
    });
    for (let move = 1; move <= 8; move++) {
      await session.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          {
            x: point.xs[0] + ((point.xs[4] - point.xs[0]) * move) / 8,
            y: point.y,
          },
        ],
      });
    }
    await expect(readout).toHaveAttribute("data-selected-key", "2026-09");
    await session.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await expect(inspector).toBeFocused();
    expect(
      Math.abs((await page.evaluate(() => scrollY)) - scrollBefore),
    ).toBeLessThanOrEqual(1);
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: point.xs[2], y: point.y + 25 }],
    });
    for (let move = 1; move <= 5; move++) {
      await session.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: point.xs[2], y: point.y + 25 - move * 18 }],
      });
    }
    await session.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await expect
      .poll(() => page.evaluate(() => scrollY))
      .toBeGreaterThan(scrollBefore + 20);
    await expect(readout).toHaveAttribute("data-selected-key", "2026-09");
    await session.detach();
  } else {
    expect(
      await inspector.evaluate(
        (element) => getComputedStyle(element).touchAction,
      ),
    ).toBe("pan-y pinch-zoom");
  }
  const audit = await new AxeBuilder({ page }).include(".flow-card").analyze();
  expect(audit.violations).toEqual([]);
  expect(await savedRows(page)).toEqual(before);
});

test("category readings reserve space at mobile text sizes and open the selected month's transactions", async ({
  page,
}) => {
  await seed(page);
  const before = await savedRows(page);
  await page.goto("/#/categories/property?month=2026-10");
  const chart = page.locator(".category-trend");
  const inspector = chart.getByRole("slider", {
    name: "Inspect property monthly trend",
  });
  const readout = chart.getByRole("group", {
    name: "Selected category values",
  });
  for (const [width, fontSize] of [
    [390, "100%"],
    [320, "100%"],
    [390, "200%"],
    [1280, "100%"],
  ] as const) {
    await page.setViewportSize({ width, height: 844 });
    await page.evaluate(
      (size) => (document.documentElement.style.fontSize = size),
      fontSize,
    );
    await inspector.scrollIntoViewIfNeeded();
    await inspector.focus();
    await inspector.press("Home");
    const top = (await inspector.boundingBox())!.y;
    for (let index = 1; index < 7; index++) {
      await inspector.press("ArrowRight");
      expect(
        Math.abs((await inspector.boundingBox())!.y - top),
      ).toBeLessThanOrEqual(1);
    }
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      )
      .toBe(true);
    await expect(readout).toContainText("October 2026");
    await expect(readout).toContainText("£2,000.00");
    await expect(readout).toContainText("66.7%");
    await expect(chart.locator(".recharts-tooltip-wrapper")).toHaveCount(0);
  }
  await inspector.press("Home");
  await inspector.press("ArrowRight");
  await readout
    .getByRole("link", { name: "View transactions for May 2026" })
    .click();
  await expect(page).toHaveURL(/transactions\?category=property&month=2026-05/);
  await expect(page.locator(".transaction-row")).toHaveCount(1);
  await expect(page.locator(".transaction-row")).toContainText("£1,000.00");
  expect(await savedRows(page)).toEqual(before);
});
