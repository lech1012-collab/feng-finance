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
    page.getByRole("status").filter({ hasText: "Import complete" }),
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
  // Exercise a slow lazy-loaded editor: the prior screen can remain interactive
  // during the route transition and has its own Category filter.
  await page.route("**/assets/TransactionDetail-*.js", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 200));
    await route.continue();
  });
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
    page.getByRole("heading", { name: "Shopping", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "View all transactions", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: /JOHN LEWIS LONDON STORE/ }),
  ).toBeVisible();
  await page.getByRole("link", { name: /JOHN LEWIS LONDON STORE/ }).click();
  await expect(
    page.getByRole("button", { name: "Save changes", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Category", { exact: true }).selectOption("household");
  await expect(page.getByLabel("Category", { exact: true })).toHaveValue(
    "household",
  );
  await page.getByLabel(/Always categorize similar transactions/).check();
  await expect(page.getByLabel("Transactions containing")).toHaveValue(
    "JOHN LEWIS",
  );
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(
    page.getByRole("heading", { name: "Transactions", exact: true }),
  ).toBeVisible();
  await gotoRoute(page, "/settings");
  await page
    .locator("summary")
    .filter({ hasText: "Categorization & transfer rules" })
    .click();
  await expect(
    page.getByText("JOHN LEWIS → Household", { exact: true }),
  ).toBeVisible();
  await openImport(page);
  await selectStatement(page, "barclays-october");
  await expect(
    page.getByRole("heading", { name: "Barclays detected" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /All transactions/ }).click();
  await page.locator(".review-row > summary").click();
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
test("Barclaycard issue date, two reading columns and repayment exclusion", async ({
  page,
}) => {
  await openImport(page);
  await selectStatement(page, "barclaycard");
  await expect(
    page.getByRole("heading", { name: "Barclays detected" }),
  ).toBeVisible();
  await expect(
    page.getByText("✓ Statement reconciled", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Transaction coverage: 2026-09-02 to 2026-10-04", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Statement issued: 2026-10-04", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Confirm import", exact: true }),
  ).toBeDisabled();
  await page.getByLabel(/I compared the extracted rows with the PDF/).check();
  await confirmImport(page);
  await page.getByRole("button", { name: "View dashboard" }).click();
  await page.locator('input[type="month"]').fill("2026-09");
  await expect(page.locator(".hero-number")).toHaveText("-£109.68");
  await page.getByRole("link", { name: "Transactions", exact: true }).click();
  await expect(page.getByRole("link", { name: /\+£900\.00/ })).toContainText(
    "Transfer",
  );
});

test("Barclays header date ranges and manual statement-date fallback", async ({
  page,
}) => {
  await openImport(page);
  await selectStatement(page, "barclays-header-range");
  await expect(
    page.getByText("✓ Statement reconciled", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("2026-09-01 to 2026-09-30", { exact: true }),
  ).toBeVisible();
  await selectStatement(page, "barclays-no-period");
  await expect(page.getByRole("alert")).toContainText(
    "Enter the start and end dates",
  );
  await page.getByLabel("Enter statement dates from PDF").check();
  await page.getByLabel("Statement start date").fill("2026-09-01");
  await page.getByLabel("Statement end date").fill("2026-09-30");
  await page.getByRole("button", { name: "Parse again", exact: true }).click();
  await expect(
    page.getByText("✓ Statement reconciled", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Confirm import", exact: true }),
  ).toBeDisabled();
  await page.getByLabel(/I compared the extracted rows with the PDF/).check();
  await confirmImport(page);
  await openImport(page);
  await selectStatement(page, "barclays-october");
  await expect(
    page.getByText("2026-10-01 to 2026-10-31", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Enter statement dates from PDF"),
  ).not.toBeChecked();
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
  await page
    .locator("summary")
    .filter({ hasText: "Statement history" })
    .click();
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
  await page.locator(".category-row").filter({ hasText: "Property" }).click();
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

test("UK Amex and Revolut layouts reconcile, preserve dated exceptions and import sequentially", async ({
  page,
}) => {
  await openImport(page);
  await page
    .getByLabel("Select PDF statements")
    .setInputFiles([fixture("amex-uk-layout"), fixture("revolut-uk-layout")]);
  await expect(
    page.getByRole("heading", { name: "American Express detected" }),
  ).toBeVisible();
  await expect(
    page.getByText("✓ Statement reconciled", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("2026-09-06 to 2026-10-05", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/1 transaction dates fall outside/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Confirm import", exact: true }),
  ).toBeDisabled();
  await page.getByLabel(/I compared the extracted rows with the PDF/).check();
  await page
    .getByRole("button", { name: "Confirm import", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Revolut detected" }),
  ).toBeVisible();
  await expect(
    page.getByText("✓ Statement reconciled", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("2026-09-01 to 2026-09-30", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Confirm import", exact: true }),
  ).toBeDisabled();
  await page.getByLabel(/I compared the extracted rows with the PDF/).check();
  await confirmImport(page);
  await page.getByRole("button", { name: "View dashboard" }).click();
  await page.locator('input[type="month"]').fill("2026-09");
  await expect(page.locator(".hero-number")).toHaveText("+£455.00");
  await openImport(page);
  await selectStatement(page, "revolut-uk-layout");
  await expect(
    page.getByText("This statement has already been imported.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Confirm import", exact: true }),
  ).toBeDisabled();
});

test("dark default, persistent appearance and mobile layouts without overlapping controls", async ({
  page,
}) => {
  test.setTimeout(120000);
  await gotoRoute(page, "/settings");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page
    .getByRole("button", { name: "Load demo data", exact: true })
    .click();
  await expect(page.getByText(/133 transactions stored/)).toBeVisible();
  await page.getByRole("button", { name: "Light", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Light", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  for (const width of [320, 390, 430, 768, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    for (const route of [
      "/",
      "/analysis",
      "/property",
      "/transactions",
      "/settings",
    ]) {
      await gotoRoute(page, route);
      await expect(page.locator("h1")).toHaveText(
        route === "/"
          ? "Overview"
          : route === "/analysis"
            ? "Analyse"
            : route === "/property"
              ? "Property"
              : route === "/transactions"
                ? "Transactions"
                : "Settings",
      );
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        )
        .toBe(true);
      const overlap = await page.locator(".toolbar").evaluateAll((toolbars) =>
        toolbars.some((toolbar) => {
          const rects = [...toolbar.querySelectorAll("button, input, select")]
            .map((el) => el.getBoundingClientRect())
            .filter((r) => r.width && r.height);
          return rects.some((r, i) =>
            rects
              .slice(i + 1)
              .some(
                (s) =>
                  r.left < s.right - 1 &&
                  r.right > s.left + 1 &&
                  r.top < s.bottom - 1 &&
                  r.bottom > s.top + 1,
              ),
          );
        }),
      );
      expect(overlap, `${route} at ${width}px`).toBe(false);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of ["/", "/analysis", "/transactions", "/settings"]) {
    await gotoRoute(page, route);
    await expect(page.locator("h1")).toHaveText(
      route === "/"
        ? "Overview"
        : route === "/analysis"
          ? "Analyse"
          : route === "/property"
            ? "Property"
            : route === "/transactions"
              ? "Transactions"
              : "Settings",
    );
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });
    // ResizeObserver-driven charts settle after the font/layout change.
    await expect
      .poll(
        () =>
          page.evaluate(() => ({
            overflow: Math.max(
              0,
              document.documentElement.scrollWidth - innerWidth,
            ),
            outside: [...document.querySelectorAll("body *")]
              .filter((el) => {
                const r = el.getBoundingClientRect();
                return (
                  r.width > 0 &&
                  r.right > innerWidth &&
                  !el.closest(".chart-data, .table-scroll")
                );
              })
              .slice(0, 8)
              .map((el) => ({
                tag: el.tagName,
                class: String(el.className),
                right: el.getBoundingClientRect().right,
              })),
          })),
        { message: `${route} enlarged text` },
      )
      .toMatchObject({ overflow: 0 });
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "";
    });
  }
  // A wider fallback font reproduces the long-title overflow seen on CI WebKit.
  await gotoRoute(page, "/transactions");
  await expect(page.locator("h1")).toHaveText("Transactions");
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "230%";
    document.documentElement.style.fontFamily = "serif";
  });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    )
    .toBe(0);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "";
    document.documentElement.style.fontFamily = "";
  });
  await gotoRoute(page, "/analysis");
  await page
    .getByRole("combobox", { name: "Period", exact: true })
    .selectOption("custom");
  await page.getByLabel("From", { exact: true }).fill("2026-09-30");
  await page.getByLabel("To", { exact: true }).fill("2026-09-01");
  await expect(page.getByText(/Choose a valid date range/)).toBeVisible();
  await page.getByLabel("From", { exact: true }).fill("2026-09-01");
  await page.getByLabel("To", { exact: true }).fill("2026-09-30");
  await expect(page.getByText(/2026-09-01 to 2026-09-30/)).toBeVisible();
});

test("personal rule corrections update existing transactions and future imports locally", async ({
  page,
}) => {
  await openImport(page);
  await selectStatement(page, "barclays");
  await expect(
    page.getByText("✓ Statement reconciled", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "To check (0)", exact: true }),
  ).toBeVisible();
  await confirmImport(page);
  await gotoRoute(page, "/settings");
  await page
    .getByLabel("Import personal rules", { exact: true })
    .setInputFiles({
      name: "synthetic-rules.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({
          format: "feng-finance-rules",
          version: 1,
          categories: [],
          rules: [
            {
              name: "My household purchases",
              match: "contains",
              pattern: "JOHN LEWIS",
              direction: "negative",
              categoryId: "household",
            },
          ],
        }),
      ),
    });
  await expect(
    page.getByRole("heading", { name: "1 transactions to update" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Apply corrections & remember rules" })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "1 transactions updated" }),
  ).toBeVisible();
  await gotoRoute(page, "/");
  await expect(page.locator('input[type="month"]')).toHaveValue("2026-09");
  await page.getByRole("link", { name: /Household £1,200.00/ }).click();
  await expect(
    page.getByRole("link", { name: /JOHN LEWIS LONDON STORE/ }),
  ).toBeVisible();
  await openImport(page);
  await selectStatement(page, "barclays-october");
  await expect(
    page.getByText("✓ Statement reconciled", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /All transactions/ }).click();
  await page.locator(".review-row > summary").click();
  await expect(page.getByLabel("Category", { exact: true })).toHaveValue(
    "household",
  );
  await confirmImport(page);
  await page.getByRole("button", { name: "View dashboard" }).click();
  await expect(page.locator('input[type="month"]')).toHaveValue("2026-10");
});

test("swipe, drag-to-category, grouped sorting, undo and remembered future imports", async ({
  page,
}) => {
  await openImport(page);
  await selectStatement(page, "barclays-sort");
  await expect(
    page.getByText("✓ Statement reconciled", { exact: true }),
  ).toBeVisible();
  await confirmImport(page);
  await page.getByRole("button", { name: "View dashboard" }).click();
  await expect(page.locator(".hero-number")).toHaveText("-£65.00");
  await page
    .getByRole("link", { name: /3 transactions need a category/ })
    .click();
  const row = page.getByRole("link", { name: /CORNER SHOP/ }).first();
  await row.scrollIntoViewIfNeeded();
  const rect = (await row.boundingBox())!;
  await page.mouse.move(rect.x + rect.width * 0.75, rect.y + rect.height / 2);
  await page.mouse.down();
  await page.mouse.move(rect.x + 30, rect.y + rect.height / 2, { steps: 12 });
  await page.mouse.up();
  const dialog = page.getByRole("dialog", { name: "Where does this belong?" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".sorting-card")).toContainText("CORNER SHOP");
  await dialog.getByLabel(/Also sort 1 uncategorized/).check();
  await dialog.getByLabel(/Remember this merchant/).check();
  const target = dialog.getByRole("button", {
    name: "Categorize as Groceries",
    exact: true,
  });
  await target.scrollIntoViewIfNeeded();
  const card = (await dialog.locator(".sorting-card").boundingBox())!;
  const tile = (await target.boundingBox())!;
  await page.mouse.move(card.x + card.width / 2, card.y + card.height / 2);
  await page.mouse.down();
  await page.mouse.move(tile.x + tile.width / 2, tile.y + tile.height / 2, {
    steps: 16,
  });
  await page.mouse.up();
  await expect(dialog.getByRole("status")).toContainText(
    "2 transactions → Groceries",
  );
  await expect(dialog.locator(".sorting-card")).toContainText("ANOTHER SHOP");
  await dialog.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(dialog.locator(".sorting-card")).toContainText("CORNER SHOP");
  await dialog.getByLabel(/Also sort 1 uncategorized/).check();
  await dialog.getByLabel(/Remember this merchant/).check();
  await dialog
    .getByRole("button", { name: "Categorize as Cleaning", exact: true })
    .click();
  await expect(dialog.locator(".sorting-card")).toContainText("ANOTHER SHOP");
  await dialog
    .getByRole("button", { name: "Categorize as Shopping", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "No transactions found" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await expect(page.locator(".hero-number")).toHaveText("-£65.00");
  await expect(
    page.getByRole("link", { name: /Cleaning £50.00/ }),
  ).toBeVisible();
  await openImport(page);
  await selectStatement(page, "barclays-sort-next");
  await expect(
    page.getByText("✓ Statement reconciled", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /All transactions/ }).click();
  await page.locator(".review-row > summary").click();
  await expect(page.getByLabel("Category", { exact: true })).toHaveValue(
    "cleaning",
  );
});

test("uncategorized card tap, cancelled drag, keyboard categorization and month swipes", async ({
  page,
}) => {
  await openImport(page);
  await selectStatement(page, "barclays-sort");
  await expect(
    page.getByText("✓ Statement reconciled", { exact: true }),
  ).toBeVisible();
  await confirmImport(page);
  await gotoRoute(page, "/transactions?uncategorized=1&month=2026-09");
  await page.getByRole("link", { name: /ANOTHER SHOP/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const card = (await dialog.locator(".sorting-card").boundingBox())!;
  await page.mouse.move(card.x + 40, card.y + 30);
  await page.mouse.down();
  await page.mouse.move(5, 5, { steps: 12 });
  await page.mouse.up();
  await expect(dialog.locator(".sorting-card")).toContainText("ANOTHER SHOP");
  await dialog.getByRole("button", { name: "Close categorization" }).click();
  const row = page.getByRole("link", { name: /ANOTHER SHOP/ });
  await row.focus();
  await page.keyboard.press("c");
  await expect(dialog).toBeVisible();
  const category = dialog.getByRole("button", {
    name: "Categorize as Shopping",
    exact: true,
  });
  await category.focus();
  await page.keyboard.press("Enter");
  await expect(dialog.getByRole("status")).toContainText(
    "1 transaction → Shopping",
  );
  await dialog.getByRole("button", { name: "Close categorization" }).click();
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await expect(page.locator('input[type="month"]')).toHaveValue("2026-09");
  const picker = (await page.locator(".month-picker").boundingBox())!;
  await page.mouse.move(
    picker.x + picker.width - 55,
    picker.y + picker.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(picker.x + 55, picker.y + picker.height / 2, {
    steps: 12,
  });
  await page.mouse.up();
  await expect(page.locator('input[type="month"]')).toHaveValue("2026-10");
});

test("subscription notification centre supports review, cancellation plans and persistent decisions", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Try fictitious demo data/ }).click();
  await page.getByRole("link", { name: /Subscription review/ }).click();
  await expect(
    page.getByRole("heading", { name: "Subscription review", exact: true }),
  ).toBeVisible();
  const netflix = page.getByRole("article", { name: "NETFLIX", exact: true });
  await expect(netflix).toBeVisible();
  await netflix.locator(".subscription-swipe").scrollIntoViewIfNeeded();
  const box = (await netflix.locator(".subscription-swipe").boundingBox())!;
  await page.mouse.move(box.x + box.width - 25, box.y + 30);
  await page.mouse.down();
  await page.mouse.move(box.x + 25, box.y + 30, { steps: 12 });
  await page.mouse.up();
  await expect(
    netflix.getByRole("button", { name: "Cancel next", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    netflix.getByText("Finish cancellation with the provider"),
  ).toBeVisible();
  await netflix
    .getByRole("button", { name: "I cancelled", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Cancellation plans", exact: true })
    .click();
  await expect(
    netflix.getByRole("button", { name: "I cancelled", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await page.getByRole("button", { name: "All detected", exact: true }).click();
  await expect(
    netflix.getByRole("button", { name: "I cancelled", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await netflix.locator("summary").click();
  await expect(netflix.locator(".subscription-evidence").first()).toBeVisible();
  await netflix.getByRole("button", { name: "Review", exact: true }).click();
  await expect(
    netflix.getByRole("button", { name: "Review", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
  }
});

test("Barclays blank dates retain every grouped transaction across pages", async ({
  page,
}) => {
  await openImport(page);
  await selectStatement(page, "barclays-grouped");
  await expect(
    page.getByText("✓ Statement reconciled", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /All transactions/ }).click();
  await expect(page.locator(".review-row")).toHaveCount(6);
  await confirmImport(page);
  await gotoRoute(page, "/settings");
  const downloaded = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export Feng Finance Backup", exact: true })
    .click();
  const path = await (await downloaded).path();
  const backup = JSON.parse(await readFile(path!, "utf8"));
  expect(
    backup.transactions
      .map((t: { date: string; amount: number }) => [t.date, t.amount])
      .sort(),
  ).toEqual(
    [
      ["2026-09-03", -1000],
      ["2026-09-03", 20000],
      ["2026-09-03", -3000],
      ["2026-09-03", -4000],
      ["2026-09-03", -2000],
      ["2026-09-04", -5000],
    ].sort(),
  );
  expect(backup.statements[0]).toMatchObject({
    transactionCount: 6,
    openingBalance: 100000,
    closingBalance: 105000,
    validationStatus: "reconciled",
    parserVersion: "1.0.3",
  });
  expect(
    backup.transactions.find((t: { description: string }) =>
      t.description.includes("EXAMPLE COUNCIL"),
    ).sourcePage,
  ).toBe(2);
  expect(
    backup.transactions.every(
      (t: { description: string }) =>
        !t.description.includes("ACCOUNT NUMBER") &&
        !t.description.includes("REGISTERED IN ENGLAND"),
    ),
  ).toBe(true);
});

test("category overview, income shares, central Home navigation and page palettes", async ({
  page,
}) => {
  await page.route("**/assets/Import-*.js", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 200));
    await route.continue();
  });
  await gotoRoute(page, "/settings");
  await page
    .getByRole("button", { name: "Load demo data", exact: true })
    .click();
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await expect(page.locator('nav[aria-label="Main navigation"] a')).toHaveText([
    "Import",
    "Transactions",
    "Home",
    "Analyse",
    "Settings",
  ]);
  await expect(page.locator(".property-card")).toHaveCount(0);
  const palette = () =>
    page
      .locator(".app")
      .evaluate((el) =>
        getComputedStyle(el).getPropertyValue("--accent").trim(),
      );
  const home = await palette();
  await page.locator('input[type="month"]').fill("2026-09");
  await page
    .getByRole("button", { name: "Share of income", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Share of income", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.locator(".category-row").filter({ hasText: "Shopping" }).click();
  await expect(
    page.getByRole("heading", { name: "Shopping", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Monthly average", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Share of income spent", { exact: true }),
  ).toBeVisible();
  expect(await palette()).not.toBe(home);
  await page.getByRole("button", { name: "12 months", exact: true }).click();
  await page
    .getByText("Average and standard deviation explained", { exact: true })
    .click();
  await expect(page.getByText(/Sample standard deviation:/)).toBeVisible();
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
  }
  await page
    .getByRole("link", { name: "View all transactions", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Transactions", exact: true }),
  ).toBeVisible();
  const transactions = await palette();
  expect(transactions).not.toBe(home);
  await page.getByRole("link", { name: "Import", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Import statements", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".app")).toHaveAttribute("data-page", "import");
  expect(await palette()).not.toBe(transactions);
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".app")).toHaveAttribute("data-page", "home");
  expect(await palette()).toBe(home);
});

test("navigation consistently selects the owning section for every route", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Try fictitious demo data" }).click();
  await page.locator(".category-row").filter({ hasText: "Shopping" }).click();
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await expect(
    page.getByRole("heading", { name: "Shopping", exact: true }),
  ).toBeVisible();
  await expect(nav.locator('[aria-current="page"]')).toHaveText("Analyse");
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await expect(nav.locator('[aria-current="page"]')).toHaveText("Home");
  await page.goForward();
  await expect(
    page.getByRole("heading", { name: "Shopping", exact: true }),
  ).toBeVisible();
  await expect(nav.locator('[aria-current="page"]')).toHaveText("Analyse");
  for (const [path, label, palette] of [
    ["/", "Home", "home"],
    ["/import", "Import", "import"],
    ["/transactions", "Transactions", "transactions"],
    ["/transactions/missing", "Transactions", "transactions"],
    ["/analysis", "Analyse", "analysis"],
    ["/property", "Analyse", "analysis"],
    ["/subscriptions", "Analyse", "analysis"],
    ["/categories/shopping?month=2026-09", "Analyse", "analysis"],
    ["/settings", "Settings", "settings"],
    ["/unknown", "Home", "home"],
  ]) {
    await gotoRoute(page, path);
    await expect(nav.locator('[aria-current="page"]')).toHaveText(label);
    await expect(nav.locator(".active")).toHaveCount(1);
    await expect(page.locator(".app")).toHaveAttribute("data-page", palette);
  }
  await expect(page).toHaveURL(/#\/$/);
  await gotoRoute(page, "/property");
  await page.getByRole("link", { name: "← Analyse", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Analyse", exact: true }),
  ).toBeVisible();
  await expect(nav.locator('[aria-current="page"]')).toHaveText("Analyse");
});
