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
test("Salary and Income filters agree with cash flow and verified balance", async ({
  page,
}) => {
  await openImport(page);
  await selectStatement(page, "barclays-income");
  await confirmImport(page);
  await expect(page.locator(".hero")).toContainText("+£4,126.00");
  await expect(page.locator(".hero")).toContainText("£4,226.00");
  await expect(page.locator(".balance-summary")).toContainText("£5,126.00");
  await page
    .getByRole("link", { name: /2 transactions need a category/ })
    .click();
  await page.getByRole("link", { name: /FICTIONAL EMPLOYER/ }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Categorize as Salary", exact: true })
    .click();
  await page.getByRole("button", { name: "Income", exact: true }).click();
  await expect(
    page.getByRole("link", { name: /FICTIONAL EMPLOYER/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /FICTIONAL INCOME/ }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /WAITROSE/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Salary", exact: true }).click();
  await expect(
    page.getByRole("link", { name: /FICTIONAL EMPLOYER/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /FICTIONAL INCOME/ }),
  ).toHaveCount(0);
  // Reproduce a legacy label mismatch without changing source amounts/balances.
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("feng-finance");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const tx = database.transaction("transactions", "readwrite");
          const table = tx.objectStore("transactions");
          const records = table.getAll();
          records.onsuccess = () => {
            for (const t of records.result)
              if (t.amount > 0) table.put({ ...t, type: "expense" });
          };
          tx.oncomplete = () => {
            database.close();
            resolve();
          };
          tx.onerror = () => {
            database.close();
            reject(tx.error);
          };
        };
      }),
  );
  await page.reload();
  await page.getByRole("button", { name: "Income", exact: true }).click();
  await expect(
    page.getByRole("link", { name: /FICTIONAL EMPLOYER/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /FICTIONAL INCOME/ }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await expect(page.locator(".hero")).toContainText("+£4,126.00");
  await expect(page.locator(".balance-summary")).toContainText("£5,126.00");
});
test("Planning budgets persist, recurring timeline and forecast horizons stay connected", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-10-07T12:00:00Z"));
  for (const month of ["07", "08", "09"]) {
    await openImport(page);
    await selectStatement(page, `barclays-planning-${month}`);
    await confirmImport(page);
  }
  await page.getByRole("link", { name: /Plan ahead/ }).click();
  await expect(
    page.getByRole("heading", { name: "Planning", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".app")).toHaveAttribute("data-page", "planning");
  await expect(page.locator(".mobile-planning")).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.locator(".forecast-card")).toContainText("£3,000.00");
  await expect(page.locator(".payment-timeline")).toContainText("NETFLIX");
  await expect(page.locator(".payment-timeline")).toContainText("2026-10-10");
  await expect(page.locator(".forecast-card")).toContainText("2026-11-06");
  await page
    .getByRole("button", { name: "Set Groceries budget", exact: true })
    .click();
  await page
    .getByLabel("Groceries monthly budget", { exact: true })
    .fill("100");
  await page.getByRole("button", { name: "Save budget", exact: true }).click();
  const groceries = page.locator(".budget-card").filter({
    has: page.getByRole("heading", { name: "Groceries", exact: true }),
  });
  await expect(groceries).toContainText("£10.00 over budget");
  await gotoRoute(page, "/settings");
  const backupEvent = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export Feng Finance Backup", exact: true })
    .click();
  const backup = await backupEvent;
  const bytes = await readFile((await backup.path())!);
  expect(JSON.parse(bytes.toString()).settings).toContainEqual({
    key: "budget:GBP:groceries",
    value: "10000",
  });
  await page
    .getByLabel("Restore Feng Finance Backup", { exact: true })
    .setInputFiles({
      name: "plan-backup.json",
      mimeType: "application/json",
      buffer: bytes,
    });
  await page.getByLabel(/I understand that this replaces/).check();
  await page
    .getByRole("button", { name: "Replace data with backup", exact: true })
    .click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Backup restored successfully." }),
  ).toBeVisible();
  await gotoRoute(page, "/planning");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Edit Groceries budget", exact: true }),
  ).toHaveText("£100.00");
  await page.getByRole("button", { name: "Next month", exact: true }).click();
  await expect(groceries).toContainText("£100.00 remaining");
  await page.getByLabel("Forecast horizon", { exact: true }).selectOption("90");
  await expect(page.locator(".forecast-card")).toContainText("2027-01-05");
  await expect(page.locator(".forecast-card")).toContainText("£9,000.00");
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
  }
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await page.getByRole("link", { name: /Plan ahead/ }).click();
  await expect(
    page.getByLabel("Forecast horizon", { exact: true }),
  ).toHaveValue("30");
  await page.setViewportSize({ width: 1440, height: 900 });
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await expect(
    nav.getByRole("link", { name: "Planning", exact: true }),
  ).toHaveAttribute("aria-current", "page");
});
test("verified deeper insights, statement reminders and private calendar export", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-10-07T12:00:00Z"));
  for (const month of ["04", "05", "06", "07"]) {
    await openImport(page);
    await selectStatement(page, `barclays-deeper-${month}`);
    await confirmImport(page);
  }
  await expect(page.locator(".deeper-insights")).toContainText(
    "Income is lower than usual",
  );
  await expect(page.locator(".deeper-insights")).toContainText(
    "Shopping +£400.00",
  );
  await expect(page.locator(".finance-reminders")).toContainText(
    "2026-09 or later",
  );
  const choose = page.waitForEvent("filechooser");
  await page
    .locator(".finance-reminders")
    .getByRole("button", { name: /Update/ })
    .click();
  await (await choose).setFiles([]);
  await gotoRoute(page, "/analysis");
  await expect(page.locator(".deeper-insights")).toContainText(
    "Larger payment to JOHN LEWIS",
  );
  await gotoRoute(page, "/settings");
  await page
    .getByLabel("Monthly statement review day", { exact: true })
    .selectOption("7");
  const exported = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export calendar reminders", exact: true })
    .click();
  const file = await exported;
  expect(file.suggestedFilename()).toBe("feng-finance-reminders.ics");
  const calendar = await readFile((await file.path())!, "utf8");
  expect(calendar).toContain("RRULE:FREQ=MONTHLY");
  expect(calendar).toContain("20261007T090000");
  expect(calendar).not.toContain("JOHN LEWIS");
  expect(calendar).not.toContain("Barclays");
  await page.getByLabel("Show statement and bill reminders").uncheck();
  await expect(
    page.getByRole("button", {
      name: "Export calendar reminders",
      exact: true,
    }),
  ).toBeDisabled();
  await page.reload();
  await expect(
    page.getByLabel("Monthly statement review day", { exact: true }),
  ).toHaveValue("7");
  await expect(
    page.getByLabel("Show statement and bill reminders"),
  ).not.toBeChecked();
  await gotoRoute(page, "/");
  await expect(page.locator(".finance-reminders")).toHaveCount(0);
});
test("desktop row drag opens suggested categories and drop saves without a second drag", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openImport(page);
  await selectStatement(page, "barclays-drag");
  await confirmImport(page);
  await page
    .getByRole("link", { name: /3 transactions need a category/ })
    .click();
  const row = page.getByRole("link", { name: /FICTIONAL WATER/ });
  await expect(row.locator(".transaction-icon")).toHaveCount(0);
  await row.scrollIntoViewIfNeeded();
  const rect = (await row.boundingBox())!;
  await page.mouse.move(rect.x + 90, rect.y + rect.height / 2);
  await page.mouse.down();
  await page.mouse.move(rect.x + 94, rect.y + rect.height / 2);
  const dialog = page.getByRole("dialog", { name: "Where does this belong?" });
  await expect(dialog).toHaveCount(0);
  await page.mouse.move(rect.x + 120, rect.y + rect.height / 2, { steps: 4 });
  await expect(dialog).toBeVisible();
  const suggested = dialog.getByRole("region", {
    name: "Suggested categories",
  });
  const target = suggested.getByRole("button", {
    name: "Categorize as Utilities",
    exact: true,
  });
  await expect(target).toBeVisible();
  const tile = (await target.boundingBox())!;
  await page.mouse.move(tile.x + tile.width / 2, tile.y + tile.height / 2, {
    steps: 12,
  });
  await expect(target).toHaveClass(/drop-target/);
  await page.mouse.up();
  await expect(dialog).toHaveCount(0);
  await expect(row).toHaveCount(0);
  await expect(page.locator(".transaction-status.uncategorized")).toHaveCount(
    2,
  );
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Close categorization" }).click();
  await expect(row).toBeVisible();
  const remaining = page.getByRole("link", { name: /UNKNOWN MERCHANT/ });
  await remaining.scrollIntoViewIfNeeded();
  const box = (await remaining.boundingBox())!;
  await page.mouse.move(box.x + 90, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 120, box.y + box.height / 2, { steps: 4 });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("region", { name: "Suggested categories" }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".transaction-status.uncategorized")).toHaveCount(
    3,
  );
  await row.scrollIntoViewIfNeeded();
  const transferRect = (await row.boundingBox())!;
  await page.mouse.move(
    transferRect.x + 90,
    transferRect.y + transferRect.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    transferRect.x + 120,
    transferRect.y + transferRect.height / 2,
    { steps: 4 },
  );
  const transfer = dialog.getByRole("button", {
    name: "Categorize as Transfer",
    exact: true,
  });
  await expect(transfer).toBeVisible();
  const transferTile = (await transfer.boundingBox())!;
  await page.mouse.move(
    transferTile.x + transferTile.width / 2,
    transferTile.y + transferTile.height / 2,
    { steps: 10 },
  );
  await page.mouse.up();
  await expect(dialog).toHaveCount(0);
  await expect(row).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText(
    "1 transaction → Transfer",
  );
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await expect(page.locator(".hero-number")).toHaveText("-£50.00");
  await page.getByRole("link", { name: "Transactions", exact: true }).click();
  await expect(row).toContainText("Transfer");
});
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
  await expect(page.locator(".hero-number")).toContainText("£");
  await gotoRoute(page, "/settings");
  await page.getByLabel("Global currency", { exact: true }).selectOption("EUR");
  await expect(page.getByLabel("Global currency", { exact: true })).toHaveValue(
    "EUR",
  );
  await gotoRoute(page, "/");
  await expect(
    page.locator(".hero-number").getByText("-€22.22", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.locator(".hero-number")).toHaveText("-€22.22");
  for (const route of [
    "/transactions",
    "/analysis",
    "/categories/shopping",
    "/subscriptions",
    "/import",
  ]) {
    await gotoRoute(page, route);
    await expect(
      page.getByLabel("Global currency", { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByLabel("Dashboard currency", { exact: true }),
    ).toHaveCount(0);
  }
  await gotoRoute(page, "/settings");
  await expect(page.getByLabel("Global currency", { exact: true })).toHaveValue(
    "EUR",
  );
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export Feng Finance Backup", exact: true })
    .click();
  const downloaded = await downloadPromise;
  const backupPath = await downloaded.path();
  expect(backupPath).not.toBeNull();
  const backup = JSON.parse(await readFile(backupPath!, "utf8"));
  expect(backup.settings).toContainEqual({ key: "currency", value: "EUR" });
  await page.getByLabel("Global currency", { exact: true }).selectOption("GBP");
  await gotoRoute(page, "/");
  await expect(page.locator(".hero-number")).toHaveText("+£5,588.65");
});
test("Barclaycard issue date, two reading columns and repayment exclusion", async ({
  page,
}) => {
  await openImport(page);
  await selectStatement(page, "barclays-card-payment");
  await confirmImport(page);
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
  await page.locator('input[type="month"]').fill("2026-09");
  await expect(page.locator(".hero-number")).toHaveText("-£109.68");
  await page.getByRole("link", { name: "Transactions", exact: true }).click();
  await expect(page.getByRole("link", { name: /\+£900\.00/ })).toContainText(
    "Transfer",
  );
  await expect(page.getByRole("link", { name: /-£900\.00/ })).toContainText(
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
  await page.getByRole("link", { name: "Transactions", exact: true }).click();
  const quick = page.getByRole("group", {
    name: "Transaction category filters",
  });
  await expect(quick.getByRole("button")).toHaveText([
    "Uncategorized",
    "Groceries",
    "Income",
    "Property",
    "Salary",
  ]);
  for (const [name, count] of [
    ["Groceries", 2],
    ["Income", 2],
    ["Property", 4],
    ["Salary", 1],
  ] as const) {
    await quick.getByRole("button", { name, exact: true }).click();
    await expect(page.locator(".transaction-row")).toHaveCount(count);
  }
  await quick.getByRole("button", { name: "Salary", exact: true }).click();
  await expect(page.locator(".transaction-row")).toHaveCount(19);
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
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText(
    "2 transactions → Groceries",
  );
  await expect(page.getByRole("link", { name: /CORNER SHOP/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(dialog.locator(".sorting-card")).toContainText("CORNER SHOP");
  await dialog.getByLabel(/Also sort 1 uncategorized/).check();
  await dialog.getByLabel(/Remember this merchant/).check();
  await dialog
    .getByRole("button", { name: "Categorize as Cleaning", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("link", { name: /ANOTHER SHOP/ }).click();
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
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText(
    "1 transaction → Shopping",
  );
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
  await expect(
    page.locator('nav[aria-label="Main navigation"] a:visible'),
  ).toHaveText(["Import", "Transactions", "Home", "Analyse", "Settings"]);
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
  await openImport(page);
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
    ["/planning", "Planning", "planning"],
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

test("Home selects PDFs immediately and completed imports return Home", async ({
  page,
}) => {
  await page.goto("/");
  const choose = page.waitForEvent("filechooser");
  await page
    .getByRole("button", { name: "Import statement", exact: true })
    .click();
  await (await choose).setFiles(fixture("barclays-sort"));
  await expect(
    page.getByRole("heading", { name: "Barclays detected" }),
  ).toBeVisible();
  await confirmImport(page);
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation").locator('[aria-current="page"]'),
  ).toHaveText("Home");
  await expect(page.locator(".balance-total")).toHaveText("£935.00");
  await expect(
    page.getByRole("img", {
      name: "1 month total and individual account balance history",
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Browse all categories", { exact: true }),
  ).toHaveCount(0);
  const balanceCard = page.locator(".balance-summary");
  await balanceCard.getByRole("button", { name: "3m", exact: true }).click();
  await expect(
    page.getByRole("img", {
      name: "3 month total and individual account balance history",
    }),
  ).toBeVisible();
  await expect(page.locator(".balance-chart .section-heading")).toContainText(
    "3 months",
  );
  await balanceCard.getByRole("button", { name: "1m", exact: true }).click();
  await expect(
    page.locator(".balance-chart .recharts-line-curve").first(),
  ).toHaveAttribute("d", /L/);
  await page.setViewportSize({ width: 1440, height: 900 });
  const settingsPosition = await page
    .getByRole("navigation")
    .getByRole("link", { name: "Settings", exact: true })
    .boundingBox();
  expect(settingsPosition!.y).toBeGreaterThan(750);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByText("View chart values", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("Local data", { exact: true })).toHaveCount(0);
  await expect(
    page.getByText("Personal finances", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Your accounts", exact: true }),
  ).toHaveCount(0);
  await page
    .locator(".category-row")
    .filter({ hasText: "Uncategorized" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Transactions", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Your accounts", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".transaction-status.uncategorized")).toHaveCount(
    3,
  );
  await page.getByRole("link", { name: /ANOTHER SHOP/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("button", {
      name: "Categorize as Mortgage / financing",
      exact: true,
    }),
  ).toHaveCount(0);
  await dialog
    .getByRole("button", { name: "Categorize as Property", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("link", { name: /ANOTHER SHOP/ })).toHaveCount(0);
  await expect(page.locator(".transaction-status.uncategorized")).toHaveCount(
    2,
  );
  const filters = page.getByRole("group", {
    name: "Transaction category filters",
  });
  await filters.getByRole("button", { name: "Property", exact: true }).click();
  await expect(page.getByRole("link", { name: /ANOTHER SHOP/ })).toBeVisible();
  await expect(page.locator(".transaction-status.categorized")).toHaveCount(1);
  await filters
    .getByRole("button", { name: "Uncategorized", exact: true })
    .click();
  await expect(page.getByRole("link", { name: /ANOTHER SHOP/ })).toHaveCount(0);
  await page.getByRole("link", { name: "Analyse", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "Property analysis", exact: true }),
  ).toHaveCount(0);
  await page
    .getByLabel("Category analysis", { exact: true })
    .selectOption("property");
  await expect(
    page.getByRole("heading", { name: "Property", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Share of income spent", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Monthly average", { exact: true }),
  ).toBeVisible();
});

test("Uncategorized queue spans imported months and saves immediately disappear", async ({
  page,
}) => {
  await openImport(page);
  await selectStatement(page, "barclays-sort");
  await confirmImport(page);
  await openImport(page);
  await selectStatement(page, "barclays-sort-next");
  await confirmImport(page);
  await gotoRoute(page, "/transactions");
  await page
    .getByRole("group", { name: "Transaction category filters" })
    .getByRole("button", { name: "Uncategorized", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "All dates", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".transaction-status.uncategorized")).toHaveCount(
    4,
  );
  const row = page.getByRole("link", { name: /ANOTHER SHOP/ });
  await row.click();
  await page
    .getByRole("dialog")
    .getByRole("link", { name: "View transaction details", exact: true })
    .click();
  await page.getByLabel("Category", { exact: true }).selectOption("shopping");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Transactions", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/uncategorized=1/);
  await expect(page).toHaveURL(/allDates=1/);
  await expect(page.getByRole("link", { name: /ANOTHER SHOP/ })).toHaveCount(0);
  await expect(page.locator(".transaction-status.uncategorized")).toHaveCount(
    3,
  );
});
