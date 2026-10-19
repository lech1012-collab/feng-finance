import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test, expect, type Page, type Locator } from "./fixtures";

test.use({ hasTouch: true });
const fixture = (name: string) =>
  resolve(`tests/fixtures/known-bank-${name}.pdf`);

async function records(page: Page, store: string) {
  return page.evaluate(
    (name) =>
      new Promise<Record<string, unknown>[]>((resolveRows, reject) => {
        const request = indexedDB.open("feng-finance");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const tx = database.transaction(name, "readonly");
          const rows = tx.objectStore(name).getAll();
          tx.oncomplete = () => {
            database.close();
            resolveRows(rows.result);
          };
          tx.onerror = () => {
            database.close();
            reject(tx.error);
          };
        };
      }),
    store,
  );
}
async function expand(node: Locator) {
  await expect(node).toBeVisible();
  if (!(await node.evaluate((element) => (element as HTMLDetailsElement).open)))
    await node.locator(":scope > summary").click();
}
function statement(page: Page, name: string) {
  return page
    .locator(".import-statement-card")
    .filter({ has: page.locator(".import-source-name", { hasText: name }) });
}
async function typeAmount(input: Locator, amount: string) {
  await input.tap();
  await input.press("ControlOrMeta+A");
  await input.press("Backspace");
  await expect(input).toHaveValue("");
  for (const character of amount) {
    await input.pressSequentially(character);
    await expect(input).toBeFocused();
  }
  await expect(input).toHaveValue(amount);
}
const correction = (page: Page) =>
  page.getByRole("dialog", { name: "Correct amount", exact: true });

