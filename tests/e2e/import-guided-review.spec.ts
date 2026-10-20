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

test("a recognized Barclaycard opens its unread transaction directly without asking for its account", async ({
  page,
}, testInfo) => {
  test.setTimeout(120000);
  await page.goto("/#/import");
  await page
    .getByLabel("Select statements", { exact: true })
    .setInputFiles([
      resolve("tests/fixtures/guided-known-card-amount.pdf"),
      resolve("tests/fixtures/known-bank-amex.pdf"),
    ]);
  await expect(
    page.getByRole("group", { name: "Statement view", exact: true }),
  ).toBeVisible({ timeout: 90000 });
  const card = page
    .locator(".import-statement-card:visible")
    .filter({ hasText: "4444" });
  await expect(card).toHaveCount(1);
  await card
    .getByRole("button", { name: "Review statement", exact: true })
    .click();
  const editor = amountEditor(page);
  await expect(editor).toBeVisible({ timeout: 30000 });
  await expect(
    page.getByRole("dialog", { name: "Identify account", exact: true }),
  ).toHaveCount(0);
  await expect(editor).toContainText("WAITROSE");
  await expect(editor).toContainText("Transaction 1 of 1 to check");
  await expect(editor).toContainText("4444");
  await page.screenshot({
    path: testInfo.outputPath("known-card-direct-amount.png"),
  });
  await enter(page, "80.00");
  const done = page.getByRole("dialog", {
    name: "Statement checked",
    exact: true,
  });
  await expect(done).toBeVisible();
  await done.getByRole("button", { name: "Done", exact: true }).click();
  expect(await stored(page, "transactions")).toHaveLength(0);
  await page
    .getByRole("button", { name: "Confirm import", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Home", exact: true }),
  ).toBeVisible();
  const statements = await stored(page, "statements");
  expect(statements).toHaveLength(2);
  expect(
    statements.find((s) => s.sourceFilename === "guided-known-card-amount.pdf"),
  ).toMatchObject({
    closingBalance: -10968,
    transactionCount: 6,
    validationStatus: "reconciled",
    validationDifference: 0,
  });
  const accounts = await stored(page, "accounts");
  expect(accounts.filter((a) => a.institution === "Barclays")).toEqual([
    expect.objectContaining({
      accountType: "credit",
      maskedAccountIdentifier: "•••• 4444",
    }),
  ]);
});

test("choosing an account once advances past competing PDF identifiers to its amount question", async ({
  page,
}, testInfo) => {
  test.setTimeout(120000);
  await page.goto("/#/import");
  // Pre-existing accounts exercise the actual selection dropdown, including a
  // rejected choice. Only fictional setup data is written directly.
  await page.evaluate(
    () =>
      new Promise<void>((resolveSeed, reject) => {
        const request = indexedDB.open("feng-finance");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const tx = database.transaction("accounts", "readwrite");
          for (const suffix of ["3333", "9999"])
            tx.objectStore("accounts").put({
              id: `fictional-account-${suffix}`,
              institution: "Other",
              displayName: "Current account",
              accountType: "current",
              currency: "GBP",
              maskedAccountIdentifier: `•••• ${suffix}`,
              createdAt: "2026-10-20T00:00:00Z",
              updatedAt: "2026-10-20T00:00:00Z",
            });
          tx.oncomplete = () => {
            database.close();
            resolveSeed();
          };
          tx.onerror = () => {
            database.close();
            reject(tx.error);
          };
        };
      }),
  );
  await page.reload();
  await page
    .getByLabel("Select statements", { exact: true })
    .setInputFiles(resolve("tests/fixtures/guided-competing-accounts.pdf"));
  await expect(
    page.getByRole("group", { name: "Statement view", exact: true }),
  ).toBeVisible({ timeout: 90000 });
  await page
    .locator(".import-statement-card:visible")
    .getByRole("button", { name: "Review statement", exact: true })
    .click();
  const account = page.getByRole("dialog", {
    name: "Identify account",
    exact: true,
  });
  await expect(account).toBeVisible();
  await account
    .getByRole("combobox", { name: "Account", exact: true })
    .selectOption("fictional-account-9999");
  await account.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(account.getByRole("alert")).toContainText(
    "could not be matched to the identifiers",
  );
  await expect(
    account.getByRole("combobox", { name: "Account", exact: true }),
  ).toHaveValue("fictional-account-9999");
  await account
    .getByRole("combobox", { name: "Account", exact: true })
    .selectOption("fictional-account-3333");
  await account.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(amountEditor(page)).toBeVisible();
  await expect(account).toHaveCount(0);
  await expect(amountEditor(page)).toContainText("FICTIONAL GROCER");
  await page.screenshot({
    path: testInfo.outputPath("account-continue-advances.png"),
  });
  await enter(page, "80.00");
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
  expect(
    (await stored(page, "transactions"))
      .map((t) => t.amount)
      .sort((a, b) => Number(a) - Number(b)),
  ).toEqual([-8000, 200000]);
  expect(await stored(page, "accounts")).toHaveLength(2);
  expect(await stored(page, "statements")).toEqual([
    expect.objectContaining({
      accountId: "fictional-account-3333",
      validationStatus: "reconciled",
    }),
  ]);
});

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

