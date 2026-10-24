import { test as base, expect, acknowledgeBeta, type Page } from "./fixtures";
import { attentionHistoryFixture } from "../../src/tests/attention-history";
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

async function seed(page: Page) {
  await page.clock.setFixedTime(new Date("2026-10-03T12:00:00Z"));
  await page.evaluate(
    (data) =>
      new Promise<void>((done, reject) => {
        const request = indexedDB.open("feng-finance");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const names = [
            "accounts",
            "transactions",
            "statements",
            "rules",
          ] as const;
          const tx = db.transaction([...names], "readwrite");
          for (const name of names)
            for (const row of data[name]) tx.objectStore(name).put(row);
          tx.oncomplete = () => {
            db.close();
            done();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    attentionHistoryFixture(),
  );
  await page.reload();
  await page.goto(new URL(page.url()).origin + "/#/");
}

async function savedRows(page: Page) {
  return page.evaluate(
    () =>
      new Promise<unknown[]>((done, reject) => {
        const request = indexedDB.open("feng-finance");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result,
            tx = db.transaction("transactions", "readonly");
          const rows = tx.objectStore("transactions").getAll();
          tx.oncomplete = () => {
            db.close();
            done(rows.result);
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
}

test("Home sends only uncategorised payments to sorting, skipping 189 already categorised rules", async ({
  page,
  offlineHost,
}) => {
  await page.goto(offlineHost.origin + "/#/");
  await acknowledgeBeta(page);
  await seed(page);
  const before = await savedRows(page);
  const home = page.locator(".home-todos");
  await expect(
    home.getByRole("link", { name: /Categorise 2 transactions/ }),
  ).toBeVisible();
  await expect(
    home.getByRole("link", { name: "3 transactions need attention" }),
  ).toBeVisible();
  await expect(home).not.toContainText("189");
  expect(await savedRows(page)).toEqual(before);
  await home.getByRole("link", { name: /Categorise 2 transactions/ }).click();
  const board = page.getByRole("dialog", { name: "Where does this belong?" });
  await expect(board).toContainText("1 of 2 to sort");
  await expect(board).toContainText("First Unknown");
  await board
    .getByRole("button", { name: "Categorise as Groceries", exact: true })
    .click();
  await expect(board).toContainText("1 of 1 to sort");
  await expect(board).toContainText("Second Unknown");
  await board
    .getByRole("button", { name: "Categorise as Shopping", exact: true })
    .click();
  await expect(board).toHaveCount(0);
  await page.goto(offlineHost.origin + "/#/");
  await expect(home.getByRole("link", { name: /Categorise \d/ })).toHaveCount(
    0,
  );
  await expect(
    home.getByRole("link", { name: "3 transactions need attention" }),
  ).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true);
  // Emulated offline mode bypasses WebKit's service worker for lazy modules.
  // Stop this test's real origin instead, then prove cold launch and navigation.
  await offlineHost.stop();
  await page.reload();
  const nav = page
    .getByRole("navigation", { name: "Main navigation" })
    .filter({ visible: true });
  await nav.getByRole("link", { name: "Transactions", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Transactions", exact: true }),
  ).toBeVisible();
  await nav.getByRole("link", { name: "Home", exact: true }).click();
  await expect(home.getByRole("link", { name: /Categorise \d/ })).toHaveCount(
    0,
  );
  await expect(
    home.getByRole("link", { name: "3 transactions need attention" }),
  ).toBeVisible();
});

test("attention explains the remaining decisions and rule-categorised details require no stamp", async ({
  page,
}) => {
  await seed(page);
  const before = await savedRows(page);
  await page
    .locator(".home-todos")
    .getByRole("link", { name: "3 transactions need attention" })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".transaction-row")).toHaveCount(3);
  await expect(page.locator(".transaction-list")).not.toContainText(
    "Example Market",
  );
  await expect(page.locator(".transaction-list")).toContainText("Check source");
  await expect(page.locator(".transaction-list")).toContainText("Link refund");
  await expect(page.locator(".transaction-list")).toContainText(
    "Confirm split",
  );
  await page.getByRole("link", { name: /^Example Split,/ }).click();
  await expect(
    page.getByRole("heading", { name: "Example Split", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Confirm split", exact: true }),
  ).toBeVisible();
  await page.goto("/#/transactions/classified-1");
  await expect(
    page.getByRole("combobox", { name: "Category", exact: true }),
  ).toHaveValue("groceries");
  await expect(
    page.getByRole("button", { name: "Mark reviewed", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Confirm source checked", exact: true }),
  ).toHaveCount(0);
  expect(await savedRows(page)).toEqual(before);
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
  }
});
