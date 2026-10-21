import { resolve } from "node:path";
import { test, expect, type Page } from "./fixtures";

async function stored(page: Page, name: string) {
  return page.evaluate(
    (store) =>
      new Promise<Record<string, unknown>[]>((done, reject) => {
        const request = indexedDB.open("feng-finance");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result,
            tx = db.transaction(store, "readonly"),
            rows = tx.objectStore(store).getAll();
          tx.oncomplete = () => {
            db.close();
            done(rows.result);
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    name,
  );
}
async function select(page: Page, files: string[]) {
  await page.goto("/#/import");
  await page
    .getByLabel("Select statements", { exact: true })
    .setInputFiles(files.map((f) => resolve(`tests/fixtures/${f}.pdf`)));
  await expect(
    page.getByRole("group", { name: "Statement view", exact: true }),
  ).toBeVisible({ timeout: 90000 });
}
async function noDiagnosticStack(page: Page) {
  await expect(
    page.locator(
      ".import-expert-tools,.import-statement-details .parse-options,.review-row,.generic-review-row",
    ),
  ).toHaveCount(0);
  await expect(
    page.getByRole("combobox", { name: "Category", exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
}
for (const setup of [
  { id: "dark-390", width: 390, height: 844, text: 100 },
  { id: "dark-320", width: 320, height: 700, text: 100 },
  { id: "text-200", width: 390, height: 844, text: 200 },
]) {
  test(`manual fallback is a compact tap-to-correct journey with a retained PDF batch at ${setup.id}`, async ({
    page,
  }, info) => {
    test.setTimeout(150000);
    await page.setViewportSize({ width: setup.width, height: setup.height });
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await select(page, ["guided-known-card-amount", "known-bank-amex"]);
    if (setup.text === 200)
      await page.addStyleTag({
        content: "html { font-size: 200% !important; }",
      });
    const card = page
      .locator(".import-statement-card:visible")
      .filter({ hasText: "4444" });
    await card.getByText("Statement details", { exact: true }).click();
    const overview = page.getByRole("dialog", {
      name: "Statement overview",
      exact: true,
    });
    await expect(overview).toBeVisible();
    await noDiagnosticStack(page);
    await page.screenshot({
      path: info.outputPath("01-statement-overview.png"),
    });
    await overview.getByRole("button", { name: /Check transactions/ }).click();
    const list = page.getByRole("dialog", {
      name: "Check transactions",
      exact: true,
    });
    await expect(list.getByRole("button", { name: /WAITROSE/ })).toBeVisible({
      timeout: 30000,
    });
    await noDiagnosticStack(page);
    const row = list.getByRole("button", { name: /WAITROSE/ });
    const box = await row.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.width).toBeLessThanOrEqual(setup.width);
    await page.screenshot({
      path: info.outputPath("02-compact-transaction-list.png"),
    });
    await row.click();
    const editor = page.getByRole("dialog", {
      name: "Correct amount",
      exact: true,
    });
    await expect(editor).toBeVisible();
    await expect(editor.getByRole("combobox")).toHaveCount(0);
    await editor.getByLabel("Amount (GBP)", { exact: true }).fill("80.01");
    await editor
      .getByRole("button", { name: "Money out", exact: true })
      .click();
    await page.screenshot({
      path: info.outputPath("03-one-amount-editor.png"),
    });
    await editor
      .getByRole("button", { name: "Save correction", exact: true })
      .click();
    await expect(list.getByRole("button", { name: /WAITROSE/ })).toBeVisible();
    await list.getByRole("button", { name: /WAITROSE/ }).click();
    await expect(
      editor.getByLabel("Amount (GBP)", { exact: true }),
    ).toHaveValue("80.01");
    await editor.getByLabel("Amount (GBP)", { exact: true }).fill("80.00");
    await editor
      .getByRole("button", { name: "Save correction", exact: true })
      .click();
    await expect(
      list.getByRole("button", { name: "Done", exact: true }),
    ).toBeEnabled();
    expect(await stored(page, "transactions")).toHaveLength(0);
    await list.getByRole("button", { name: "Done", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Confirm import", exact: true }),
    ).toBeEnabled();
    await page
      .getByRole("button", { name: "Confirm import", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Home", exact: true }),
    ).toBeVisible();
    const statements = await stored(page, "statements"),
      transactions = await stored(page, "transactions");
    expect(statements).toHaveLength(2);
    expect(transactions).toHaveLength(13);
    expect(
      statements.every(
        (s) =>
          s.validationStatus === "reconciled" && s.validationDifference === 0,
      ),
    ).toBe(true);
    expect(
      transactions.find((t) => String(t.description).includes("WAITROSE"))
        ?.amount,
    ).toBe(-8000);
  });
}

test("a totals warning opens the new totals screen instead of the expanded diagnostic form", async ({
  page,
}, info) => {
  test.setTimeout(120000);
  await page.emulateMedia({ colorScheme: "dark" });
  await select(page, ["large-card-difference"]);
  await page
    .getByRole("button", { name: "Review statement", exact: true })
    .click();
  const totals = page.getByRole("dialog", {
    name: "Check statement totals",
    exact: true,
  });
  await expect(totals).toBeVisible();
  await totals
    .getByRole("button", { name: "Inspect statement details", exact: true })
    .click();
  const manual = page.getByRole("dialog", {
    name: "Statement totals",
    exact: true,
  });
  await expect(manual).toBeVisible();
  await expect(manual).toContainText("£0.01");
  await noDiagnosticStack(page);
  await page.screenshot({ path: info.outputPath("04-neutral-totals.png") });
  await manual
    .getByRole("button", { name: "Close statement review", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Confirm import", exact: true }),
  ).toBeDisabled();
  expect(await stored(page, "transactions")).toHaveLength(0);
});

test("the manual amount editor stays usable with keyboard-sized space in the light theme", async ({
  page,
}, info) => {
  test.setTimeout(120000);
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await select(page, ["beauty-code-correction", "known-bank-amex"]);
  await page
    .locator(".import-statement-card:visible")
    .filter({
      has: page.locator(".import-source-name", {
        hasText: "beauty-code-correction.pdf",
      }),
    })
    .getByText("Statement details", { exact: true })
    .click();
  await page.getByRole("button", { name: /Check transactions/ }).click();
  await page.getByRole("button", { name: /BEAUTY CODE/i }).click();
  const editor = page.getByRole("dialog", {
    name: "Correct amount",
    exact: true,
  });
  await page.setViewportSize({ width: 390, height: 470 });
  const amount = editor.getByLabel("Amount (GBP)", { exact: true });
  await amount.fill("80.00");
  await editor.getByRole("button", { name: "Money out", exact: true }).click();
  await noDiagnosticStack(page);
  expect(await page.evaluate(() => document.body.style.overflow)).toBe(
    "hidden",
  );
  const save = editor.getByRole("button", {
    name: "Save correction",
    exact: true,
  });
  await expect(save).toBeInViewport();
  await expect(amount).toBeInViewport();
  await page.screenshot({
    path: info.outputPath("06-light-keyboard-space.png"),
  });
  await save.click();
  await expect(
    page.getByRole("dialog", { name: "Check transactions", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Close statement review", exact: true })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await stored(page, "transactions")).toHaveLength(0);
  await expect(
    page.getByRole("button", { name: /All statements \(2\)/ }),
  ).toBeVisible();
});

test("layout recovery opens one column task with optional formats and layout saving collapsed", async ({
  page,
}, info) => {
  test.setTimeout(150000);
  await page.emulateMedia({ colorScheme: "dark" });
  await select(page, ["large-card-layout", "known-bank-amex"]);
  await page
    .locator(".import-statement-card:visible")
    .first()
    .getByRole("button", { name: "Review statement", exact: true })
    .click();
  const warning = page.getByRole("dialog", {
    name: "Check statement layout",
    exact: true,
  });
  await expect(warning).toBeVisible();
  await warning
    .getByRole("button", { name: "Inspect statement layout", exact: true })
    .click();
  const mapping = page.getByRole("dialog", {
    name: "Identify columns",
    exact: true,
  });
  await expect(mapping).toBeVisible();
  await noDiagnosticStack(page);
  await expect(
    mapping.getByLabel("Amount signs", { exact: true }),
  ).not.toBeVisible();
  await expect(
    mapping.getByLabel("Layout name", { exact: true }),
  ).not.toBeVisible();
  await expect(
    mapping.getByRole("button", { name: "Continue review", exact: true }),
  ).toHaveCount(1);
  await page.screenshot({
    path: info.outputPath("05-focused-column-step.png"),
  });
  await mapping
    .getByRole("button", { name: "Close statement review", exact: true })
    .click();
  expect(await stored(page, "transactions")).toHaveLength(0);
  await expect(
    page.getByRole("button", { name: /All statements \(2\)/ }),
  ).toBeVisible();
});
