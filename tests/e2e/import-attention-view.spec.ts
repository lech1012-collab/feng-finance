import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test, expect, type Page } from "./fixtures";
import { showStatementDetails } from "./import-actions";

const fixture = (name: string) =>
  resolve(`tests/fixtures/known-bank-${name}.pdf`);
const view = (page: Page) =>
  page.getByRole("group", { name: "Statement view", exact: true });
const finalSummary = (page: Page) =>
  page.getByRole("region", { name: "Import summary", exact: true });

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

async function firstImport(page: Page) {
  await page.goto("/#/import");
  await page
    .getByLabel("Select statements", { exact: true })
    .setInputFiles(fixture("barclays-current"));
  await expect(view(page)).toBeVisible({ timeout: 90000 });
  await page
    .getByRole("button", { name: "Confirm import", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Home", exact: true }),
  ).toBeVisible();
  expect(await records(page, "transactions")).toHaveLength(6);
}

test("21 PDFs default to two exceptions; filtering never excludes hidden ready statements or bypasses blockers", async ({
  page,
}, testInfo) => {
  test.setTimeout(180000);
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await firstImport(page);
  const originalRows = await records(page, "transactions");
  const duplicate = await readFile(fixture("barclays-current"));
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("link", { name: "Import", exact: true }).click();
  await (
    await chooser
  ).setFiles([
    ...Array.from({ length: 17 }, (_, index) => ({
      name: `Previously-imported-${index + 1}.pdf`,
      mimeType: "application/pdf",
      buffer: duplicate,
    })),
    ...(await Promise.all(
      ["barclaycard", "amex", "barclays-malformed"].map(async (name) => ({
        name: `known-bank-${name}.pdf`,
        mimeType: "application/pdf",
        buffer: await readFile(fixture(name)),
      })),
    )),
    {
      name: "Unreadable.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("not a PDF"),
    },
  ]);
  const attention = view(page).getByRole("button", {
    name: "Needs attention (2)",
    exact: true,
  });
  const all = view(page).getByRole("button", {
    name: "All statements (21)",
    exact: true,
  });
  await expect(attention).toHaveAttribute("aria-pressed", "true", {
    timeout: 120000,
  });
  await expect(page.locator(".import-statement-card:visible")).toHaveCount(2);
  await expect(
    page.getByRole("region", { name: "Batch review", exact: true }),
  ).toContainText("17 skipped");
  const confirm = finalSummary(page).getByRole("button", {
    name: "Confirm import",
    exact: true,
  });
  await expect(confirm).toBeDisabled();
  expect(await records(page, "transactions")).toEqual(originalRows);
  await attention.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath("attention-21-files.png"),
  });
  await all.click();
  await expect(page.locator(".import-statement-card:visible")).toHaveCount(21);
  await expect(confirm).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath("all-21-files.png") });
  await attention.click();
  await expect(page.locator(".import-statement-card:visible")).toHaveCount(2);
  await page.getByRole("link", { name: "Transactions", exact: true }).click();
  let pickerOpened = false;
  page.on("filechooser", () => {
    pickerOpened = true;
  });
  await page.getByRole("link", { name: "Import", exact: true }).click();
  expect(pickerOpened).toBe(false);
  await expect(attention).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".import-statement-card:visible")).toHaveCount(2);

  for (let remaining = 1; remaining >= 0; remaining--) {
    const current = page
      .locator(".import-review-entry:visible")
      .filter({ has: page.locator(".import-statement-card[open]") });
    await current
      .getByRole("button", { name: "Leave out this statement", exact: true })
      .click();
    await expect(
      view(page).getByRole("button", {
        name: `Needs attention (${remaining})`,
        exact: true,
      }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      current.getByText("This statement will be skipped.", { exact: true }),
    ).toBeVisible();
    await current
      .getByRole("button", { name: "Continue", exact: true })
      .click();
  }
  await expect(page.locator(".import-statement-card:visible")).toHaveCount(0);
  await expect(finalSummary(page)).toBeFocused();
  await expect(confirm).toBeEnabled();
  expect(
    await finalSummary(page).evaluate(
      (node) => getComputedStyle(node).position,
    ),
  ).toBe("static");
  await page.screenshot({
    path: testInfo.outputPath("final-confirmation.png"),
  });
  await confirm.click();
  await expect(
    page.getByRole("heading", { name: "Home", exact: true }),
  ).toBeVisible();
  const statements = await records(page, "statements");
  expect(statements).toHaveLength(3);
  expect(await records(page, "transactions")).toHaveLength(19);
  for (const [profile, count, closing] of [
    ["barclays-current", 6, 105000],
    ["barclaycard", 6, -10968],
    ["amex", 7, -16000],
  ] as const) {
    expect(
      statements.find((row) => row.bankProfileId === profile),
    ).toMatchObject({
      transactionCount: count,
      closingBalance: closing,
      validationStatus: "reconciled",
      validationDifference: 0,
    });
  }
});

