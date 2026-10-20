import { resolve } from "node:path";
import { test, expect, type Page } from "./fixtures";

async function stored(page: Page, name: string) {
  return page.evaluate(
    (store) =>
      new Promise<Record<string, unknown>[]>((resolveRows, reject) => {
        const open = indexedDB.open("feng-finance");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(store, "readonly");
          const rows = tx.objectStore(store).getAll();
          tx.oncomplete = () => {
            db.close();
            resolveRows(rows.result);
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    name,
  );
}
const amountEditor = (page: Page) =>
  page.getByRole("dialog", { name: "Correct amount", exact: true });
async function enter(page: Page, value: string) {
  const editor = amountEditor(page);
  await expect(editor).toBeVisible();
  await editor.getByLabel("Amount (GBP)", { exact: true }).fill(value);
  await editor.getByRole("button", { name: "Money out", exact: true }).click();
  await editor
    .getByRole("button", { name: "Save and continue", exact: true })
    .click();
}

test("a mixed PDF batch resolves missing account identity before showing one amount question", async ({
  page,
}, testInfo) => {
  test.setTimeout(120000);
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.goto("/#/import");
  await page
    .getByLabel("Select statements", { exact: true })
    .setInputFiles([
      resolve("tests/fixtures/guided-missing-account.pdf"),
      resolve("tests/fixtures/known-bank-barclaycard.pdf"),
    ]);
  await expect(
    page.getByRole("group", { name: "Statement view", exact: true }),
  ).toBeVisible({ timeout: 90000 });
  const card = page.locator(".import-statement-card:visible");
  await expect(card).toHaveCount(1);
  const confirm = page.getByRole("button", {
    name: "Confirm import",
    exact: true,
  });
  await expect(confirm).toBeDisabled();
  await expect(card.locator(".import-statement-details")).not.toHaveAttribute(
    "open",
  );
  await expect(card.locator(".generic-import-review")).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("compact-account-exception.png"),
  });
  await card
    .getByRole("button", { name: "Review statement", exact: true })
    .click();
  const account = page.getByRole("dialog", {
    name: "Identify account",
    exact: true,
  });
  await expect(account).toBeVisible();
  await expect(amountEditor(page)).toHaveCount(0);
  await account.getByLabel("Last four account or card digits").fill("3333");
  await page.screenshot({ path: testInfo.outputPath("identify-account.png") });
  expect(await stored(page, "accounts")).toHaveLength(0);
  await account.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(amountEditor(page)).toBeVisible();
  await expect(amountEditor(page)).toContainText("BEAUTY CODE");
  await expect(
    amountEditor(page).getByRole("button", { name: /Use reading/ }),
  ).toHaveCount(0);
  await enter(page, "80.00");
  const done = page.getByRole("dialog", {
    name: "Statement checked",
    exact: true,
  });
  await expect(done).toBeVisible();
  await done.getByRole("button", { name: "Done", exact: true }).click();
  await expect(confirm).toBeEnabled();
  expect(await stored(page, "transactions")).toHaveLength(0);
  await confirm.click();
  await expect(
    page.getByRole("heading", { name: "Home", exact: true }),
  ).toBeVisible();
  expect(await stored(page, "transactions")).toHaveLength(8);
  const statements = await stored(page, "statements");
  expect(statements).toHaveLength(2);
  expect(
    statements.every(
      (s) =>
        s.validationStatus === "reconciled" && s.validationDifference === 0,
    ),
  ).toBe(true);
});

test("successive ambiguous amounts are entered manually without expanding cards or changing import selection", async ({
  page,
}, testInfo) => {
  test.setTimeout(120000);
  await page.goto("/#/import");
  await page
    .getByLabel("Select statements", { exact: true })
    .setInputFiles(resolve("tests/fixtures/guided-two-amounts.pdf"));
  await expect(
    page.getByRole("group", { name: "Statement view", exact: true }),
  ).toBeVisible({ timeout: 90000 });
  const card = page.locator(".import-statement-card:visible");
  await card
    .getByRole("button", { name: "Review statement", exact: true })
    .click();
  await expect(amountEditor(page)).toContainText("Transaction 1 of 2 to check");
  await enter(page, "80.00");
  await expect(amountEditor(page)).toContainText("Transaction 2 of 2 to check");
  await expect(amountEditor(page)).toContainText("SECOND FICTIONAL SHOP");
  await expect(
    amountEditor(page).getByLabel("Amount (GBP)", { exact: true }),
  ).toHaveValue("");
  await page.screenshot({
    path: testInfo.outputPath("second-amount-question.png"),
  });
  await enter(page, "20.00");
  const done = page.getByRole("dialog", {
    name: "Statement checked",
    exact: true,
  });
  await expect(done).toBeVisible();
  await done.getByRole("button", { name: "Done", exact: true }).click();
  await expect(card.locator(".import-statement-details")).not.toHaveAttribute(
    "open",
  );
  await page
    .getByRole("button", { name: "Confirm import", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Home", exact: true }),
  ).toBeVisible();
  expect(
    (await stored(page, "transactions"))
      .map((t) => t.amount)
      .sort((a, b) => Number(a) - Number(b)),
  ).toEqual([-8000, -2000, 200000]);
  expect(await stored(page, "statements")).toEqual([
    expect.objectContaining({
      openingBalance: 50000,
      closingBalance: 240000,
      validationDifference: 0,
      validationStatus: "reconciled",
    }),
  ]);
});
