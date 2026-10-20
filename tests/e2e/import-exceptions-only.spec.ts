import { resolve } from "node:path";
import { test, expect, type Page } from "./fixtures";
import { showAllStatements } from "./import-actions";

async function records(page: Page, name: string) {
  return page.evaluate(
    (store) =>
      new Promise<Record<string, unknown>[]>((done, reject) => {
        const request = indexedDB.open("feng-finance");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const tx = database.transaction(store, "readonly");
          const rows = tx.objectStore(store).getAll();
          tx.oncomplete = () => {
            database.close();
            done(rows.result);
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    name,
  );
}
async function select(page: Page, mode: string, extra: string[] = []) {
  await page.goto("/#/import");
  await page
    .getByLabel("Select statements", { exact: true })
    .setInputFiles([
      resolve(`tests/fixtures/large-card-${mode}.pdf`),
      ...extra.map((file) => resolve(`tests/fixtures/${file}`)),
    ]);
  await expect(
    page.getByRole("group", { name: "Statement view", exact: true }),
  ).toBeVisible({ timeout: 90000 });
}
async function openReview(page: Page) {
  await page
    .locator(".import-statement-card:visible")
    .first()
    .getByRole("button", { name: "Review statement", exact: true })
    .click();
}
async function finish(page: Page) {
  const done = page.getByRole("dialog", {
    name: "Statement checked",
    exact: true,
  });
  await expect(done).toBeVisible();
  await done.getByRole("button", { name: "Done", exact: true }).click();
  await page
    .getByRole("button", { name: "Confirm import", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Home", exact: true }),
  ).toBeVisible();
}

test("133 readable card rows import without mandatory transaction corrections", async ({
  page,
}) => {
  test.setTimeout(120000);
  await select(page, "exact");
  await showAllStatements(page);
  await expect(
    page.getByRole("button", { name: "Review statement", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Confirm import", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Home", exact: true }),
  ).toBeVisible();
  expect(await records(page, "transactions")).toHaveLength(133);
  expect(await records(page, "statements")).toEqual([
    expect.objectContaining({
      closingBalance: -105650,
      validationStatus: "reconciled",
      validationDifference: 0,
    }),
  ]);
});

test("a 1p discrepancy in 133 readable rows opens one totals warning and saves nothing", async ({
  page,
}, info) => {
  test.setTimeout(120000);
  await select(page, "difference");
  await openReview(page);
  const totals = page.getByRole("dialog", {
    name: "Check statement totals",
    exact: true,
  });
  await expect(totals).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "Correct amount", exact: true }),
  ).toHaveCount(0);
  await expect(totals).toContainText("£0.01");
  await page.screenshot({ path: info.outputPath("one-totals-warning.png") });
  await totals
    .getByRole("button", { name: "Back to statements", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Confirm import", exact: true }),
  ).toBeDisabled();
  expect(await records(page, "transactions")).toHaveLength(0);
});

test("one unread amount in 133 rows requires one correction, retaining the other selected PDF", async ({
  page,
}, info) => {
  test.setTimeout(180000);
  await page.setViewportSize({ width: 320, height: 700 });
  await select(page, "amount", ["known-bank-amex.pdf"]);
  await openReview(page);
  const editor = page.getByRole("dialog", {
    name: "Correct amount",
    exact: true,
  });
  await expect(editor).toBeVisible();
  await expect(editor).toContainText("Transaction 1 of 1 to check");
  await expect(editor).toContainText("FICTIONAL PURCHASE 72");
  const amount = editor.getByLabel("Amount (GBP)", { exact: true });
  await amount.fill("1.00");
  await editor.getByRole("button", { name: "Money out", exact: true }).click();
  // A reduced viewport exercises a keyboard-sized usable area while focused.
  await page.setViewportSize({ width: 320, height: 470 });
  await amount.focus();
  const bounds = await editor.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.width).toBeLessThanOrEqual(320);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({ path: info.outputPath("single-amount-narrow.png") });
  await editor
    .getByRole("button", { name: "Save and continue", exact: true })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  await finish(page);
  expect(await records(page, "statements")).toHaveLength(2);
  const transactions = await records(page, "transactions");
  expect(
    transactions.filter((row) =>
      String(row.description).startsWith("FICTIONAL PURCHASE"),
    ),
  ).toHaveLength(132);
  expect(
    transactions.find((row) => row.description === "FICTIONAL PURCHASE 72")
      ?.amount,
  ).toBe(-100);
});

test("a date-only exception preserves its amount and asks for one date", async ({
  page,
}, info) => {
  test.setTimeout(120000);
  await select(page, "date");
  await openReview(page);
  const editor = page.getByRole("dialog", {
    name: "Correct date",
    exact: true,
  });
  await expect(editor).toBeVisible();
  await expect(editor).toContainText("Transaction 1 of 1 to check");
  await expect(editor).toContainText("Amount kept: −£1.00");
  await expect(
    editor.getByLabel("Amount (GBP)", { exact: true }),
  ).not.toBeVisible();
  await editor
    .getByRole("textbox", { name: "Date", exact: true })
    .fill("13092026");
  await page.screenshot({ path: info.outputPath("date-only-correction.png") });
  await editor
    .getByRole("button", { name: "Save and continue", exact: true })
    .click();
  await finish(page);
  expect(await records(page, "transactions")).toHaveLength(133);
  expect(
    (await records(page, "transactions")).find(
      (row) => row.description === "FICTIONAL PURCHASE 72",
    ),
  ).toMatchObject({ amount: -100, date: "2026-09-13" });
});

test("a systemic layout failure is explained once rather than launching 133 correction panels", async ({
  page,
}) => {
  test.setTimeout(120000);
  await select(page, "layout");
  await openReview(page);
  const layout = page.getByRole("dialog", {
    name: "Check statement layout",
    exact: true,
  });
  await expect(layout).toBeVisible();
  await expect(layout).toContainText("133");
  await expect(
    page.getByRole("dialog", { name: "Correct amount", exact: true }),
  ).toHaveCount(0);
  expect(await records(page, "transactions")).toHaveLength(0);
});
