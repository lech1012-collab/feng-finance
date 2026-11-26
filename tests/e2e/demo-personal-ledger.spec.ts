import { resolve } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";

const september = resolve("tests/fixtures/barclays-planning-09.pdf");

async function chooseSeptember(page: Page, trigger: Locator) {
  const picker = page.waitForEvent("filechooser");
  await trigger.click();
  await (await picker).setFiles(september);
  const confirm = page.getByRole("button", {
    name: "Confirm import",
    exact: true,
  });
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(page.locator(".home-dashboard")).toBeVisible();
}

async function readPersonalLedger(page: Page, base: string, tryDemo: boolean) {
  await page.clock.setFixedTime(new Date("2026-11-22T12:00:00Z"));
  await page.goto(base);
  const welcome = page.getByRole("dialog", { name: "Welcome to Feng" });
  if (tryDemo) {
    await welcome
      .getByRole("button", { name: "Explore with demo data" })
      .click();
    await expect(page.locator(".position-summary")).toContainText("8 accounts");
    await chooseSeptember(
      page,
      page
        .getByRole("navigation", { name: "Main navigation" })
        .getByRole("link", { name: "Import", exact: true }),
    );
  } else {
    await chooseSeptember(
      page,
      welcome.getByRole("button", { name: "Import my statements" }),
    );
  }
  await page.reload();
  await expect(page.locator(".home-dashboard")).toBeVisible();
  await page.locator(".month-picker input[type=month]").fill("2026-09");
  const monthly = page.locator(".month-summary");
  await expect(monthly.locator(".month-income")).toContainText("£3,000.00");
  await expect(monthly.locator(".month-spending")).toContainText("£122.00");
  await expect(monthly.locator(".month-net")).toContainText("+£2,878.00");
  await expect(page.locator(".position-summary")).toContainText("£9,636.00");
  await expect(page.locator(".position-summary")).toContainText("1 account");
  const position = await page.locator(".position-metrics").innerText();
  const tasks = await page.locator(".home-todo").allTextContents();

  await page.goto(base + "#/transactions?allDates=1");
  const records = page.locator(".transaction-list .transaction-row");
  await expect(records).toHaveCount(3);
  const activity = await records.allTextContents();

  await page.goto(base + "#/analysis");
  const totals = page.locator(".metric-strip");
  await expect(totals).toContainText("£3,000.00");
  const analysis = await totals.innerText();

  await page.goto(base + "#/planning?tab=forecast");
  const forecast = page.locator(".forecast-card");
  await expect(forecast).toBeVisible();
  return {
    position,
    tasks,
    activity,
    analysis,
    forecast: await forecast.innerText(),
  };
}

test("trying the demo before a first personal PDF yields the same personal ledger after reload", async ({
  page,
  browser,
  baseURL,
}) => {
  const base = (baseURL ?? "http://127.0.0.1:4173").replace(/\/?$/, "/");
  const direct = await readPersonalLedger(page, base, false);
  const demoFirst = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  try {
    const fromDemo = await readPersonalLedger(
      await demoFirst.newPage(),
      base,
      true,
    );
    expect(fromDemo).toEqual(direct);
  } finally {
    await demoFirst.close();
  }
});