test("all-ready review is compact and duplicate-only completion releases the review without changing imported records", async ({
  page,
}, testInfo) => {
  await page.goto("/#/import");
  await page
    .getByLabel("Select statements", { exact: true })
    .setInputFiles(fixture("barclays-current"));
  await expect(
    view(page).getByRole("button", {
      name: "Needs attention (0)",
      exact: true,
    }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".import-statement-card:visible")).toHaveCount(0);
  await expect(page.getByText(/No statements need attention\./)).toBeVisible();
  const confirm = finalSummary(page).getByRole("button", {
    name: "Confirm import",
    exact: true,
  });
  await expect(confirm).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: testInfo.outputPath("all-ready.png") });
  await confirm.click();
  await expect(
    page.getByRole("heading", { name: "Home", exact: true }),
  ).toBeVisible();
  const before = {
    transactions: await records(page, "transactions"),
    statements: await records(page, "statements"),
  };
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("link", { name: "Import", exact: true }).click();
  await (await chooser).setFiles(fixture("barclays-current"));
  await expect(
    view(page).getByRole("button", {
      name: "Needs attention (0)",
      exact: true,
    }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".import-statement-card:visible")).toHaveCount(0);
  await expect(finalSummary(page)).toContainText("No changes to save.");
  await expect(
    page.getByRole("button", { name: "Confirm import", exact: true }),
  ).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("duplicate-only.png") });
  await finalSummary(page)
    .getByRole("button", { name: "Back to Home", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Home", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".import-statement-card")).toHaveCount(0);
  expect(await records(page, "transactions")).toEqual(before.transactions);
  expect(await records(page, "statements")).toEqual(before.statements);
  const next = page.waitForEvent("filechooser");
  await page.getByRole("link", { name: "Import", exact: true }).click();
  await (await next).setFiles([]);
});

for (const setup of [
  { width: 320, height: 568 },
  { width: 390, height: 844, large: true },
  { width: 1440, height: 900 },
]) {
  test(`confirmation scrolls in document flow without obscuring statements at ${setup.width}${"large" in setup ? " text200" : ""}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(setup);
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await page.goto("/#/import");
    if ("large" in setup)
      await page.addStyleTag({ content: "html{font-size:200%!important}" });
    await page
      .getByLabel("Select statements", { exact: true })
      .setInputFiles(fixture("barclays-current"));
    await expect(view(page)).toBeVisible({ timeout: 90000 });
    await view(page).evaluate((node) =>
      node.scrollIntoView({ block: "center" }),
    );
    const filters = view(page).getByRole("button");
    for (const filter of await filters.all()) {
      expect(
        await filter.evaluate(
          (node) => node.scrollWidth <= node.clientWidth + 1,
        ),
      ).toBe(true);
      expect((await filter.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    if ("large" in setup) {
      const first = (await filters.nth(0).boundingBox())!;
      const second = (await filters.nth(1).boundingBox())!;
      expect(second.y).toBeGreaterThanOrEqual(first.y + first.height);
    }
    await page.screenshot({
      path: testInfo.outputPath("attention-filters.png"),
    });
    await view(page)
      .getByRole("button", { name: "All statements (1)", exact: true })
      .click();
    const card = page.locator(".import-statement-card");
    await card.locator(":scope > summary").click();
    await showStatementDetails(card);
    await card
      .getByRole("button", { name: "All transactions (6)", exact: true })
      .click();
    await page.evaluate(() => window.scrollTo(0, 0));
    const summary = finalSummary(page);
    expect(
      await summary.evaluate((node) => getComputedStyle(node).position),
    ).toBe("static");
    const before = await summary.evaluate(
      (node) => node.getBoundingClientRect().top,
    );
    await page.screenshot({
      path: testInfo.outputPath("scrolling-review.png"),
    });
    await summary.scrollIntoViewIfNeeded();
    const after = await summary.evaluate(
      (node) => node.getBoundingClientRect().top,
    );
    expect(after).toBeLessThan(before - 40);
    const button = summary.getByRole("button", {
      name: "Confirm import",
      exact: true,
    });
    await expect(button).toBeInViewport({ ratio: 1 });
    const size = await button.boundingBox();
    expect(size!.height).toBeGreaterThanOrEqual(44);
    if (!("large" in setup)) expect(size!.height).toBeLessThanOrEqual(52);
    const nav = page.locator(".mobile-navigation");
    if (await nav.isVisible())
      expect(size!.y + size!.height).toBeLessThanOrEqual(
        (await nav.boundingBox())!.y + 1,
      );
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(setup.width + 1);
    await page.screenshot({
      path: testInfo.outputPath("in-flow-confirmation.png"),
    });
  });
}