test("an unread Barclaycard identifier needs one account confirmation without retyping native amounts", async ({
  page,
}, testInfo) => {
  test.setTimeout(120000);
  await page.goto("/#/import");
  await page
    .getByLabel("Select statements", { exact: true })
    .setInputFiles(resolve("tests/fixtures/guided-credit-account.pdf"));
  await expect(
    page.getByRole("group", { name: "Statement view", exact: true }),
  ).toBeVisible({ timeout: 90000 });
  const card = page.locator(".import-statement-card:visible");
  await card
    .getByRole("button", { name: "Review statement", exact: true })
    .click();
  const account = page.getByRole("dialog", {
    name: "Identify account",
    exact: true,
  });
  await expect(account).toBeVisible();
  await expect(
    account.getByRole("combobox", { name: "Bank", exact: true }),
  ).toHaveValue("Barclays");
  await expect(
    account.getByRole("combobox", { name: "Account type", exact: true }),
  ).toHaveValue("credit");
  await account.getByLabel("Last four account or card digits").fill("4444");
  await page.screenshot({
    path: testInfo.outputPath("identify-credit-account.png"),
  });
  await account.getByRole("button", { name: "Continue", exact: true }).click();
  const risk = page.getByRole("dialog", {
    name: "Import an unverified statement?",
    exact: true,
  });
  await expect(risk).toBeVisible();
  await expect(risk).toContainText("The account number could not be read.");
  await page.screenshot({
    path: testInfo.outputPath("confirm-linked-card.png"),
  });
  const accept = risk.getByRole("button", {
    name: "Accept unverified statement",
    exact: true,
  });
  await expect(accept).toBeDisabled();
  await risk
    .getByRole("checkbox", {
      name: "I checked the original statement and accept importing these unverified figures.",
      exact: true,
    })
    .check();
  await accept.click();
  const done = page.getByRole("dialog", {
    name: "Statement checked",
    exact: true,
  });
  await expect(done).toBeVisible();
  await expect(amountEditor(page)).toHaveCount(0);
  await done.getByRole("button", { name: "Done", exact: true }).click();
  await expect(card.locator(":scope > summary")).toContainText("Credit card");
  await expect(card.locator(":scope > summary")).toContainText("4444");
  expect(await stored(page, "accounts")).toHaveLength(0);
  await page
    .getByRole("button", { name: "Confirm import", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Home", exact: true }),
  ).toBeVisible();
  expect(await stored(page, "accounts")).toEqual([
    expect.objectContaining({
      accountType: "credit",
      institution: "Barclays",
      maskedAccountIdentifier: "•••• 4444",
    }),
  ]);
  expect(await stored(page, "transactions")).toHaveLength(6);
  expect(await stored(page, "statements")).toEqual([
    expect.objectContaining({
      bankProfileId: "barclaycard",
      closingBalance: -10968,
      validationDifference: 0,
      validationStatus: "warning",
      validationOverride: true,
      rowsNeedingReview: 6,
    }),
  ]);
});