test("four PDFs survive navigation during reading and review, including category choices and picker cancellation", async ({
  page,
}) => {
  test.setTimeout(150000);
  await page.goto("/#/import");
  await page
    .getByLabel("Select statements", { exact: true })
    .setInputFiles(
      ["barclays-current", "barclaycard", "amex", "revolut"].map(fixture),
    );
  await page.getByRole("link", { name: "Transactions", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Transactions", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".import-workspace:visible")).toHaveCount(0);
  let choosers = 0;
  page.on("filechooser", () => {
    choosers++;
  });
  await page.getByRole("link", { name: "Import", exact: true }).click();
  await expect(page.locator(".import-statement-card")).toHaveCount(4);
  const current = statement(page, "known-bank-barclaycard.pdf");
  await expand(current);
  await current
    .getByRole("button", { name: "All transactions (6)", exact: true })
    .click();
  const row = current
    .locator(".review-row")
    .filter({ has: page.locator(".review-compact", { hasText: /waitrose/i }) });
  await expand(row);
  await row
    .getByRole("combobox", { name: "Category", exact: true })
    .selectOption("shopping");
  await page.getByRole("link", { name: "Transactions", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Transactions", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Import", exact: true }).click();
  await expect(
    row.getByRole("combobox", { name: "Category", exact: true }),
  ).toHaveValue("shopping");
  await expect(current).toHaveAttribute("open");
  await expect(row).toHaveAttribute("open");
  expect(choosers).toBe(0);
  expect(await records(page, "transactions")).toHaveLength(0);
  const chooser = page.waitForEvent("filechooser");
  await page.getByText("Add statements", { exact: true }).click();
  await (await chooser).setFiles([]);
  await expect(page.locator(".import-statement-card")).toHaveCount(4);
  await expect(
    row.getByRole("combobox", { name: "Category", exact: true }),
  ).toHaveValue("shopping");
  await page
    .getByRole("button", { name: "Confirm import", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Home", exact: true }),
  ).toBeVisible();
  const rows = await records(page, "transactions");
  expect(rows).toHaveLength(25);
  expect(
    rows.find((row) => /waitrose/i.test(String(row.description))),
  ).toMatchObject({ categoryId: "shopping" });
  expect(await records(page, "statements")).toHaveLength(4);
  const nextChooser = page.waitForEvent("filechooser");
  await page.getByRole("link", { name: "Import", exact: true }).click();
  await (await nextChooser).setFiles([]);
});

test("the visible native amount opens one real editor, preserves typed input across route changes and rechecks every correction", async ({
  page,
}) => {
  test.setTimeout(150000);
  await page.getByRole("link", { name: "Transactions", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Transactions", exact: true }),
  ).toBeVisible();
  const picker = page.waitForEvent("filechooser");
  await page.getByRole("link", { name: "Import", exact: true }).click();
  await (await picker).setFiles(fixture("barclays-malformed"));
  const card = statement(page, "known-bank-barclays-malformed.pdf");
  await expand(card);
  await card.getByRole("button", { name: /All transactions/ }).click();
  const row = card
    .locator(".review-row")
    .filter({ hasText: /fictional grocer/i });
  await expect(row.getByRole("textbox", { name: /Amount for/ })).toHaveCount(0);
  await row.getByRole("button", { name: /Correct amount for .*grocer/i }).tap();
  const editor = correction(page);
  await expect(editor).toBeVisible();
  expect(
    await editor.evaluate(
      (node) => !!node.closest("details, .import-statement-card"),
    ),
  ).toBe(false);
  const input = editor.getByLabel("Amount (GBP)", { exact: true });
  await typeAmount(input, "80.");
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "Transactions", exact: true }),
  ).toBeVisible();
  await expect(editor).not.toBeVisible();
  await page.getByRole("link", { name: "Import", exact: true }).click();
  await expect(editor).toBeVisible();
  await expect(input).toHaveValue("80.");
  await input.tap();
  await input.press("End");
  await input.pressSequentially("01");
  await expect(input).toHaveValue("80.01");
  await editor
    .getByRole("button", { name: "Save amount", exact: true })
    .click();
  await expect(editor).toHaveCount(0);
  const confirm = page.getByRole("button", {
    name: "Confirm import",
    exact: true,
  });
  await expect(confirm).toBeDisabled();
  expect(await records(page, "transactions")).toHaveLength(0);
  await expect(card.locator(".review-row:visible")).toHaveCount(0);
  await card
    .locator(".generic-review-row")
    .filter({ hasText: /fictional grocer/i })
    .getByRole("button", { name: /Correct amount for .*grocer/i })
    .tap();
  await typeAmount(input, "80.00");
  await editor
    .getByRole("button", { name: "Save amount", exact: true })
    .click();
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(
    page.getByRole("heading", { name: "Home", exact: true }),
  ).toBeVisible();
  expect(
    (await records(page, "transactions"))
      .map((row) => row.amount)
      .sort((a, b) => Number(a) - Number(b)),
  ).toEqual([-8000, 200000]);
  expect(await records(page, "statements")).toEqual([
    expect.objectContaining({
      openingBalance: 50000,
      closingBalance: 242000,
      validationStatus: "reconciled",
      validationDifference: 0,
    }),
  ]);
});

for (const setup of [
  { width: 320, height: 568 },
  { width: 375, height: 667 },
  { width: 390, height: 844, large: true },
]) {
  test(`unread amount entry and wrapped source text stay stationary at ${setup.width}${"large" in setup ? " text200" : ""}`, async ({
    page,
    browserName,
  }, testInfo) => {
    test.setTimeout(120000);
    await page.setViewportSize({ width: setup.width, height: setup.height });
    await page.goto("/#/import");
    if ("large" in setup)
      await page.addStyleTag({ content: "html{font-size:200%!important}" });
    const name =
      "StatementWithAnExtremelyLongUnbrokenReference".repeat(5) + ".pdf";
    await page.getByLabel("Select statements", { exact: true }).setInputFiles({
      name,
      mimeType: "application/pdf",
      buffer: await readFile(
        resolve("tests/fixtures/beauty-code-correction.pdf"),
      ),
    });
    const card = statement(page, name);
    await expand(card);
    const horizontal = await card
      .locator(".import-source-name,.import-raw-reference,[data-source-text]")
      .evaluateAll((nodes) =>
        nodes
          .filter((n) => n.getBoundingClientRect().width > 0)
          .filter((n) => n.scrollWidth > n.clientWidth + 1)
          .map((n) => ({
            kind: n.className,
            width: n.clientWidth,
            scrollWidth: n.scrollWidth,
          })),
      );
    expect(horizontal).toEqual([]);
    const before = await card.evaluate(
      (node) => node.getBoundingClientRect().left,
    );
    if (browserName === "chromium") {
      await card.locator(".import-source-name").scrollIntoViewIfNeeded();
      const bounds = await card.locator(".import-source-name").boundingBox();
      if (!bounds) throw new Error("Source name is not laid out");
      const session = await page.context().newCDPSession(page);
      const point = {
        x: Math.min(setup.width - 40, bounds.x + bounds.width - 10),
        y: bounds.y + Math.min(bounds.height / 2, 30),
      };
      await session.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [point],
      });
      for (let step = 1; step <= 5; step++)
        await session.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x: Math.max(20, point.x - step * 35), y: point.y }],
        });
      await session.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      await session.detach();
    }
    expect(
      await card.evaluate((node) => node.getBoundingClientRect().left),
    ).toBe(before);
    expect(await page.evaluate(() => window.scrollX)).toBe(0);
    await card
      .getByRole("button", { name: /Correct amount for Beauty Code/i })
      .tap();
    const editor = correction(page);
    const input = editor.getByLabel("Amount (GBP)", { exact: true });
    await typeAmount(input, "80.00");
    await editor.getByRole("button", { name: "Money out", exact: true }).tap();
    await page.setViewportSize({ width: setup.width, height: 480 });
    const dimensions = await editor.evaluate((node) => ({
      left: node.getBoundingClientRect().left,
      right: node.getBoundingClientRect().right,
      width: node.clientWidth,
      scrollWidth: node.scrollWidth,
    }));
    expect(dimensions.left).toBeGreaterThanOrEqual(-1);
    expect(dimensions.right).toBeLessThanOrEqual(setup.width + 1);
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width + 1);
    await expect(
      editor.getByRole("button", { name: "Cancel correction", exact: true }),
    ).toBeInViewport({ ratio: 1 });
    await expect(
      editor.getByRole("button", { name: "Save amount", exact: true }),
    ).toBeInViewport({ ratio: 1 });
    await input.scrollIntoViewIfNeeded();
    await expect(input).toBeInViewport({ ratio: 1 });
    await editor
      .getByRole("button", { name: "Money out", exact: true })
      .scrollIntoViewIfNeeded();
    await expect(
      editor.getByRole("button", { name: "Money out", exact: true }),
    ).toBeInViewport({ ratio: 1 });
    await expect(
      editor.getByRole("button", { name: "Money in", exact: true }),
    ).toBeInViewport({ ratio: 1 });
    await input.tap();
    expect(
      await input.evaluate((node) =>
        parseFloat(getComputedStyle(node).fontSize),
      ),
    ).toBeGreaterThanOrEqual(16);
    await page.screenshot({
      path: testInfo.outputPath("direct-amount-editor.png"),
    });
    await editor
      .getByRole("button", { name: "Save amount", exact: true })
      .tap();
    await expect(
      page.getByRole("button", { name: "Confirm import", exact: true }),
    ).toBeEnabled();
    expect(await records(page, "transactions")).toHaveLength(0);
  });
}

