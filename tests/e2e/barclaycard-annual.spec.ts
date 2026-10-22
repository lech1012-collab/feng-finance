import { resolve } from "node:path";
import { test, expect, type Page } from "./fixtures";

async function records(page: Page) {
  return page.evaluate(
    () =>
      new Promise<{
        transactions: Record<string, unknown>[];
        statements: Record<string, unknown>[];
        accounts: Record<string, unknown>[];
      }>((done, reject) => {
        const request = indexedDB.open("feng-finance");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result,
            tx = db.transaction(
              ["transactions", "statements", "accounts"],
              "readonly",
            );
          const transactions = tx.objectStore("transactions").getAll(),
            statements = tx.objectStore("statements").getAll(),
            accounts = tx.objectStore("accounts").getAll();
          tx.oncomplete = () => {
            db.close();
            done({
              transactions: transactions.result,
              statements: statements.result,
              accounts: accounts.result,
            });
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
}

test("an annual summary shows its dates and totals without entering transaction recovery or creating records", async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.goto("/#/import");
  await page
    .getByLabel("Select statements", { exact: true })
    .setInputFiles(resolve("tests/fixtures/annual-card-summary.pdf"));
  const card = page.locator(".import-annual-summary");
  await expect(card).toBeVisible({ timeout: 90000 });
  await expect(card).toContainText("Summary only");
  await expect(card.locator('time[datetime="2025-09-01"]')).toBeVisible();
  await expect(card.locator('time[datetime="2026-08-31"]')).toBeVisible();
  await card.locator(":scope > summary").click();
  await expect(card.locator('time[datetime="2026-09-04"]')).toBeVisible();
  await expect(card).toContainText("£3,210.45");
  await expect(card).toContainText("£23.40");
  await expect(card).toContainText("£3,000.00");
  await expect(card).toContainText("Use monthly Barclaycard statements");
  await expect(card.getByRole("button")).toHaveCount(0);
  await expect(card.getByRole("textbox")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Review statement", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Confirm import", exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  expect(await records(page)).toEqual({
    transactions: [],
    statements: [],
    accounts: [],
  });
  await page.getByRole("button", { name: "Back to Home", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Home", exact: true }),
  ).toBeVisible();
  expect(await records(page)).toEqual({
    transactions: [],
    statements: [],
    accounts: [],
  });
});

test("an annual summary does not block or double-count a batch of monthly credit-card statements", async ({
  page,
}) => {
  test.setTimeout(150000);
  await page.goto("/#/import");
  await page
    .getByLabel("Select statements", { exact: true })
    .setInputFiles([
      resolve("tests/fixtures/annual-card-summary.pdf"),
      resolve("tests/fixtures/card-sidebar-exact.pdf"),
      resolve("tests/fixtures/known-bank-amex.pdf"),
    ]);
  await expect(
    page.getByRole("group", { name: "Statement view", exact: true }),
  ).toBeVisible({ timeout: 90000 });
  await expect(page.locator(".import-annual-summary")).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Batch review", exact: true }),
  ).toContainText("2 ready · 0 need attention · 1 skipped");
  await expect(
    page.getByRole("button", { name: "Review statement", exact: true }),
  ).toHaveCount(0);
  const before = await records(page);
  expect(before.transactions).toHaveLength(0);
  await page
    .getByRole("button", { name: "Confirm import", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Home", exact: true }),
  ).toBeVisible();
  const saved = await records(page);
  expect(saved.transactions).toHaveLength(30);
  expect(saved.statements).toHaveLength(2);
  expect(saved.accounts).toHaveLength(2);
  expect(
    saved.statements.some(
      (s) => s.sourceFilename === "annual-card-summary.pdf",
    ),
  ).toBe(false);
  expect(
    saved.transactions.some((t) => t.amount === -321045 || t.amount === 300000),
  ).toBe(false);
  expect(
    saved.statements.every(
      (s) =>
        s.validationStatus === "reconciled" && s.validationDifference === 0,
    ),
  ).toBe(true);
});
