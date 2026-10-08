import { test, expect, type Page } from "@playwright/test";
import type { Statement } from "../../src/domain/models";
import { accounts, transaction } from "../../src/tests/helpers";

async function seedSortingQueue(page: Page) {
  await page.goto("/#/transactions?uncategorized=1&allDates=1");
  await expect(
    page.getByRole("heading", { name: "Transactions", exact: true }),
  ).toBeVisible();
  const rows = [
    transaction({
      id: "sort-waitrose",
      date: "2026-09-05",
      merchant: "WAITROSE STORE 1234",
      description: "WAITROSE STORE 1234",
      isReviewed: false,
    }),
    transaction({
      id: "sort-corner",
      date: "2026-09-04",
      merchant: "CORNER SHOP",
      description: "CORNER SHOP",
      amount: -900,
      isReviewed: false,
    }),
  ];
  const statement: Statement = {
    id: "s1",
    institution: "Barclays",
    accountId: "a1",
    statementPeriodStart: "2026-09-01",
    statementPeriodEnd: "2026-09-30",
    openingBalance: 100000,
    closingBalance: 98100,
    currency: "GBP",
    sourceFilename: "synthetic-sorting.pdf",
    sourceFileHash: "synthetic-sorting-fixture",
    importedAt: "2026-10-03T00:00:00.000Z",
    parserVersion: "synthetic",
    extractionMethod: "embedded-text",
    validationStatus: "reconciled",
    validationDifference: 0,
    transactionCount: 2,
    warnings: [],
    periodSource: "printed",
  };
  await page.evaluate(
    ({ account, statement, rows }) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("feng-finance");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const tx = database.transaction(
            ["accounts", "statements", "transactions"],
            "readwrite",
          );
          tx.objectStore("accounts").put(account);
          tx.objectStore("statements").put(statement);
          for (const row of rows) tx.objectStore("transactions").put(row);
          tx.oncomplete = () => {
            database.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        };
      }),
    { account: accounts[0], statement, rows },
  );
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Uncategorized 2", exact: true }),
  ).toBeVisible();
}

async function manualRuleCount(page: Page) {
  return page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const request = indexedDB.open("feng-finance");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const records = database
            .transaction("rules", "readonly")
            .objectStore("rules")
            .getAll();
          records.onerror = () => reject(records.error);
          records.onsuccess = () => {
            const count = records.result.filter(
              (r: { builtIn: boolean }) => !r.builtIn,
            ).length;
            database.close();
            resolve(count);
          };
        };
      }),
  );
}

test("desktop dragging scrolls the category rail and Escape stops it without saving", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await seedSortingQueue(page);
  const row = page.getByRole("link", { name: /^Waitrose,/ });
  const rail = page.getByRole("complementary", {
    name: "Category drop targets",
  });
  const rowBounds = (await row.boundingBox())!;
  const railBounds = (await rail.boundingBox())!;
  await page.mouse.move(
    rowBounds.x + rowBounds.width / 2,
    rowBounds.y + rowBounds.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    railBounds.x + railBounds.width / 2,
    Math.min(railBounds.y + railBounds.height - 6, 894),
    { steps: 15 },
  );
  await expect
    .poll(() => rail.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(40);
  await page.keyboard.press("Escape");
  const stoppedAt = await rail.evaluate((element) => element.scrollTop);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  expect(await rail.evaluate((element) => element.scrollTop)).toBe(stoppedAt);
  await page.mouse.up();
  await expect(page.locator(".transaction-list .transaction-row")).toHaveCount(
    2,
  );
  await expect(
    page.getByRole("button", { name: "Uncategorized 2", exact: true }),
  ).toBeVisible();
  expect(await manualRuleCount(page)).toBe(0);
});