test("discard is explicit, cancel keeps the batch, and confirmed discard never deletes imported records", async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.goto("/#/import");
  await page
    .getByLabel("Select statements", { exact: true })
    .setInputFiles(fixture("barclays-current"));
  await page
    .getByRole("button", { name: "Confirm import", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Home", exact: true }),
  ).toBeVisible();
  const originalTransactions = await records(page, "transactions");
  const originalStatements = await records(page, "statements");
  expect(originalTransactions).toHaveLength(6);
  await page.goto("/#/import");
  await page
    .getByLabel("Select statements", { exact: true })
    .setInputFiles([fixture("barclaycard"), fixture("revolut")]);
  await expect(page.locator(".import-statement-card")).toHaveCount(2);
  await page
    .getByRole("button", { name: "Discard review", exact: true })
    .click();
  const discard = page.getByRole("dialog", {
    name: "Discard this review?",
    exact: true,
  });
  await expect(discard).toBeVisible();
  await discard
    .getByRole("button", { name: "Keep review", exact: true })
    .click();
  await expect(page.locator(".import-statement-card")).toHaveCount(2);
  await page
    .getByRole("button", { name: "Discard review", exact: true })
    .click();
  await discard
    .getByRole("button", { name: "Discard review", exact: true })
    .click();
  await expect(page.locator(".import-statement-card")).toHaveCount(0);
  expect(await records(page, "transactions")).toEqual(originalTransactions);
  expect(await records(page, "statements")).toEqual(originalStatements);
  await page.getByRole("link", { name: "Transactions", exact: true }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("link", { name: "Import", exact: true }).click();
  await (await chooser).setFiles([]);
});

for (const source of [
  {
    bank: "barclaycard",
    merchant: /waitrose/i,
    amount: "80.00",
    count: 6,
    opening: -90000,
    closing: -10968,
    signed: -8000,
  },
  {
    bank: "amex",
    merchant: /fictional shop/i,
    amount: "100.00",
    count: 7,
    opening: -120000,
    closing: -16000,
    signed: -10000,
  },
  {
    bank: "revolut",
    merchant: /tax[- ]free childcare/i,
    amount: "300.00",
    count: 6,
    opening: 50000,
    closing: 94000,
    signed: -30000,
  },
]) {
  test(`desktop ${source.bank} amount correction uses the printed source and resumes from the sidebar`, async ({
    page,
  }) => {
    test.setTimeout(150000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/#/import");
    await page
      .getByLabel("Select statements", { exact: true })
      .setInputFiles(fixture(source.bank));
    const card = statement(page, `known-bank-${source.bank}.pdf`);
    await expand(card);
    await card
      .getByRole("button", {
        name: `All transactions (${source.count})`,
        exact: true,
      })
      .click();
    const row = card.locator(".review-row").filter({
      has: page.locator(".review-compact", { hasText: source.merchant }),
    });
    await row.getByRole("button", { name: /^Correct amount for / }).click();
    const editor = correction(page);
    await typeAmount(
      editor.getByLabel("Amount (GBP)", { exact: true }),
      source.amount,
    );
    await expect(
      editor.getByRole("button", { name: "Money out", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await editor
      .getByRole("button", { name: "Save amount", exact: true })
      .click();
    await expect(editor).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Confirm import", exact: true }),
    ).toBeEnabled();
    await page
      .locator(".sidebar")
      .getByRole("link", { name: "Transactions", exact: true })
      .click();
    let reopenedPicker = false;
    page.on("filechooser", () => {
      reopenedPicker = true;
    });
    await page
      .locator(".sidebar")
      .getByRole("button", { name: "Resume import (1)", exact: true })
      .click();
    await expect(card).toBeVisible();
    expect(reopenedPicker).toBe(false);
    expect(await records(page, "transactions")).toHaveLength(0);
    await page
      .getByRole("button", { name: "Confirm import", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Home", exact: true }),
    ).toBeVisible();
    const rows = await records(page, "transactions");
    expect(rows).toHaveLength(source.count);
    expect(
      rows.find((row) => source.merchant.test(String(row.description))),
    ).toMatchObject({ amount: source.signed });
    expect(await records(page, "statements")).toEqual([
      expect.objectContaining({
        openingBalance: source.opening,
        closingBalance: source.closing,
        validationStatus: "reconciled",
        validationDifference: 0,
      }),
    ]);
  });
}
