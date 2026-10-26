import {
  showTransferChoices,
  acceptUnverifiedStatement,
  acceptStatementWarnings,
  showAllStatements,
  showStatementDetails,
} from "./import-actions";
import {
  selectPeriod,
  saveReadableBackup,
  settingsSection,
  loadDemoUi,
} from "./flows";
import {
  test as base,
  expect,
  type Locator,
  type Page,
  acknowledgeBeta,
} from "./fixtures";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { startStaticHost, type LocalHost } from "./static-host";
import { PARSER_VERSION } from "../../src/parsers/interface";
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
test.beforeEach(async ({ page }) => {
  // October synthetic statements are historical, not future imports requiring override.
  await page.clock.setFixedTime(new Date("2026-11-08T12:00:00Z"));
});
async function gotoRoute(page: Page, path: string) {
  const origin = page.url().startsWith("http")
    ? new URL(page.url()).origin
    : "";
  await page.goto(origin + "/#" + path);
}
const fixture = (name: string) => resolve(`tests/fixtures/${name}.pdf`);
async function swipeTransactionLeft(page: Page, row: Locator) {
  // Native visibility checks include the fixed navigation's covered area.
  await row.evaluate((element) => element.scrollIntoView({ block: "center" }));
  await expect
    .poll(() =>
      row.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const hit = document.elementFromPoint(
          rect.x + rect.width * 0.75,
          rect.y + rect.height / 2,
        );
        return !!hit && element.contains(hit);
      }),
    )
    .toBe(true);
  const rect = (await row.boundingBox())!;
  await page.mouse.move(rect.x + rect.width * 0.75, rect.y + rect.height / 2);
  await page.mouse.down();
  await page.mouse.move(rect.x + 30, rect.y + rect.height / 2, { steps: 12 });
  await page.mouse.up();
}
async function expectTransactionCount(page: Page, count: number) {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise<number>((resolve, reject) => {
            const request = indexedDB.open("feng-finance");
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
              const database = request.result;
              const transaction = database.transaction(
                "transactions",
                "readonly",
              );
              const records = transaction.objectStore("transactions").count();
              records.onsuccess = () => {
                database.close();
                resolve(records.result);
              };
              records.onerror = () => {
                database.close();
                reject(records.error);
              };
            };
          }),
      ),
    )
    .toBe(count);
}
async function closeCategorySheet(page: Page) {
  const dialog = page.getByRole("dialog", { name: "Where does this belong?" });
  if (await dialog.isVisible())
    await dialog.getByRole("button", { name: "Close categorisation" }).click();
}
async function openStatementCard(page: Page, bank: string) {
  await expect(
    page.getByRole("group", { name: "Statement view", exact: true }),
  ).toBeVisible({
    timeout: 90000,
  });
  await showAllStatements(page);
  const card = page.locator(".import-statement-card").filter({
    has: page.getByRole("heading", { name: bank, exact: true }),
  });
  if (!(await card.evaluate((element) => (element as HTMLDetailsElement).open)))
    await card.locator(":scope > summary").click();
  // Legacy financial-detail journeys deliberately inspect the disclosed figures.
  await showStatementDetails(card);
  const figures = card.locator(".import-statement-figures");
  if (
    (await figures.count()) &&
    !(await figures.evaluate((element) => (element as HTMLDetailsElement).open))
  )
    await figures.locator(":scope > summary").click();
  return card;
}
test("manual category memory survives deleting imports and reimporting the same PDF", async ({
  page,
}) => {
  await openImport(page);
  await selectStatement(page, "barclays-memory");
  await confirmImport(page);
  await gotoRoute(page, "/transactions?uncategorized=true");
  await page.getByRole("link", { name: /HAMM&FULH CTAX/i }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel(/Remember this merchant/)).toHaveCount(0);
  await dialog
    .getByRole("button", { name: "Categorise as Childcare", exact: true })
    .click();
  await expect(
    page.getByText(/Future matching payments will follow/).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: /^Uncategorised \d+$/ }).click();
  const categorizedRow = page.getByRole("link", { name: /HAMM&FULH CTAX/i });
  await expect(categorizedRow.locator(".transaction-status")).toHaveText(
    "Childcare",
  );
  await expect(categorizedRow.locator(".transaction-icon")).toHaveCount(0);
  await expect(page.getByText("Categorized", { exact: true })).toHaveCount(0);
  await settingsSection(page, "danger");
  await page
    .getByLabel("I understand my imported transaction history will be deleted.")
    .check();
  await page
    .getByRole("button", { name: "Delete imported records", exact: true })
    .click();
  await expect(
    page.getByText(
      "Imported records deleted. Accounts and saved categorisation rules kept.",
    ),
  ).toBeVisible();
  await page.reload();
  await openImport(page);
  await selectStatement(page, "barclays-memory");
  await page.getByRole("button", { name: /All transactions/ }).click();
  await page.locator(".review-row > summary").click();
  await expect(
    page.getByRole("combobox", { name: "Category", exact: true }),
  ).toHaveValue("childcare");
  await page
    .getByRole("combobox", { name: "Category", exact: true })
    .selectOption("utilities");
  await confirmImport(page);
  await expect(page.locator(".position-summary")).toContainText("£845.00");
  await settingsSection(page, "danger");
  await page
    .getByLabel("I understand my imported transaction history will be deleted.")
    .check();
  await page
    .getByRole("button", { name: "Delete imported records", exact: true })
    .click();
  await expect(
    page.getByText(
      "Imported records deleted. Accounts and saved categorisation rules kept.",
    ),
  ).toBeVisible();
  await openImport(page);
  await selectStatement(page, "barclays-memory");
  await page.getByRole("button", { name: /All transactions/ }).click();
  await page.locator(".review-row > summary").click();
  await expect(
    page.getByRole("combobox", { name: "Category", exact: true }),
  ).toHaveValue("utilities");
});
test("Salary and Income filters agree with cash flow and verified balance", async ({
  page,
}) => {
  await openImport(page);
  await selectStatement(page, "barclays-income");
  await confirmImport(page);
  await expect(page.locator(".month-summary")).toContainText("+£4,126.00");
  await expect(page.locator(".month-summary")).toContainText("£4,226.00");
  await expect(page.locator(".position-summary")).toContainText("£5,126.00");
  await page
    .getByRole("link", { name: /2 transactions need a category/ })
    .click();
  await page.getByRole("link", { name: /FICTIONAL EMPLOYER/i }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Categorise as Salary", exact: true })
    .click();
  await expect(page.getByRole("dialog").locator(".sorting-card")).toContainText(
    "Fictional Income",
  );
  await closeCategorySheet(page);
  await page.getByRole("button", { name: "Income", exact: true }).click();
  await expect(
    page.getByRole("link", { name: /FICTIONAL EMPLOYER/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /FICTIONAL INCOME/i }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /WAITROSE/i })).toHaveCount(0);
  await page.getByRole("button", { name: "Salary", exact: true }).click();
  await expect(
    page
      .getByRole("link", { name: /FICTIONAL EMPLOYER/i })
      .locator(".transaction-status"),
  ).toHaveText("Salary");
  await expect(page.locator(".transaction-icon")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: /FICTIONAL EMPLOYER/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /FICTIONAL INCOME/i }),
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
    page.getByRole("link", { name: /FICTIONAL EMPLOYER/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /FICTIONAL INCOME/i }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .filter({ visible: true })
    .getByRole("link", { name: "Home", exact: true })
    .click();
  await expect(page.locator(".month-summary")).toContainText("+£4,126.00");
  await expect(page.locator(".position-summary")).toContainText("£5,126.00");
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
  await page
    .locator(".mobile-navigation")
    .getByRole("link", { name: "Planning", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Planning", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".app")).toHaveAttribute("data-page", "planning");
  await expect(
    page
      .locator(".mobile-navigation")
      .getByRole("link", { name: "Planning", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await page.getByRole("tab", { name: "Forecast", exact: true }).click();
  await expect(
    page.getByRole("tab", { name: "Forecast", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".forecast-card")).toContainText("£3,000.00");
  await expect(page.locator(".payment-timeline")).toContainText("Netflix");
  await expect(page.locator(".payment-timeline")).toContainText("10 Oct");
  await expect(page.locator(".forecast-card")).toContainText("6 Nov");
  await page.getByRole("tab", { name: "Budgets", exact: true }).click();
  await expect(
    page.getByRole("tab", { name: "Budgets", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".forecast-card")).toHaveCount(0);
  await expect(
    page.getByRole("textbox", { name: "Selected month", exact: true }),
  ).toHaveValue("2026-09");
  if (
    !(await page
      .getByRole("dialog", { name: "Monthly budget", exact: true })
      .isVisible())
  )
    await page.getByRole("button", { name: "Set budget", exact: true }).click();
  await page
    .getByLabel("Monthly rollover budget amount", { exact: true })
    .fill("100");
  await page
    .getByRole("combobox", { name: "Carry into next month", exact: true })
    .selectOption("surplus");
  await page
    .getByRole("button", { name: "Save monthly budget", exact: true })
    .click();
  const groceries = page.locator(".budget-card").filter({
    has: page.getByRole("button", { name: "Groceries", exact: true }),
  });
  await expect(groceries).toContainText("−£10.00 overspent");
  await gotoRoute(page, "/settings");
  const backupEvent = page.waitForEvent("download");
  await saveReadableBackup(page);
  const backup = await backupEvent;
  const bytes = await readFile((await backup.path())!);
  expect(JSON.parse(bytes.toString()).budgets).toContainEqual(
    expect.objectContaining({
      categoryId: "groceries",
      currency: "GBP",
      month: "2026-09",
      amountMinor: 10000,
      rollover: "surplus",
    }),
  );
  await page.getByLabel("Choose Feng backup", { exact: true }).setInputFiles({
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
  await expect(groceries).toContainText("£100.00 budget");
  await groceries
    .getByRole("button", { name: "Groceries", exact: true })
    .click();
  await expect(
    page.getByLabel("Monthly rollover budget amount", { exact: true }),
  ).toHaveValue("100.00");
  await expect(
    page.getByRole("combobox", { name: "Carry into next month", exact: true }),
  ).toHaveValue("surplus");
  await page
    .getByRole("button", { name: "Close Monthly budget", exact: true })
    .click();
  await page.getByRole("button", { name: "Next month", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Selected month", exact: true }),
  ).toHaveValue("2026-10");
  await expect(groceries).toContainText("£100.00 left");
  await page.getByRole("tab", { name: "Forecast", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Forecast horizon", exact: true })
    .selectOption("90");
  await expect(page.locator(".forecast-card")).toContainText("5 Jan 2027");
  await expect(page.locator(".forecast-card")).toContainText("£9,000.00");
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
  }
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .filter({ visible: true })
    .getByRole("link", { name: "Home", exact: true })
    .click();
  await page
    .locator(".mobile-navigation")
    .getByRole("link", { name: "Planning", exact: true })
    .click();
  await page.getByRole("tab", { name: "Forecast", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "Forecast horizon", exact: true }),
  ).toHaveValue("30");
  await page.setViewportSize({ width: 1440, height: 900 });
  const nav = page
    .getByRole("navigation", { name: "Main navigation" })
    .filter({ visible: true });
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
  await gotoRoute(page, "/analysis");
  await expect(page.locator(".deeper-insights")).toContainText(
    "Income is lower than usual",
  );
  await expect(page.locator(".deeper-insights")).toContainText(
    "Shopping +£400.00",
  );
  await expect(page.locator(".deeper-insights")).toContainText(
    "Larger payment to JOHN LEWIS",
  );
  await settingsSection(page, "reminders");
  await page
    .getByRole("combobox", {
      name: "Monthly statement review day",
      exact: true,
    })
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
  // The checkbox responds optimistically; wait for the durable write before
  // navigation can interrupt the page's in-flight IndexedDB transaction.
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise<unknown>((resolve, reject) => {
            const open = indexedDB.open("feng-finance");
            open.onerror = () =>
              reject(new Error("Could not read the test settings database."));
            open.onsuccess = () => {
              const database = open.result;
              const transaction = database.transaction("settings", "readonly");
              const stored = transaction
                .objectStore("settings")
                .get("reminders");
              transaction.oncomplete = () => {
                database.close();
                const entry = stored.result as { value: string } | undefined;
                resolve(entry ? JSON.parse(entry.value) : null);
              };
              transaction.onabort = () => {
                database.close();
                reject(
                  new Error("Could not read stored reminder preferences."),
                );
              };
            };
          }),
      ),
    )
    .toEqual({ enabled: false, day: 7 });
  await page.reload();
  await expect(
    page.getByLabel("Monthly statement review day", { exact: true }),
  ).toHaveValue("7");
  await expect(
    page.getByLabel("Show statement and bill reminders"),
  ).not.toBeChecked();
  await expect(
    page.getByRole("button", {
      name: "Export calendar reminders",
      exact: true,
    }),
  ).toBeDisabled();
});
test("desktop rows drag onto the persistent category rail, cancel safely and undo learned changes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openImport(page);
  await selectStatement(page, "barclays-drag");
  await confirmImport(page);
  await page
    .getByRole("link", { name: /3 transactions need a category/ })
    .click();
  const rail = page.getByRole("complementary", {
    name: "Category drop targets",
  });
  await expect(rail).toBeVisible();
  const row = page.getByRole("link", { name: /Fictional Water/i });
  await expect(row.locator(".transaction-icon")).toHaveCount(0);
  await row.scrollIntoViewIfNeeded();
  const rect = (await row.boundingBox())!;
  await page.mouse.move(rect.x + 90, rect.y + rect.height / 2);
  await page.mouse.down();
  await page.mouse.move(rect.x + 120, rect.y + rect.height / 2, { steps: 4 });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const target = rail
    .getByRole("region", {
      name: "Suggested categories for selection",
      exact: true,
    })
    .getByRole("button", { name: "Suggested Utilities", exact: true });
  const tile = (await target.boundingBox())!;
  await page.mouse.move(tile.x + tile.width / 2, tile.y + tile.height / 2, {
    steps: 12,
  });
  await expect(target).toHaveClass(/drop-target/);
  await page.mouse.up();
  await expect(row).toHaveCount(0);
  await expect(page.locator(".transaction-status.uncategorized")).toHaveCount(
    2,
  );
  await expect(page.locator(".ux-toast")).toContainText("Utilities");
  await expect(page.locator(".ux-toast")).toContainText(
    "Future matching payments will follow",
  );
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Where does this belong?" });
  await expect(dialog).toBeVisible();
  await closeCategorySheet(page);
  await expect(row).toBeVisible();
  const unknown = page.getByRole("link", { name: /Unknown Merchant/i });
  await unknown.scrollIntoViewIfNeeded();
  const unknownRect = (await unknown.boundingBox())!;
  await page.mouse.move(
    unknownRect.x + 90,
    unknownRect.y + unknownRect.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    unknownRect.x + 120,
    unknownRect.y + unknownRect.height / 2,
    { steps: 4 },
  );
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(page.locator(".transaction-status.uncategorized")).toHaveCount(
    3,
  );
  const transfer = rail.getByRole("button", {
    name: "Transfer / card repayment",
    exact: true,
  });
  // Position the destination before grabbing the source; its rail scrolls
  // independently, and pointer moves cannot reach a tile below the viewport.
  await transfer.evaluate((element) =>
    element.scrollIntoView({ block: "center" }),
  );
  await row.scrollIntoViewIfNeeded();
  await expect(transfer).toBeInViewport({ ratio: 1 });
  await expect
    .poll(() =>
      transfer.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const hit = document.elementFromPoint(
          rect.x + rect.width / 2,
          rect.y + rect.height / 2,
        );
        return !!hit && element.contains(hit);
      }),
    )
    .toBe(true);
  await expect
    .poll(() =>
      row.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const hit = document.elementFromPoint(
          rect.x + 90,
          rect.y + rect.height / 2,
        );
        return !!hit && element.contains(hit);
      }),
    )
    .toBe(true);
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
  await expect(transfer).toBeEnabled();
  await expect(transfer).toBeInViewport({ ratio: 1 });
  const transferTile = (await transfer.boundingBox())!;
  await page.mouse.move(
    transferTile.x + transferTile.width / 2,
    transferTile.y + transferTile.height / 2,
    { steps: 10 },
  );
  await expect(transfer).toHaveClass(/drop-target/);
  await page.mouse.up();
  await expect(row).toHaveCount(0);
  await expect(page.locator(".ux-toast")).toContainText("Transfer");
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .filter({ visible: true })
    .getByRole("link", { name: "Home", exact: true })
    .click();
  await expect(page.locator(".month-net strong")).toHaveText("−£50.00");
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .filter({ visible: true })
    .getByRole("link", { name: "Transactions", exact: true })
    .click();
  await expect(row).toContainText("Transfer");
});
async function openImport(page: Page) {
  await gotoRoute(page, "/import");
  await expect(
    page.getByRole("heading", { name: "Import statements", exact: true }),
  ).toBeVisible();
}
async function selectStatement(page: Page, name: string) {
  // This helper starts a distinct review; adding to a batch is tested separately.
  if (await page.locator(".import-statement-card").count()) {
    await page
      .getByRole("button", { name: "Discard review", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "Discard this review?", exact: true })
      .getByRole("button", { name: "Discard review", exact: true })
      .click();
    await expect(page.locator(".import-statement-card")).toHaveCount(0);
  }
  await page.getByLabel("Select statements").setInputFiles(fixture(name));
  await expect(
    page.getByRole("group", { name: "Statement view", exact: true }),
  ).toBeVisible({
    timeout: 90000,
  });
  await showAllStatements(page);
  const card = page.locator(".import-statement-card").first();
  if (!(await card.evaluate((element) => (element as HTMLDetailsElement).open)))
    await card.locator(":scope > summary").click();
  await showStatementDetails(card);
  const figures = card.locator(".import-statement-figures");
  if (
    (await figures.count()) &&
    !(await figures.evaluate((element) => (element as HTMLDetailsElement).open))
  )
    await figures.locator(":scope > summary").click();
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
  await page.clock.setFixedTime(new Date("2026-11-08T12:00:00Z"));
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
    page.getByRole("heading", { name: "Barclays", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("✓ Statement reconciled", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("10", { exact: true }).first()).toBeVisible();
  await confirmImport(page);
  await page.locator('input[type="month"]').fill("2026-09");
  await expect(page.getByText("+£2,782.35", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: /Shopping £1,200.00/ }).click();
  await expect(
    page.getByRole("heading", { name: "Shopping", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "View all transactions", exact: true })
    .click();
  await expect(page.getByRole("link", { name: /John Lewis/i })).toBeVisible();
  await page.getByRole("link", { name: /John Lewis/i }).click();
  await expect(
    page.getByRole("heading", { name: /John Lewis/i }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Category", exact: true })
    .selectOption("household");
  await expect(
    page.getByRole("combobox", { name: "Category", exact: true }),
  ).toHaveValue("household");
  await expect(page.getByLabel(/Always categorize this merchant/)).toHaveCount(
    0,
  );
  await expect(page.locator(".ux-toast")).toContainText("Transaction updated");
  await page.getByRole("link", { name: "‹ Transactions", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Transactions", exact: true }),
  ).toBeVisible();
  await settingsSection(page, "rules");
  await expect(
    page.getByText("JOHN LEWIS LONDON STORE → Household", { exact: true }),
  ).toBeVisible();
  await settingsSection(page, "danger");
  await page
    .getByLabel("I understand my imported transaction history will be deleted.")
    .check();
  await page
    .getByRole("button", { name: "Delete imported records", exact: true })
    .click();
  await expect(
    page.getByText(
      "Imported records deleted. Accounts and saved categorisation rules kept.",
    ),
  ).toBeVisible();
  await openImport(page);
  await selectStatement(page, "barclays");
  await confirmImport(page);
  await gotoRoute(page, "/transactions?category=household");
  await expect(page.getByRole("link", { name: /John Lewis/i })).toBeVisible();
  await openImport(page);
  await selectStatement(page, "barclays-october");
  await expect(
    page.getByRole("heading", { name: "Barclays", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /All transactions/ }).click();
  await page.locator(".review-row > summary").click();
  await expect(
    page.getByRole("combobox", { name: "Category", exact: true }),
  ).toHaveValue("shopping");
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
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Back to Home", exact: true }),
  ).toBeVisible();
  await selectStatement(page, "barclays-regenerated");
  await expect(page.getByText(/Overlap:/)).toBeVisible();
  await expect(page.locator(".import-outcome-footer")).toContainText(
    "0 new · 10 duplicates skipped",
  );
  await page.getByRole("button", { name: "Back to Home", exact: true }).click();
  await expectTransactionCount(page, 11);
});
test("multiple banks, transfer exclusion and currency isolation", async ({
  page,
  context,
  offlineHost,
}) => {
  await page.clock.setFixedTime(new Date("2026-10-08T12:00:00Z"));
  const publicRequests: { url: string; method: string; body: string | null }[] =
    [];
  const rateRows = ["TIME_PERIOD,CURRENCY,CURRENCY_DENOM,OBS_VALUE"];
  for (
    let day = new Date("2026-09-01T12:00:00Z");
    day <= new Date("2026-10-08T12:00:00Z");
    day.setUTCDate(day.getUTCDate() + 1)
  ) {
    if (![0, 6].includes(day.getUTCDay()))
      rateRows.push(`${day.toISOString().slice(0, 10)},GBP,EUR,0.5`);
  }
  // WebKit cannot route requests owned by a service worker. This workflow keeps
  // its real service worker for the offline checks, so intercept only the fixed
  // public-rate fetch at the page boundary. The separate privacy test blocks
  // service workers and verifies the actual HTTP request and CSP instead.
  await page.exposeFunction(
    "recordPublicRateRequest",
    (request: { url: string; method: string; body: string | null }) => {
      publicRequests.push(request);
    },
  );
  await page.addInitScript(
    ({ endpoint, csv }) => {
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const url =
          typeof input === "string"
            ? new URL(input, location.href).href
            : input instanceof URL
              ? input.href
              : input.url;
        // Offline calls still use the browser's real network/cache behavior.
        if (url !== endpoint || !navigator.onLine)
          return originalFetch(input, init);
        const method =
          init?.method ?? (input instanceof Request ? input.method : "GET");
        const body =
          init?.body !== undefined && init.body !== null
            ? String(init.body)
            : input instanceof Request
              ? (await input.clone().text()) || null
              : null;
        await (
          window as unknown as {
            recordPublicRateRequest: (request: {
              url: string;
              method: string;
              body: string | null;
            }) => Promise<void>;
          }
        ).recordPublicRateRequest({ url, method, body });
        return new Response(csv, {
          status: 200,
          headers: { "Content-Type": "text/csv" },
        });
      };
    },
    {
      endpoint:
        "https://data-api.ecb.europa.eu/service/data/EXR/D..EUR.SP00.A?lastNObservations=1020&format=csvdata",
      csv: rateRows.join("\n"),
    },
  );
  await page.goto(offlineHost.origin);
  await acknowledgeBeta(page);
  await settingsSection(page, "transfers");
  await expect(
    page.getByRole("combobox", { name: "Transfer matching", exact: true }),
  ).toHaveValue("manual");
  await openImport(page);
  await page
    .getByLabel("Select statements")
    .setInputFiles([fixture("barclays"), fixture("amex"), fixture("revolut")]);
  await expect(page.locator(".import-statement-card")).toHaveCount(3);
  await expect(page.locator(".import-outcome-footer")).toContainText("19 new");
  for (const bank of ["Barclays", "American Express", "Revolut"]) {
    const card = await openStatementCard(page, bank);
    await expect(
      card.getByText("✓ Statement reconciled", { exact: true }),
    ).toBeVisible();
  }
  const transfers = await showTransferChoices(page);
  await expect(transfers).toContainText("0 confirmed · 2 left for later");
  await transfers
    .getByRole("button", {
      name: "Link Barclays to Revolut £2,000.00",
      exact: true,
    })
    .click();
  await transfers
    .getByRole("button", {
      name: "Link Barclays to American Express £1,000.00",
      exact: true,
    })
    .click();
  await expect(transfers).toContainText("2 confirmed · 0 left for later");
  await expectTransactionCount(page, 0); // Reviewing pairs must not commit the drafts.
  await confirmImport(page);
  await expectTransactionCount(page, 19);
  await page.locator('input[type="month"]').fill("2026-09");
  // Refunds await an original purchase and never become arrival-month income.
  await expect(page.locator(".month-net strong")).toHaveText("+£5,538.65");
  await expect(page.locator(".month-income strong")).toHaveText("£7,100.00");
  await expect(page.locator(".month-spending strong")).toHaveText("£1,561.35");
  expect(publicRequests).toEqual([]);
  await openImport(page);
  await selectStatement(page, "revolut-eur");
  await expect(
    page.getByText("✓ Statement reconciled", { exact: true }),
  ).toBeVisible();
  await confirmImport(page);
  await expectTransactionCount(page, 21);
  await expect(page.locator(".month-net strong")).toHaveText("+≈£5,521.37");
  await settingsSection(page, "currency");
  await page
    .getByRole("combobox", { name: "Reporting currency", exact: true })
    .selectOption("EUR");
  await expect(
    page.getByRole("combobox", { name: "Reporting currency", exact: true }),
  ).toHaveValue("EUR");
  await gotoRoute(page, "/");
  await expect(page.locator(".month-net strong")).toHaveText("+≈€11,042.74");
  await expect(page.locator(".month-income strong")).toHaveText("≈ €14,200.00");
  await expect(page.locator(".month-spending strong")).toHaveText(
    "≈ €3,157.26",
  );
  await offlineInstalled(page);
  // WebKit's emulated offline navigation bypasses its service worker. Stopping
  // this private origin proves a real cached reload without weakening the check.
  await offlineHost.stop();
  await page.reload();
  await expect(page.locator(".month-net strong")).toHaveText("+≈€11,042.74");
  await context.setOffline(true);
  await expect(
    page.getByRole("button", { name: /Offline. Feng works offline/ }),
  ).toBeVisible();
  await expect(page.locator(".month-net strong")).toHaveText("+≈€11,042.74");
  await context.setOffline(false);
  for (const route of [
    "/transactions?month=2026-09",
    "/analysis",
    "/categories/shopping",
    "/subscriptions",
    "/import",
  ]) {
    await gotoRoute(page, route);
    await expect(
      page.getByRole("combobox", { name: "Reporting currency", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByLabel("Show accounts in", { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByLabel("Dashboard currency", { exact: true }),
    ).toHaveCount(0);
    if (route.startsWith("/transactions")) {
      // Reporting conversion must not hide foreign accounts or rewrite their rows.
      await expect(page.locator(".transaction-row")).toHaveCount(21);
      await expect(
        page.locator(".transaction-row").filter({ hasText: "RESTAURANT" }),
      ).toContainText("−€34.56");
      await expect(
        page.locator(".transaction-row").filter({ hasText: "SIEMENS" }),
      ).toContainText("+£5,000.00");
    }
  }
  await gotoRoute(page, "/settings");
  const downloadPromise = page.waitForEvent("download");
  await saveReadableBackup(page);
  const backupPath = await (await downloadPromise).path();
  expect(backupPath).not.toBeNull();
  const backup = JSON.parse(await readFile(backupPath!, "utf8"));
  expect(backup.settings).toContainEqual({ key: "currency", value: "EUR" });
  expect(backup.transferLinks).toHaveLength(2);
  expect(
    backup.transactions
      .filter(
        (transaction: { currency: string }) => transaction.currency === "EUR",
      )
      .map((transaction: { amount: number }) => transaction.amount)
      .sort((a: number, b: number) => a - b),
  ).toEqual([-3456, 1234]);
  expect(
    backup.transactions.find((transaction: { description: string }) =>
      transaction.description.includes("SIEMENS"),
    ).amount,
  ).toBe(500000);
  expect(
    backup.fxRates.some(
      (rate: { base: string; quote: string; rate: string }) =>
        rate.base === "EUR" && rate.quote === "GBP" && rate.rate === "0.5",
    ),
  ).toBe(true);
  expect(publicRequests.length).toBeGreaterThan(0);
  for (const request of publicRequests)
    expect(request).toEqual({
      url: "https://data-api.ecb.europa.eu/service/data/EXR/D..EUR.SP00.A?lastNObservations=1020&format=csvdata",
      method: "GET",
      body: null,
    });
  await settingsSection(page, "currency");
  await page
    .getByRole("combobox", { name: "Reporting currency", exact: true })
    .selectOption("GBP");
  await gotoRoute(page, "/");
  await expect(page.locator(".month-net strong")).toHaveText("+≈£5,521.37");
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
    page.getByRole("heading", { name: "Barclays", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("✓ Statement reconciled", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("2 Sep 2026 to 4 Oct 2026 · transaction coverage", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Statement issued 4 Oct", { exact: true }),
  ).toBeVisible();
  const transfers = await showTransferChoices(page);
  await transfers
    .getByRole("button", {
      name: "Link Barclays to Barclays £900.00",
      exact: true,
    })
    .click();
  await expect(transfers).toContainText("1 confirmed · 0 left for later");
  await expect(
    page.getByRole("button", { name: "Confirm import", exact: true }),
  ).toBeDisabled();
  await acceptStatementWarnings(page.locator(".import-statement-card[open]"));
  await confirmImport(page);
  await page.locator('input[type="month"]').fill("2026-09");
  // An unlinked merchant refund awaits its original purchase; it is not income.
  await expect(page.locator(".month-net strong")).toHaveText("−£114.68*");
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .filter({ visible: true })
    .getByRole("link", { name: "Transactions", exact: true })
    .click();
  await expect(page.getByRole("link", { name: /\+£900\.00/ })).toContainText(
    "Transfer",
  );
  await expect(page.getByRole("link", { name: /−£900\.00/ })).toContainText(
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
    page
      .locator(".import-statement-card > summary")
      .getByText("1 Sep 2026 to 30 Sep 2026", { exact: true }),
  ).toBeVisible();
  const statement = page.locator(".import-statement-card");
  await statement
    .getByText("Bank, account and statement dates", { exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Bank", exact: true })
    .selectOption("Barclays");
  await expect(statement).toHaveClass(/import-statement-blocking/);
  await expect(
    statement.locator(":scope > summary .ui-chip-visual"),
  ).toHaveText("Parse again");
  await expect(
    page.getByRole("button", { name: "Confirm import", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Parse again", exact: true }).click();
  await expect(
    statement.locator(":scope > summary .ui-chip-visual"),
  ).toHaveText("✓ Reconciled");
  await expect(statement).not.toHaveClass(/import-statement-blocking/);
  await selectStatement(page, "barclays-no-period");
  await expect(page.getByRole("alert")).toContainText(
    "Enter the dates printed on the PDF",
  );
  await page
    .getByRole("button", {
      name: "Enter statement dates from the source file",
      exact: true,
    })
    .click();
  await page
    .getByRole("textbox", { name: "Statement start date", exact: true })
    .fill("01/09/2026");
  await page
    .getByRole("textbox", { name: "Statement end date", exact: true })
    .fill("30/09/2026");
  await page.getByRole("button", { name: "Parse again", exact: true }).click();
  await expect(
    page.getByText("✓ Statement reconciled", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Confirm import", exact: true }),
  ).toBeDisabled();
  await acceptStatementWarnings(page.locator(".import-statement-card[open]"));
  await confirmImport(page);
  await openImport(page);
  await selectStatement(page, "barclays-october");
  await expect(
    page
      .locator(".import-statement-card > summary")
      .getByText("1 Oct 2026 to 31 Oct 2026", { exact: true }),
  ).toBeVisible();
  // Successful native statements keep technical date controls on demand.
  await statement.locator(".parse-options > summary").click();
  await expect(
    page.getByRole("button", {
      name: "Enter statement dates from the source file",
      exact: true,
    }),
  ).toBeVisible();
});
test("reconciliation warning cannot be silently committed", async ({
  page,
}) => {
  await openImport(page);
  await selectStatement(page, "barclays-warning");
  await expect(
    page
      .locator(".validation")
      .getByText("Balances don't add up", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Confirm import" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Import anyway…", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".generic-import-review")).toHaveCount(0);
  // Cancelling the explicit risk sheet never accepts the balance difference.
  await page
    .getByRole("button", { name: "Import anyway…", exact: true })
    .click();
  await page
    .getByRole("dialog", {
      name: "Import an unverified statement?",
      exact: true,
    })
    .getByRole("button", { name: "Continue reviewing", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Confirm import", exact: true }),
  ).toBeDisabled();
  await acceptUnverifiedStatement(page);
  await expect(
    page.getByRole("button", { name: "Confirm import", exact: true }),
  ).toBeEnabled();
  await confirmImport(page);
  await settingsSection(page, "statements");
  await expect(page.locator(".statement-history")).toContainText(
    "1 transaction",
  );
  await expect(page.locator(".statement-history")).toContainText("Unverified");
});
test("backup, destructive confirmation, restore and demo deletion", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-10-08T12:00:00Z"));
  await settingsSection(page, "currency");
  await page
    .getByLabel("Download daily rates (ECB)", { exact: true })
    .uncheck();
  await expect(
    page.getByRole("status").filter({ hasText: "Rate preference saved." }),
  ).toBeVisible();
  await settingsSection(page, "demo");
  await page
    .getByRole("button", { name: "Load demo data", exact: true })
    .click();
  await expectTransactionCount(page, 176);
  const downloadEvent = page.waitForEvent("download");
  await saveReadableBackup(page);
  const path = await (await downloadEvent).path();
  expect(path).toBeTruthy();
  const bytes = await readFile(path!);
  const json = JSON.parse(bytes.toString());
  expect(json.format).toBe("feng-finance");
  expect(json.schemaVersion).toBe(4);
  expect(json.accounts).toHaveLength(8);
  expect(json.transactions).toHaveLength(176);
  expect(
    json.valuations
      .map((valuation: { valueMinor: number }) => valuation.valueMinor)
      .sort((a: number, b: number) => a - b),
  ).toEqual([28000000, 45000000]);
  expect(json.pots).toHaveLength(1);
  expect(json.recurringSeries).toHaveLength(1);
  expect(
    json.transferProposals.some(
      (proposal: { status: string }) => proposal.status === "pending",
    ),
  ).toBe(true);
  expect(
    json.transactions.filter(
      (transaction: { parentId?: string }) => transaction.parentId,
    ),
  ).toHaveLength(2);
  expect(
    json.fxRates.some(
      (rate: { base: string; quote: string }) =>
        rate.base === "EUR" && rate.quote === "GBP",
    ),
  ).toBe(true);
  await settingsSection(page, "demo");
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Delete demo data", exact: true })
    .click();
  await expectTransactionCount(page, 0);
  await expect(
    page.locator(".ui-demo-chip").filter({ visible: true }),
  ).toHaveCount(0);
  // Deleting the demo removes its planning, transfer and valuation records too.
  const emptyDownload = page.waitForEvent("download");
  await saveReadableBackup(page);
  const emptyPath = await (await emptyDownload).path();
  const emptyBackup = JSON.parse(await readFile(emptyPath!, "utf8"));
  for (const table of [
    "accounts",
    "statements",
    "transactions",
    "transferLinks",
    "transferProposals",
    "valuations",
    "pots",
    "recurringSeries",
    "tags",
    "fxRates",
  ])
    expect(emptyBackup[table]).toHaveLength(0);
  await page.getByLabel("Choose Feng backup", { exact: true }).setInputFiles({
    name: "backup.json",
    mimeType: "application/json",
    buffer: bytes,
  });
  await expect(
    page
      .locator(".settings-preview .restore-count")
      .filter({ hasText: "Accounts" })
      .locator("dd"),
  ).toHaveText("8");
  await expect(
    page
      .locator(".settings-preview .restore-count")
      .filter({ hasText: "Transactions" })
      .locator("dd"),
  ).toHaveText("176");
  await expect(
    page.getByRole("button", { name: "Replace data with backup", exact: true }),
  ).toBeDisabled();
  await page.getByLabel(/I understand that this replaces/).check();
  await page
    .getByRole("button", { name: "Replace data with backup", exact: true })
    .click();
  await expectTransactionCount(page, 176);
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Backup restored successfully." }),
  ).toBeVisible();
  await expect(
    page.locator(".ui-demo-chip").filter({ visible: true }),
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
  await acknowledgeBeta(page);
  await offlineInstalled(page);
  await offlineHost.stop();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Home", exact: true }),
  ).toBeVisible();
  await openImport(page);
  await selectStatement(page, "barclays");
  await expect(
    page.getByText("✓ Statement reconciled", { exact: true }),
  ).toBeVisible();
  await confirmImport(page);
  await gotoRoute(page, "/settings");
  const event = page.waitForEvent("download");
  await saveReadableBackup(page);
  expect((await event).suggestedFilename()).toMatch(
    /^Feng \d{1,2}-[A-Za-z]{3}-\d{4}\.json$/,
  );
  expect(unexpected).toEqual([]);
});
test("scanned PDF uses bundled OCR and exact source checks offline", async ({
  page,
  offlineHost,
}) => {
  test.setTimeout(120000);
  await page.goto(offlineHost.origin);
  await acknowledgeBeta(page);
  await offlineInstalled(page);
  await offlineHost.stop();
  await openImport(page);
  await selectStatement(page, "barclays-scanned");
  await expect(
    page.getByRole("heading", { name: "Barclays", exact: true }),
  ).toBeVisible({ timeout: 90000 });
  await expect(page.getByText(/Read from images/).first()).toBeVisible();
  const proof = page.getByRole("region", {
    name: "Statement reading and checks",
  });
  await expect(proof).toContainText("Statement figures match exactly");
  await expect(proof).toContainText("Read from image");
  await expect(proof).toContainText("0 need review");
  await expect(
    page.getByRole("button", { name: "Confirm import" }),
  ).toBeEnabled();
  await expect(page.getByLabel(/I verified this transaction/)).toHaveCount(0);
  await expect(
    page.getByText("✓ Statement reconciled", { exact: true }),
  ).toBeVisible();
  await confirmImport(page);
  await gotoRoute(page, "/settings");
  const downloaded = page.waitForEvent("download");
  await saveReadableBackup(page);
  const backupPath = await (await downloaded).path();
  const backup = JSON.parse(await readFile(backupPath!, "utf8"));
  expect(backup.transactions).toHaveLength(1);
  expect(backup.transactions[0]).toMatchObject({
    amount: -8000,
    date: "2026-09-02",
    parseSource: "ocr",
    sourcePage: 1,
  });
  expect(backup.statements[0]).toMatchObject({
    openingBalance: 100000,
    closingBalance: 92000,
    validationDifference: 0,
    validationStatus: "reconciled",
    validationPolicy: "exact-v2.2",
    extractionMethod: "OCR",
  });
});
test("mobile layout, navigation, property and demo analysis are usable", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-10-08T12:00:00Z"));
  await settingsSection(page, "currency");
  await page
    .getByLabel("Download daily rates (ECB)", { exact: true })
    .uncheck();
  await expect(
    page.getByRole("status").filter({ hasText: "Rate preference saved." }),
  ).toBeVisible();
  await settingsSection(page, "demo");
  await page
    .getByRole("button", { name: "Load demo data", exact: true })
    .click();
  // Demo loading commits asynchronously and changes the shared app layout.
  // Wait for both the completed action and its live-query banner before tapping.
  await expect(
    page.getByRole("status").filter({ hasText: "Fictitious demo data added." }),
  ).toBeVisible();
  await expect(
    page.locator(".ui-demo-chip").filter({ visible: true }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .filter({ visible: true })
    .getByRole("link", { name: "Home", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();
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
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .filter({ visible: true })
    .getByRole("link", { name: "Analyse", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Analyse", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .filter({ visible: true })
    .getByRole("link", { name: "Transactions", exact: true })
    .click();
  const quick = page.getByRole("group", {
    name: "Transaction category filters",
  });
  await expect(quick.getByRole("button")).toHaveText([
    "Uncategorised 2",
    /Groceries\s*3/,
    /Income\s*3/,
    /Property\s*4/,
    /Salary\s*1/,
  ]);
  for (const [name, count] of [
    ["Groceries", 3],
    ["Income", 3],
    ["Property", 4],
    ["Salary", 1],
  ] as const) {
    await quick.getByRole("button", { name, exact: true }).click();
    await expect(page.locator(".transaction-row")).toHaveCount(count);
  }
  await quick.getByRole("button", { name: "Salary", exact: true }).click();
  // All 30 September demo source payments are historical; the extra scenarios are in the completed month.
  await expect(page.locator(".transaction-row")).toHaveCount(30);
  await expect(
    page
      .locator(".transaction-row")
      .filter({ hasText: "FICTITIOUS EURO CAFE" }),
  ).toContainText("−€45.99");
  await quick
    .getByRole("button", { name: "Uncategorised 2", exact: true })
    .click();
  await expect(page.locator(".transaction-row")).toHaveCount(2);
  await expect(page.locator(".transaction-row .transaction-status")).toHaveText(
    ["Needs category", "Needs category"],
  );
  await expect(page.locator(".transaction-row .review-status")).toHaveCount(0);
  await page.screenshot({
    path: `test-results/dashboard-${test.info().project.name}.png`,
    fullPage: true,
  });
});

test("service worker update is explicit and preserves stored records", async ({
  page,
  offlineHost,
}) => {
  await page.clock.setFixedTime(new Date("2026-10-08T12:00:00Z"));
  await page.goto(offlineHost.origin + "/#/settings");
  await acknowledgeBeta(page);
  await offlineInstalled(page);
  await settingsSection(page, "demo");
  await page
    .getByRole("button", { name: "Load demo data", exact: true })
    .click();
  await expectTransactionCount(page, 176);
  offlineHost.advanceWorker();
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) throw new Error("No installed worker");
    await registration.update();
  });
  await expect(
    page.getByRole("button", { name: "Reload", exact: true }),
  ).toHaveCount(0);
  await gotoRoute(page, "/");
  await expect(
    page.getByText("A new version of Feng is ready", { exact: true }),
  ).toBeVisible({
    timeout: 30000,
  });
  const reload = page.waitForEvent("load");
  await page.getByRole("button", { name: "Reload", exact: true }).click();
  await reload;
  await expectTransactionCount(page, 176);
  await expect(
    page.getByText("A new version of Feng is ready", { exact: true }),
  ).toHaveCount(0);
});

test("unsupported PDF is explicit and leaves the database empty", async ({
  page,
}) => {
  await openImport(page);
  await page.getByLabel("Select statements").setInputFiles({
    name: "invalid.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("This is not a PDF"),
  });
  await expect(page.getByRole("alert")).toContainText(
    "This file is not a valid PDF.",
  );
  await gotoRoute(page, "/settings");
  await expectTransactionCount(page, 0);
});

test("UK Amex and Revolut layouts reconcile, preserve dated exceptions and share one import review", async ({
  page,
}) => {
  await openImport(page);
  await page
    .getByLabel("Select statements")
    .setInputFiles([fixture("amex-uk-layout"), fixture("revolut-uk-layout")]);
  await expect(page.locator(".import-statement-card")).toHaveCount(2);
  const amex = await openStatementCard(page, "American Express");
  const revolut = page.locator(".import-statement-card").filter({
    has: page.getByRole("heading", { name: "Revolut", exact: true }),
  });
  await expect(
    page.getByRole("heading", { name: "American Express", exact: true }),
  ).toBeVisible();
  await expect(
    amex.locator(".validation").getByText("Statement needs review", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    amex
      .locator(":scope > summary")
      .getByText("6 Sep 2026 to 5 Oct 2026", { exact: true }),
  ).toBeVisible();
  await expect(
    amex.getByText(
      /transaction dates? (?:is|fall) outside the statement period/,
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Confirm import", exact: true }),
  ).toBeDisabled();
  // Out-of-period dates remain an explicit native warning; they do not require
  // reviewing every amount through the generic parser.
  await expect(amex.locator(".generic-import-review")).toHaveCount(0);
  await acceptUnverifiedStatement(page, amex);
  await openStatementCard(page, "Revolut");
  await expect(
    page.getByRole("heading", { name: "Revolut", exact: true }),
  ).toBeVisible();
  await expect(
    revolut.getByText("✓ Statement reconciled", { exact: true }),
  ).toBeVisible();
  await expect(
    revolut
      .locator(":scope > summary")
      .getByText("1 Sep 2026 to 30 Sep 2026", { exact: true }),
  ).toBeVisible();
  await expect(
    revolut.getByRole("button", { name: "About Statement reading" }),
  ).toHaveAttribute("aria-expanded", "false");
  await expect(revolut.locator(".generic-import-review")).toHaveCount(0);
  await expect(
    revolut.getByLabel(/I compared the extracted rows with the source file/),
  ).toHaveCount(0);
  // The Amex date exception was explicitly accepted above. Revolut has exact
  // source proof, so it should not demand another acknowledgment to continue.
  await expect(
    page.getByRole("button", { name: "Confirm import", exact: true }),
  ).toBeEnabled();
  await expect(
    revolut.locator(".totals > div").filter({ hasText: "Money in" }),
  ).toContainText("£950.00");
  await expect(
    revolut.locator(".totals > div").filter({ hasText: "Money out" }),
  ).toContainText("£510.00");
  // These fictional statements contain different repayment amounts, so there
  // is no pair to infer. Explicitly mark the known own-card movements instead.
  await openStatementCard(page, "American Express");
  await amex.getByRole("button", { name: /All transactions/ }).click();
  const amexPayment = amex
    .locator(".review-row")
    .filter({ hasText: "PAYMENT RECEIVED - THANK YOU" });
  if (
    !(await amexPayment.evaluate(
      (element) => (element as HTMLDetailsElement).open,
    ))
  )
    await amexPayment.locator(":scope > summary").click();
  await amexPayment
    .getByRole("combobox", { name: "Type", exact: true })
    .selectOption("transfer");
  await openStatementCard(page, "Revolut");
  await revolut.getByRole("button", { name: /All transactions/ }).click();
  const revolutPayment = revolut
    .locator(".review-row")
    .filter({ hasText: /American.*Exp|Amex/i });
  if (
    !(await revolutPayment.evaluate(
      (element) => (element as HTMLDetailsElement).open,
    ))
  )
    await revolutPayment.locator(":scope > summary").click();
  await revolutPayment
    .getByRole("combobox", { name: "Type", exact: true })
    .selectOption("transfer");
  // Marking transfers changes analytics only, not the statement's raw totals.
  await expect(
    revolut.locator(".totals > div").filter({ hasText: "Money out" }),
  ).toContainText("£510.00");
  await confirmImport(page);
  await page.locator('input[type="month"]').fill("2026-09");
  await expect(page.locator(".month-net strong")).toHaveText("+£455.00*");
  // Accepting the exception must preserve the original purchase/posting date
  // and native statement debt while leaving its verification explicitly false.
  await gotoRoute(page, "/settings");
  const downloaded = page.waitForEvent("download");
  await saveReadableBackup(page);
  const backupPath = await (await downloaded).path();
  const backup = JSON.parse(await readFile(backupPath!, "utf8"));
  const amexStatement = backup.statements.find(
    (statement: { institution: string }) =>
      statement.institution === "American Express",
  );
  expect(amexStatement).toMatchObject({
    openingBalance: -120000,
    closingBalance: -16000,
    validationDifference: 0,
    validationStatus: "warning",
    validationOverride: true,
  });
  expect(
    backup.transactions.find(
      (transaction: { statementId: string; date: string }) =>
        transaction.statementId === amexStatement.id &&
        transaction.date === "2026-09-05",
    ),
  ).toMatchObject({ date: "2026-09-05", bookingDate: "2026-09-05" });
  const revolutStatement = backup.statements.find(
    (statement: { institution: string }) => statement.institution === "Revolut",
  );
  expect(revolutStatement).toMatchObject({
    transactionCount: 6,
    openingBalance: 50000,
    closingBalance: 94000,
    validationDifference: 0,
    validationStatus: "reconciled",
    validationPolicy: "exact-v2.2",
  });
  const revolutRows = backup.transactions.filter(
    (transaction: { statementId: string }) =>
      transaction.statementId === revolutStatement.id,
  );
  expect(revolutRows).toHaveLength(6);
  expect(
    revolutRows.reduce(
      (sum: number, row: { amount: number }) => sum + Math.max(0, row.amount),
      0,
    ),
  ).toBe(95000);
  expect(
    revolutRows.reduce(
      (sum: number, row: { amount: number }) => sum + Math.max(0, -row.amount),
      0,
    ),
  ).toBe(51000);
  expect(
    revolutRows
      .filter(
        (row: { date: string; amount: number }) =>
          row.date === "2026-09-28" && row.amount === -2500,
      )
      .map((row: { sourcePage: number; balanceAfterTransaction: number }) => [
        row.sourcePage,
        row.balanceAfterTransaction,
      ])
      .sort(),
  ).toEqual([
    [2, 96500],
    [3, 94000],
  ]);
  await openImport(page);
  await selectStatement(page, "revolut-uk-layout");
  await expect(
    page.locator(".totals > div").filter({ hasText: "Money out" }),
  ).toContainText("£510.00");
  await expect(
    page.getByText("This statement has already been imported.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Confirm import", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Back to Home", exact: true }),
  ).toBeVisible();
});

test("System default, persistent appearance and mobile layouts without overlapping controls", async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.clock.setFixedTime(new Date("2026-10-08T12:00:00Z"));
  await settingsSection(page, "currency");
  await page
    .getByLabel("Download daily rates (ECB)", { exact: true })
    .uncheck();
  await expect(
    page.getByRole("status").filter({ hasText: "Rate preference saved." }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await settingsSection(page, "demo");
  await page
    .getByRole("button", { name: "Load demo data", exact: true })
    .click();
  await expectTransactionCount(page, 176);
  await settingsSection(page, "appearance");
  await expect(
    page.getByRole("button", { name: "System", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Light", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Appearance saved." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Light", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
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
          ? "Home"
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
        ? "Home"
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
  for (const font of ["serif", "DejaVu Serif, serif"]) {
    await page.evaluate((family) => {
      document.documentElement.style.fontSize = "230%";
      document.documentElement.style.fontFamily = family;
    }, font);
    await expect
      .poll(
        () =>
          page.evaluate(
            () => document.documentElement.scrollWidth - innerWidth,
          ),
        { message: `Transactions at 230% with ${font}` },
      )
      .toBe(0);
  }
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "";
    document.documentElement.style.fontFamily = "";
  });
  await gotoRoute(page, "/analysis");
  await selectPeriod(page, "custom");
  await page.getByLabel("From", { exact: true }).fill("2026-09-30");
  await page.getByLabel("To", { exact: true }).fill("2026-09-01");
  await expect(page.getByText(/Choose a valid date range/)).toBeVisible();
  await page.getByLabel("From", { exact: true }).fill("2026-09-01");
  await page.getByLabel("To", { exact: true }).fill("2026-09-30");
  await expect(page.getByText(/1 to 30 Sep 2026/)).toBeVisible();
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
  ).toHaveCount(0);
  await confirmImport(page);
  await gotoRoute(page, "/settings");
  await page.getByRole("link", { name: "Rules", exact: true }).click();
  const manager = page.locator("#categorization-rules");
  await manager
    .getByRole("button", { name: "Create rule", exact: true })
    .click();
  const editor = page.getByRole("dialog", { name: "Create rule", exact: true });
  await editor
    .getByLabel("Rule name", { exact: true })
    .fill("My household purchases");
  await editor
    .getByLabel("Condition 1 value", { exact: true })
    .fill("JOHN LEWIS");
  await editor
    .getByRole("combobox", { name: "Category", exact: true })
    .selectOption("household");
  await expect(
    editor.getByRole("heading", { name: "Matches 1 existing transaction" }),
  ).toBeVisible();
  await expect(
    editor.getByLabel("Apply to existing transactions", { exact: true }),
  ).toBeChecked();
  await editor.getByRole("button", { name: "Save rule", exact: true }).click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "1 existing transaction updated. Rule saved." }),
  ).toBeVisible();
  await gotoRoute(page, "/");
  await expect(page.locator('input[type="month"]')).toHaveValue("2026-09");
  await page.getByRole("link", { name: /Household £1,200.00/ }).click();
  await expect(page.getByRole("link", { name: /John Lewis/i })).toBeVisible();
  await openImport(page);
  await selectStatement(page, "barclays-october");
  await expect(
    page.getByText("✓ Statement reconciled", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /All transactions/ }).click();
  await page.locator(".review-row > summary").click();
  await expect(
    page.getByRole("combobox", { name: "Category", exact: true }),
  ).toHaveValue("household");
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
  await expect(page.locator(".month-net strong")).toHaveText("−£65.00");
  await page
    .getByRole("link", { name: /3 transactions need a category/ })
    .click();
  const row = page.getByRole("link", { name: /CORNER SHOP/i }).first();
  await swipeTransactionLeft(page, row);
  const dialog = page.getByRole("dialog", { name: "Where does this belong?" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".sorting-card")).toContainText("Corner Shop");
  await expect(dialog.getByLabel(/Remember this merchant/)).toHaveCount(0);
  const target = dialog.getByRole("button", {
    name: "Categorise as Groceries",
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
  await expect(dialog.locator(".sorting-card")).toContainText("Another Shop");
  await expect(page.locator(".ux-toast")).toContainText("Groceries");
  await expect(page.locator(".ux-toast")).toContainText(
    /Future matching payments will follow/,
  );
  await expect(page.getByRole("link", { name: /CORNER SHOP/i })).toHaveCount(0);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(dialog.locator(".sorting-card")).toContainText("Corner Shop");
  await expect(dialog.getByLabel(/Remember this merchant/)).toHaveCount(0);
  await dialog
    .getByRole("button", { name: "Categorise as Cleaning", exact: true })
    .click();
  await expect(dialog.locator(".sorting-card")).toContainText("Another Shop");
  await dialog
    .getByRole("button", { name: "Categorise as Shopping", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "No transactions found" }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .filter({ visible: true })
    .getByRole("link", { name: "Home", exact: true })
    .click();
  await expect(page.locator(".month-net strong")).toHaveText("−£65.00");
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
  await expect(
    page.getByRole("combobox", { name: "Category", exact: true }),
  ).toHaveValue("cleaning");
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
  await page.getByRole("link", { name: /ANOTHER SHOP/i }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const card = (await dialog.locator(".sorting-card").boundingBox())!;
  await page.mouse.move(card.x + 40, card.y + 30);
  await page.mouse.down();
  await page.mouse.move(5, 5, { steps: 12 });
  await page.mouse.up();
  await expect(dialog.locator(".sorting-card")).toContainText("Another Shop");
  await dialog.getByRole("button", { name: "Close categorisation" }).click();
  const row = page.getByRole("link", { name: /ANOTHER SHOP/i });
  await row.focus();
  await page.keyboard.press("c");
  await expect(dialog).toBeVisible();
  const category = dialog.getByRole("button", {
    name: "Categorise as Shopping",
    exact: true,
  });
  await category.focus();
  await page.keyboard.press("Enter");
  await expect(dialog.locator(".sorting-card")).toContainText("Corner Shop");
  await closeCategorySheet(page);
  await expect(page.locator(".ux-toast")).toContainText("Shopping");
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .filter({ visible: true })
    .getByRole("link", { name: "Home", exact: true })
    .click();
  await expect(page.locator('input[type="month"]')).toHaveValue("2026-09");
  const monthPicker = page.locator(".month-picker");
  // Safari's installation and local-data notices can put the picker behind
  // the fixed bottom navigation. A user scrolls it into view before swiping;
  // direct mouse coordinates do not receive Playwright's actionability checks.
  await monthPicker.evaluate((element) =>
    element.scrollIntoView({ block: "center" }),
  );
  await expect
    .poll(() =>
      monthPicker.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const y = box.y + box.height / 2;
        return [box.x + box.width - 55, box.x + 55].every((x) =>
          element.contains(document.elementFromPoint(x, y)),
        );
      }),
    )
    .toBe(true);
  const picker = (await monthPicker.boundingBox())!;
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
  await page.clock.setFixedTime(new Date("2026-10-08T12:00:00Z"));
  await settingsSection(page, "currency");
  await page
    .getByLabel("Download daily rates (ECB)", { exact: true })
    .uncheck();
  await expect(
    page.getByRole("status").filter({ hasText: "Rate preference saved." }),
  ).toBeVisible();
  await gotoRoute(page, "/");
  await page.getByRole("button", { name: /Try fictitious demo data/ }).click();
  await expectTransactionCount(page, 176);
  await expect(
    page.locator(".ui-demo-chip").filter({ visible: true }),
  ).toBeVisible();
  // Home shows the three most urgent tasks. The seeded transfer and statement
  // gaps can outrank recurring review, which remains available at its route.
  await gotoRoute(page, "/subscriptions");
  await expect(
    page.getByRole("heading", { name: "Subscriptions", exact: true }),
  ).toBeVisible();
  const netflix = page.getByRole("article", { name: /Netflix/i });
  await expect(netflix).toBeVisible();
  await expect(netflix).toContainText("£14.99");
  await expect(netflix).toContainText("£179.88 / year");
  await expect(netflix).toContainText(
    "Latest charge increased by £2.00 (+15%)",
  );
  await netflix
    .getByRole("button", { name: /About charge warnings for/i })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Recurring charge warnings" }),
  ).toContainText("median of the previous three charges");
  await page
    .getByRole("button", { name: "Close Recurring charge warnings" })
    .click();
  await netflix.locator(".subscription-swipe").scrollIntoViewIfNeeded();
  const box = (await netflix.locator(".subscription-swipe").boundingBox())!;
  await page.mouse.move(box.x + box.width - 25, box.y + 30);
  await page.mouse.down();
  await page.mouse.move(box.x + 25, box.y + 30, { steps: 12 });
  await page.mouse.up();
  await expect(
    netflix.getByRole("button", { name: "Plan to cancel", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    netflix.getByText("Finish cancellation with the provider"),
  ).toBeVisible();
  await netflix.getByText("More status options", { exact: true }).click();
  await netflix
    .getByRole("button", { name: "I cancelled", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Cancellation plans", exact: true })
    .click();
  await expect(netflix).toContainText("Marked cancelled by you");
  await page.reload();
  await page.getByRole("button", { name: "All detected", exact: true }).click();
  await netflix.getByText("More status options", { exact: true }).click();
  await expect(
    netflix.getByRole("button", { name: "I cancelled", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await netflix.getByText(/View .*charges? and source evidence/).click();
  const evidence = netflix.getByRole("group", {
    name: "Charge evidence",
    exact: true,
  });
  await expect(evidence).toBeVisible();
  await expect(evidence.getByRole("link").first()).toBeVisible();
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
  await saveReadableBackup(page);
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
    parserVersion: PARSER_VERSION,
    validationPolicy: "exact-v2.2",
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
  await settingsSection(page, "demo");
  await page
    .getByRole("button", { name: "Load demo data", exact: true })
    .click();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .filter({ visible: true })
    .getByRole("link", { name: "Home", exact: true })
    .click();
  await expect(
    page.locator('nav[aria-label="Main navigation"] a:visible'),
  ).toHaveText(["Import", "Activity", "Home", "Analyse", "Planning"]);
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
    .getByRole("button", { name: "About this category comparison" })
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
  await page.getByRole("button", { name: "Close Category comparison" }).click();
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
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .filter({ visible: true })
    .getByRole("link", { name: "Home", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Home", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".app")).toHaveAttribute("data-page", "home");
  expect(await palette()).toBe(home);
});

test("navigation consistently selects the owning section for every route", async ({
  page,
}) => {
  // This journey opens eleven pages and checks browser back/forward history.
  test.setTimeout(120000);
  await page.goto("/");
  await page.getByRole("button", { name: "Try fictitious demo data" }).click();
  await page.locator(".category-row").filter({ hasText: "Shopping" }).click();
  const nav = page
    .getByRole("navigation", { name: "Main navigation" })
    .filter({ visible: true });
  await expect(
    page.getByRole("heading", { name: "Shopping", exact: true }),
  ).toBeVisible();
  await expect(nav.locator('[aria-current="page"]')).toHaveText("Analyse");
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "Home", exact: true }),
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
    ["/transactions", "Activity", "transactions"],
    ["/transactions/missing", "Activity", "transactions"],
    ["/analysis", "Analyse", "analysis"],
    ["/planning", "Planning", "planning"],
    ["/property", "Analyse", "analysis"],
    ["/subscriptions", "Planning", "planning"],
    ["/categories/shopping?month=2026-09", "Analyse", "analysis"],
    ["/settings", "Settings", "settings"],
    ["/unknown", "Home", "home"],
  ]) {
    await gotoRoute(page, path);
    if (label === "Settings") {
      await expect(page.locator(".mobile-settings")).toHaveAttribute(
        "aria-current",
        "page",
      );
      await expect(nav.locator('[aria-current="page"]')).toHaveCount(0);
    } else {
      await expect(nav.locator('[aria-current="page"]')).toHaveText(label);
      await expect(nav.locator(".active")).toHaveCount(1);
    }
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
    .getByRole("button", { name: "Import your first statement", exact: true })
    .click();
  await (await choose).setFiles(fixture("barclays-sort"));
  await expect(
    page.getByRole("button", { name: "Needs attention (0)", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("region", { name: "Batch review", exact: true }),
  ).toContainText("1 ready");
  await expect(page.locator(".import-statement-heading h2")).toHaveText(
    "Barclays",
  );
  await expect(page.locator(".import-statement-card:visible")).toHaveCount(0);
  await confirmImport(page);
  await expect(
    page.getByRole("heading", { name: "Home", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("navigation")
      .filter({ visible: true })
      .locator('[aria-current="page"]'),
  ).toHaveText("Home");
  await expect(
    page.locator(".position-metrics > a").filter({ hasText: /^Cash/ }),
  ).toContainText("£935.00");
  await expect(
    page.getByRole("img", {
      name: /Cash balances balance trend/,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Browse all categories", { exact: true }),
  ).toHaveCount(0);
  const balanceCard = page.locator("section.card").filter({
    has: page.getByRole("heading", { name: "Balance trend", exact: true }),
  });
  await expect(
    balanceCard.getByRole("group", { name: "Balance trend range" }),
  ).toHaveCount(0);
  await expect(page.locator(".position-summary .balance-change")).toContainText(
    "-6.5% vs last month",
  );
  await expect(
    balanceCard.locator(".position-history path[data-verified=true]").first(),
  ).toHaveAttribute("d", /[HV]/);
  await expect(balanceCard.locator(".balance-trend-headline")).toContainText(
    "£935.00",
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  const settingsPosition = await page
    .locator(".sidebar nav")
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
  const uncategorisedShortcut = page.locator(
    '.categories-card a[href="#/transactions?uncategorized=1&allDates=1"]',
  );
  await expect(uncategorisedShortcut).toHaveCount(1);
  await uncategorisedShortcut.click();
  await expect(
    page.getByRole("heading", { name: "Transactions", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("group", { name: "Filter by account", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Your accounts", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".transaction-status.uncategorized")).toHaveCount(
    3,
  );
  await page.getByRole("link", { name: /ANOTHER SHOP/i }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("button", {
      name: "Categorise as Mortgage / financing",
      exact: true,
    }),
  ).toHaveCount(0);
  await dialog
    .getByRole("button", { name: "Categorise as Property", exact: true })
    .click();
  await expect(dialog.locator(".sorting-card")).toContainText("Corner Shop");
  await closeCategorySheet(page);
  await expect(page.getByRole("link", { name: /ANOTHER SHOP/i })).toHaveCount(
    0,
  );
  await expect(page.locator(".transaction-status.uncategorized")).toHaveCount(
    2,
  );
  const filters = page.getByRole("group", {
    name: "Transaction category filters",
  });
  await filters.getByRole("button", { name: "Property", exact: true }).click();
  await expect(page.getByRole("link", { name: /ANOTHER SHOP/i })).toBeVisible();
  await expect(page.locator(".transaction-status.categorized")).toHaveCount(1);
  await filters.getByRole("button", { name: /^Uncategorised \d+$/ }).click();
  await expect(page.getByRole("link", { name: /ANOTHER SHOP/i })).toHaveCount(
    0,
  );
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .filter({ visible: true })
    .getByRole("link", { name: "Analyse", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Property analysis", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("combobox", { name: "Category analysis", exact: true })
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

test("Uncategorised queue spans imported months and saves immediately disappear", async ({
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
    .getByRole("button", { name: /^Uncategorised \d+$/ })
    .click();
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "All dates", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page
    .getByRole("button", { name: "Close Filters", exact: true })
    .click();
  await expect(page.locator(".transaction-status.uncategorized")).toHaveCount(
    4,
  );
  const row = page.getByRole("link", { name: /ANOTHER SHOP/i });
  await row.click();
  await page
    .getByRole("dialog")
    .getByRole("link", { name: "View transaction details", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Category", exact: true })
    .selectOption("shopping");
  await expect(page.locator(".ux-toast")).toContainText("Transaction updated");
  await page.getByRole("link", { name: "‹ Transactions", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Transactions", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/uncategorized=1/);
  await expect(page).toHaveURL(/allDates=1/);
  await expect(page.getByRole("link", { name: /ANOTHER SHOP/i })).toHaveCount(
    0,
  );
  await expect(page.locator(".transaction-status.uncategorized")).toHaveCount(
    3,
  );
});