test("desktop rail suggests categories and multi-selection learns and undoes both merchants atomically", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await seedSortingQueue(page);
  const first = page.getByRole("link", { name: /^Waitrose,/ });
  const second = page.getByRole("link", { name: /^Corner Shop,/ });
  await first.click({ modifiers: ["Meta"] });
  await second.click({ modifiers: ["Shift"] });
  await expect(page.locator(".swipe-transaction.selected")).toHaveCount(2);
  const rail = page.getByRole("complementary", {
    name: "Category drop targets",
  });
  await expect(rail.getByText("Known merchant match")).toBeVisible();
  await expect(
    rail.getByRole("button", { name: "Salary", exact: true }),
  ).toBeDisabled();
  await rail
    .getByRole("button", { name: "Suggested Groceries", exact: true })
    .click();
  await expect(page.locator(".transaction-list .transaction-row")).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "Uncategorized 0", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("status")).toContainText("2 merchants");
  await expect(page.getByRole("status")).toContainText(
    "Future matching payments will follow",
  );
  expect(await manualRuleCount(page)).toBe(2);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page
    .getByRole("button", { name: "Close categorization", exact: true })
    .click();
  await expect(page.locator(".transaction-list .transaction-row")).toHaveCount(
    2,
  );
  await expect(
    page.getByRole("button", { name: "Uncategorized 2", exact: true }),
  ).toBeVisible();
  expect(await manualRuleCount(page)).toBe(0);
});

test("mobile queue advances after a suggestion and Skip defers the remaining payment", async ({
  page,
}) => {
  await seedSortingQueue(page);
  await page
    .getByRole("button", { name: "Start sorting", exact: true })
    .click();
  let dialog = page.getByRole("dialog");
  await expect(
    dialog.getByText("Known merchant match", { exact: false }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Categorize as Groceries", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Corner Shop", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Skip", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".transaction-list .transaction-row")).toHaveCount(
    1,
  );
  await expect(
    page.getByRole("button", { name: "Uncategorized 1", exact: true }),
  ).toBeVisible();
  expect(await manualRuleCount(page)).toBe(1);
});

test("mobile left swipe reveals a suggestion without saving until chosen and Undo restores the payment", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedSortingQueue(page);
  const row = page.getByRole("link", { name: /^Waitrose,/ });
  await row.evaluate((element) =>
    element.scrollIntoView({ block: "center", behavior: "instant" }),
  );
  await expect
    .poll(() =>
      row.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        const target = document.elementFromPoint(
          bounds.right - 32,
          bounds.top + bounds.height / 2,
        );
        return !!target && element.contains(target);
      }),
    )
    .toBe(true);
  const bounds = (await row.boundingBox())!;
  const startX = bounds.x + bounds.width - 32;
  const y = bounds.y + bounds.height / 2;
  await page.mouse.move(startX, y);
  await page.mouse.down();
  await page.mouse.move(startX - 100, y, { steps: 12 });
  await page.mouse.up();
  const actions = row.locator("..").locator(".swipe-actions");
  await expect(
    actions.getByRole("button", {
      name: "Categorize as Groceries",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    actions.getByRole("button", { name: "More", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".transaction-list .transaction-row")).toHaveCount(
    2,
  );
  expect(await manualRuleCount(page)).toBe(0);
  await actions
    .getByRole("button", { name: "Categorize as Groceries", exact: true })
    .click();
  await expect(page.locator(".transaction-list .transaction-row")).toHaveCount(
    1,
  );
  await expect(
    page.getByRole("button", { name: "Uncategorized 1", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".category-feedback")).toContainText(
    "Future matching payments will follow",
  );
  expect(await manualRuleCount(page)).toBe(1);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page
    .getByRole("button", { name: "Close categorization", exact: true })
    .click();
  await expect(page.locator(".transaction-list .transaction-row")).toHaveCount(
    2,
  );
  await expect(
    page.getByRole("button", { name: "Uncategorized 2", exact: true }),
  ).toBeVisible();
  expect(await manualRuleCount(page)).toBe(0);
});
