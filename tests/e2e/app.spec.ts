import { test as base, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { startStaticHost, type LocalHost } from "./static-host";
const test = base.extend<{ offlineHost: LocalHost }>({
  offlineHost: async ({}, use) => {
    const host = await startStaticHost();
    try {
      await use(host);
    } finally {
      await host.stop();
    }
  },
});
async function gotoRoute(page: Page, path: string) {
  const origin = page.url().startsWith("http")
    ? new URL(page.url()).origin
    : "";
  await page.goto(origin + "/#" + path);
}
const fixture = (name: string) => resolve(`tests/fixtures/${name}.pdf`);
async function openImport(page: Page) {
  await gotoRoute(page, "/import");
  await expect(
    page.getByRole("heading", { name: "Import statements", exact: true }),
  ).toBeVisible();
}
async function selectStatement(page: Page, name: string) {
  await page.getByLabel("Select PDF statements").setInputFiles(fixture(name));
}
async function confirmImport(page: Page) {
  await page
    .getByRole("button", { name: "Confirm import", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Imported" }),
  ).toBeVisible();
}
async function offlineInstalled(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), {
      timeout: 30000,
    })
    .toBe(true);
}
test("PDF import, drill-down, correction, learned rule and duplicate protection", async ({
  page,
}) => {
  await page.goto("/");
  await openImport(page);
  await selectStatement(page, "barclays");
  await expect(
    page.getByRole("heading", { name: "Barclays detected" }),
  ).toBeVisible();
  await expect(
    page.getByText("✓ Statement reconciled", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("10", { exact: true }).first()).toBeVisible();
  await confirmImport(page);
  await page.getByRole("button", { name: "View dashboard" }).click();
  await page.locator('input[type="month"]').fill("2026-09");
  await expect(page.getByText("+£2,802.35", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: /Shopping £1,200.00/ }).click();
  await expect(
    page.getByRole("link", { name: /JOHN LEWIS LONDON STORE/ }),
  ).toBeVisible();
  await page.getByRole("link", { name: /JOHN LEWIS LONDON STORE/ }).click();
  await page.getByLabel("Category", { exact: true }).selectOption("household");
  await page.getByLabel(/Always categorize similar transactions/).check();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(
    page.getByRole("heading", { name: "Transactions", exact: true }),
  ).toBeVisible();
  await openImport(page);
  await selectStatement(page, "barclays-october");
  await expect(
    page.getByRole("heading", { name: "Barclays detected" }),
  ).toBeVisible();
  await expect(page.getByLabel("Category", { exact: true })).toHaveValue(
    "household",
  );
  await confirmImport(page);
  await openImport(page);
  await selectStatement(page, "barclays");
  await expect(
    page.getByText("This statement has already been imported.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Confirm import" }),
  ).toBeDisabled();
  await selectStatement(page, "barclays-regenerated");
  await expect(
    page.getByText(/A statement for this account and period already exists/),
  ).toBeVisible();
  await expect(page.getByText("0 new transactions selected")).toBeVisible();
  await confirmImport(page);
});
test("multiple banks, transfer exclusion and currency isolation", async ({
  page,
}) => {
  await openImport(page);
  await page
    .getByLabel("Select PDF statements")
    .setInputFiles([fixture("barclays"), fixture("amex"), fixture("revolut")]);
  await expect(
    page.getByRole("heading", { name: "Barclays detected" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Confirm import" }).click();
  await expect(
    page.getByRole("heading", { name: "American Express detected" }),
  ).toBeVisible();
  await expect(
    page.getByText("✓ Statement reconciled", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Confirm import" }).click();
  await expect(
    page.getByRole("heading", { name: "Revolut detected" }),
  ).toBeVisible();
  await expect(
    page.getByText("✓ Statement reconciled", { exact: true }),
  ).toBeVisible();
  await confirmImport(page);
  await page.getByRole("button", { name: "View dashboard" }).click();
  await page.locator('input[type="month"]').fill("2026-09");
  await expect(page.getByText("+£5,588.65", { exact: true })).toBeVisible();
  await expect(
    page.locator(".hero").getByText("£7,150.00", { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".hero").getByText("£1,561.35", { exact: true }),
  ).toBeVisible();
  await openImport(page);
  await selectStatement(page, "revolut-eur");
  await expect(
    page.getByText("✓ Statement reconciled", { exact: true }),
  ).toBeVisible();
  await confirmImport(page);
  await page.getByRole("button", { name: "View dashboard" }).click();
  await page.getByLabel("Dashboard currency").selectOption("EUR");
  await expect(
    page.locator(".hero-number").getByText("-€22.22", { exact: true }),
  ).toBeVisible();
});
test("reconciliation warning cannot be silently committed", async ({
  page,
}) => {
  await openImport(page);
  await selectStatement(page, "barclays-warning");
  await expect(
    page.getByText("⚠ Statement validation failed", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Confirm import" }),
  ).toBeDisabled();
  await page
    .getByLabel(/I reviewed the source PDF and explicitly accept/)
    .check();
  await confirmImport(page);
  await gotoRoute(page, "/settings");
  await expect(
    page.getByText(/Barclays · 2026-09-30 · 1 new transactions · warning/),
  ).toBeVisible();
});
test("backup, destructive confirmation, restore and demo deletion", async ({
  page,
}) => {
  await gotoRoute(page, "/settings");
  await page
    .getByRole("button", { name: "Load demo data", exact: true })
    .click();
  await expect(
    page.getByText("133 transactions stored on this device.", { exact: false }),
  ).toBeVisible();
  const downloadEvent = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export Feng Finance Backup" })
    .click();
  const download = await downloadEvent;
  const path = await download.path();
  expect(path).toBeTruthy();
  const bytes = await readFile(path!);
  const json = JSON.parse(bytes.toString());
  expect(json.format).toBe("feng-finance");
  expect(json.transactions).toHaveLength(133);
  await page
    .getByRole("button", { name: "Delete demo data", exact: true })
    .click();
  await expect(page.getByText(/0 transactions stored/)).toBeVisible();
  await page
    .getByLabel("Restore Feng Finance Backup", { exact: true })
    .setInputFiles({
      name: "backup.json",
      mimeType: "application/json",
      buffer: bytes,
    });
  await expect(
    page.getByRole("button", { name: "Replace data with backup" }),
  ).toBeDisabled();
  await page.getByLabel(/I understand that this replaces/).check();
  await page.getByRole("button", { name: "Replace data with backup" }).click();
  await expect(page.getByText(/133 transactions stored/)).toBeVisible();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Backup restored successfully." }),
  ).toBeVisible();
});
test("offline launch, local PDF import, backup and no financial upload", async ({
  page,
  context,
  offlineHost,
}) => {
  const unexpected: string[] = [];
  context.on("request", (request) => {
    const url = new URL(request.url());
    if (url.protocol === "http:" || url.protocol === "https:") {
      if (
        url.origin !== offlineHost.origin ||
        request.method() !== "GET" ||
        request.postData()
      )
        unexpected.push(`${request.method()} ${url.origin}${url.pathname}`);
    }
  });
  await page.goto(offlineHost.origin);
  await offlineInstalled(page);
  await offlineHost.stop();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await openImport(page);
  await selectStatement(page, "barclays");
  await expect(
    page.getByText("✓ Statement reconciled", { exact: true }),
  ).toBeVisible();
  await confirmImport(page);
  await gotoRoute(page, "/settings");
  const event = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export Feng Finance Backup" })
    .click();
  expect((await event).suggestedFilename()).toMatch(
    /feng-finance-backup-.*\.json/,
  );
  expect(unexpected).toEqual([]);
});
test("scanned PDF uses bundled OCR and requires amount verification offline", async ({
  page,
  offlineHost,
}) => {
  test.setTimeout(120000);
  await page.goto(offlineHost.origin);
  await offlineInstalled(page);
  await offlineHost.stop();
  await openImport(page);
  await selectStatement(page, "barclays-scanned");
  await expect(
    page.getByRole("heading", { name: "Barclays detected" }),
  ).toBeVisible({ timeout: 90000 });
  await expect(page.getByText("OCR", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Confirm import" }),
  ).toBeDisabled();
  await page.getByLabel(/I compared the extracted rows/).check();
  await page.getByLabel(/I verified this transaction/).check();
  await expect(
    page.getByText("✓ Statement reconciled", { exact: true }),
  ).toBeVisible();
  await confirmImport(page);
});
test("mobile layout, navigation, property and demo analysis are usable", async ({
  page,
}) => {
  await gotoRoute(page, "/settings");
  await page
    .getByRole("button", { name: "Load demo data", exact: true })
    .click();
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("link", { name: /Property Rent received/ }).click();
  await expect(
    page.getByRole("heading", { name: "Property", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Mortgage / financing", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Analyse", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Potential recurring costs" }),
  ).toBeVisible();
  await page.screenshot({
    path: `test-results/dashboard-${test.info().project.name}.png`,
    fullPage: true,
  });
});

test("service worker update is explicit and preserves stored records", async ({
  page,
  offlineHost,
}) => {
  await page.goto(offlineHost.origin + "/#/settings");
  await offlineInstalled(page);
  await page
    .getByRole("button", { name: "Load demo data", exact: true })
    .click();
  await expect(page.getByText(/133 transactions stored/)).toBeVisible();
  offlineHost.advanceWorker();
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) throw new Error("No installed worker");
    await registration.update();
  });
  await expect(page.getByText(/Feng Finance update available/)).toBeVisible({
    timeout: 30000,
  });
  const reload = page.waitForEvent("load");
  await page.getByRole("button", { name: "Update", exact: true }).click();
  await reload;
  await expect(page.getByText(/133 transactions stored/)).toBeVisible();
  await expect(page.getByText(/Feng Finance update available/)).toHaveCount(0);
});

test("unsupported PDF is explicit and leaves the database empty", async ({
  page,
}) => {
  await openImport(page);
  await page.getByLabel("Select PDF statements").setInputFiles({
    name: "invalid.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("This is not a PDF"),
  });
  await expect(page.getByRole("alert")).toHaveText(
    "This file is not a valid PDF.",
  );
  await gotoRoute(page, "/settings");
  await expect(page.getByText(/0 transactions stored/)).toBeVisible();
});
