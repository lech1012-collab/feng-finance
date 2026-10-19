import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import {
  test,
  expect,
  acknowledgeBeta,
  type Page,
  type Locator,
} from "./fixtures";
import { startStaticHost } from "./static-host";

const fixture = (name: string) =>
  resolve(`tests/fixtures/known-bank-${name}.pdf`);
const banks = ["barclays-current", "barclaycard", "amex", "revolut"];

async function records(page: Page, name: string) {
  return page.evaluate(
    (storeName) =>
      new Promise<Record<string, unknown>[]>((resolveRows, reject) => {
        const opening = indexedDB.open("feng-finance");
        opening.onerror = () => reject(opening.error);
        opening.onsuccess = () => {
          const database = opening.result;
          const tx = database.transaction(storeName, "readonly");
          const request = tx.objectStore(storeName).getAll();
          tx.oncomplete = () => {
            database.close();
            resolveRows(request.result as Record<string, unknown>[]);
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    name,
  );
}

async function openImport(page: Page) {
  await page.goto("/#/import");
  await expect(
    page.getByRole("heading", { name: "Import statements", exact: true }),
  ).toBeVisible();
}

function statement(page: Page, filename: string) {
  return page.locator(".import-statement-card").filter({
    has: page.locator(".import-source-name").filter({ hasText: filename }),
  });
}

async function expand(card: Locator) {
  if (!(await card.evaluate((node) => (node as HTMLDetailsElement).open)))
    await card.locator(":scope > summary").click();
}

async function expectNativeLedger(page: Page) {
  const transactions = await records(page, "transactions");
  const statements = await records(page, "statements");
  expect(transactions).toHaveLength(25);
  expect(statements).toHaveLength(4);
  for (const [profile, count, opening, closing] of [
    ["barclays-current", 6, 100000, 105000],
    ["barclaycard", 6, -90000, -10968],
    ["amex", 7, -120000, -16000],
    ["revolut", 6, 50000, 94000],
  ] as const) {
    expect(
      statements.find((row) => row.bankProfileId === profile),
    ).toMatchObject({
      transactionCount: count,
      openingBalance: opening,
      closingBalance: closing,
      validationStatus: "reconciled",
      validationDifference: 0,
    });
  }
  expect(
    transactions.every((row) => String(row.parseRowId).startsWith("bank:")),
  ).toBe(true);
  // Two genuine same-day identical purchases are retained.
  const card = statements.find((row) => row.bankProfileId === "barclaycard")!;
  expect(
    transactions.filter(
      (row) =>
        row.statementId === card.id &&
        /fictional cafe/i.test(String(row.description)),
    ),
  ).toHaveLength(2);
}

test("Home opens one multiple-file picker; four ready PDFs need one confirmation and no routine checkboxes", async ({
  page,
}) => {
  const chooser = page.waitForEvent("filechooser");
  await page
    .getByRole("button", { name: "Import your first statement", exact: true })
    .click();
  const files = await chooser;
  expect(files.isMultiple()).toBe(true);
  await files.setFiles(banks.map(fixture));
  await expect(page.locator(".import-statement-card")).toHaveCount(4);
  const confirm = page.getByRole("button", {
    name: "Confirm import",
    exact: true,
  });
  await expect(confirm).toBeEnabled({ timeout: 120000 });
  await expect(
    page.getByRole("region", { name: "Batch review", exact: true }),
  ).toContainText("4 ready");
  await expect(page.locator(".import-statement-card[open]")).toHaveCount(0);
  await expect(
    page.locator(".import-review-list input[type=checkbox]:visible"),
  ).toHaveCount(0);
  expect(await records(page, "transactions")).toHaveLength(0);
  await confirm.click();
  await expect(
    page.getByRole("heading", { name: "Home", exact: true }),
  ).toBeVisible();
  await expectNativeLedger(page);
});

test("adding PDFs and cancelling the picker preserve prior category and row decisions; a repeated PDF stays visible and skipped", async ({
  page,
}) => {
  test.setTimeout(120000);
  await openImport(page);
  await page
    .getByLabel("Select statements", { exact: true })
    .setInputFiles(fixture("barclaycard"));
  const original = statement(page, "known-bank-barclaycard.pdf");
  await expand(original);
  await original
    .getByRole("button", { name: "All transactions (6)", exact: true })
    .click();
  const waitrose = original
    .locator(".review-row")
    .filter({ has: page.locator(".review-compact", { hasText: /waitrose/i }) });
  await expand(waitrose);
  await waitrose
    .getByRole("combobox", { name: "Category", exact: true })
    .selectOption({ label: "Shopping" });
  const travel = original.locator(".review-row").filter({
    has: page.locator(".review-compact", { hasText: /travel shop/i }),
  });
  await expand(travel);
  await travel
    .getByRole("button", { name: "Exclude transaction", exact: true })
    .click();
  await page
    .getByLabel("Select statements", { exact: true })
    .setInputFiles(fixture("amex"));
  await expect(page.locator(".import-statement-card")).toHaveCount(2);
  await expect(
    page.getByRole("region", { name: "Batch review", exact: true }),
  ).toBeVisible();
  await expand(original);
  await expand(waitrose);
  await expect(
    waitrose.getByRole("combobox", { name: "Category", exact: true }),
  ).toHaveValue("shopping");
  await expand(travel);
  await expect(
    travel.getByRole("button", { name: "Include transaction", exact: true }),
  ).toBeVisible();
  const chooser = page.waitForEvent("filechooser");
  await page.getByText("Add statements", { exact: true }).click();
  await (await chooser).setFiles([]);
  await expect(page.locator(".import-statement-card")).toHaveCount(2);
  await page
    .getByLabel("Select statements", { exact: true })
    .setInputFiles(fixture("barclaycard"));
  await expect(page.locator(".import-statement-card")).toHaveCount(3);
  await expect(
    page.getByRole("region", { name: "Batch review", exact: true }),
  ).toContainText("1 skipped");
  expect(await records(page, "transactions")).toHaveLength(0);
  await page
    .getByRole("button", { name: "Confirm import", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Home", exact: true }),
  ).toBeVisible();
  const imported = await records(page, "transactions");
  expect(imported).toHaveLength(12);
  expect(
    imported.find((row) => /waitrose/i.test(String(row.description))),
  ).toMatchObject({ categoryId: "shopping", categorySource: "manual" });
  expect(
    imported.some((row) => /travel shop/i.test(String(row.description))),
  ).toBe(false);
  expect(await records(page, "statements")).toHaveLength(2);
});

test("a mixed batch exposes one exception at a time and a failed balance cannot silently import", async ({
  page,
}) => {
  await openImport(page);
  await page.getByLabel("Select statements", { exact: true }).setInputFiles([
    {
      name: "known-bank-barclays-current.pdf",
      mimeType: "application/pdf",
      buffer: await readFile(fixture("barclays-current")),
    },
    {
      name: "known-bank-barclays-malformed.pdf",
      mimeType: "application/pdf",
      buffer: await readFile(fixture("barclays-malformed")),
    },
    {
      name: "unreadable.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("not a PDF"),
    },
  ]);
  await expect(
    page.getByRole("region", { name: "Batch review", exact: true }),
  ).toContainText("2 need attention");
  await expect(page.locator(".import-statement-card[open]")).toHaveCount(1);
  const confirm = page.getByRole("button", {
    name: "Confirm import",
    exact: true,
  });
  await expect(confirm).toBeDisabled();
  expect(await records(page, "transactions")).toHaveLength(0);
  const current = await page
    .locator(".import-statement-card[open] .import-source-name")
    .textContent();
  await page
    .getByRole("button", { name: "Review next statement", exact: true })
    .click();
  await expect(
    page.locator(".import-statement-card[open] .import-source-name"),
  ).not.toHaveText(current!);
  await expect(
    page.locator(".import-statement-card[open] > summary"),
  ).toBeFocused();
  await page
    .locator(".import-statement-card[open]")
    .getByRole("button", { name: "Leave out this statement", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Review next statement", exact: true })
    .click();
  const remaining = page.locator(".import-statement-card[open]");
  await remaining
    .getByRole("button", { name: "Leave out this statement", exact: true })
    .click();
  await expect(confirm).toBeEnabled();
  const bad = statement(page, "known-bank-barclays-malformed.pdf");
  await expand(bad);
  await bad
    .getByRole("button", { name: "Include and recheck statement", exact: true })
    .click();
  await expect(bad).toHaveClass(/import-statement-blocking/);
  await expect(confirm).toBeDisabled();
  await bad
    .getByRole("button", { name: "Leave out this statement", exact: true })
    .click();
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(
    page.getByRole("heading", { name: "Home", exact: true }),
  ).toBeVisible();
  expect(await records(page, "transactions")).toHaveLength(6);
  expect(await records(page, "statements")).toHaveLength(1);
});

test("four native PDFs import offline without financial requests", async ({
  page,
}) => {
  test.setTimeout(120000);
  const host = await startStaticHost();
  try {
    await page.goto(`${host.origin}/#/`);
    await acknowledgeBeta(page);
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await expect
      .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
      .toBe(true);
    const requests: Array<{
      host: string;
      method: string;
      body: string | null;
    }> = [];
    page.on("request", (request) => {
      if (request.url().startsWith("http"))
        requests.push({
          host: new URL(request.url()).host,
          method: request.method(),
          body: request.postData(),
        });
    });
    // A stopped origin proves real offline operation. WebKit's setOffline
    // interception bypasses its service worker, including cached lazy modules.
    await host.stop();
    const cold = await page.reload();
    expect(cold?.fromServiceWorker()).toBe(true);
    await page.goto(`${host.origin}/#/import`);
    await expect(
      page.getByRole("heading", { name: "Import statements", exact: true }),
    ).toBeVisible();
    await page
      .getByLabel("Select statements", { exact: true })
      .setInputFiles(banks.map(fixture));
    const confirm = page.getByRole("button", {
      name: "Confirm import",
      exact: true,
    });
    await expect(confirm).toBeEnabled({ timeout: 90000 });
    await confirm.click();
    await expect(
      page.getByRole("heading", { name: "Home", exact: true }),
    ).toBeVisible();
    await expectNativeLedger(page);
    expect(
      requests.filter(
        (row) =>
          row.host !== new URL(page.url()).host ||
          row.method !== "GET" ||
          row.body !== null,
      ),
    ).toEqual([]);
  } finally {
    await host.stop();
  }
});

for (const setup of [
  { id: "320", width: 320, height: 568 },
  { id: "375", width: 375, height: 667 },
  { id: "390-dark", width: 390, height: 844 },
  { id: "390-light", width: 390, height: 844, light: true },
  { id: "390-text200", width: 390, height: 844, large: true },
  { id: "1024", width: 1024, height: 768 },
  { id: "1440", width: 1440, height: 900 },
]) {
  test(`Import layout stays bounded with long filenames and source review at ${setup.id}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: setup.width, height: setup.height });
    await page.emulateMedia({
      colorScheme: "light" in setup ? "light" : "dark",
      reducedMotion: "reduce",
    });
    await openImport(page);
    if ("large" in setup)
      await page.addStyleTag({ content: "html{font-size:200%!important}" });
    const filename =
      "MonthlyStatementForMyPersonalCurrentAccount".repeat(4) +
      "_October2026.pdf";
    await page.getByLabel("Select statements", { exact: true }).setInputFiles({
      name: filename,
      mimeType: "application/pdf",
      buffer: await readFile(fixture("barclays-current")),
    });
    const card = statement(page, filename);
    await expand(card);
    await expect(
      card.getByText("✓ Statement reconciled", { exact: true }),
    ).toBeVisible();
    await card.locator(".import-statement-figures > summary").click();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(setup.width + 1);
    await card
      .getByRole("button", { name: "All transactions (6)", exact: true })
      .click();
    await expand(card.locator(".review-row").first());
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(setup.width + 1);
    const wrappingAmounts = await page
      .locator(".import-workspace .validation dd, .review-compact > strong")
      .evaluateAll((nodes) =>
        nodes
          .filter((node) => {
            const text = document.createRange();
            text.selectNodeContents(node);
            const rects = [...text.getClientRects()].filter(
              (rect) => rect.width > 0 && rect.height > 0,
            );
            return new Set(rects.map((rect) => Math.round(rect.top))).size > 1;
          })
          .map((node) => node.textContent),
      );
    expect(wrappingAmounts).toEqual([]);
    await page
      .getByLabel("Select statements", { exact: true })
      .setInputFiles(fixture("barclays-malformed"));
    const bad = statement(page, "known-bank-barclays-malformed.pdf");
    await expand(bad);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(setup.width + 1);
    if (setup.id === "390-dark" || setup.id === "390-light") {
      const accessibility = await new AxeBuilder({ page })
        .include(".import-workspace")
        .analyze();
      expect(
        accessibility.violations.filter(
          (violation) =>
            violation.impact === "critical" || violation.impact === "serious",
        ),
      ).toEqual([]);
    }
  });
}

for (const setup of [
  { id: "320", width: 320, height: 568 },
  { id: "390-text200", width: 390, height: 844, large: true },
  { id: "1440", width: 1440, height: 900 },
]) {
  test(`Unverified confirmation and generic mapping remain usable at ${setup.id}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: setup.width, height: setup.height });
    await openImport(page);
    if ("large" in setup)
      await page.addStyleTag({ content: "html{font-size:200%!important}" });
    await page
      .getByLabel("Select statements", { exact: true })
      .setInputFiles(resolve("tests/fixtures/barclays-warning.pdf"));
    await expect(
      page.getByRole("region", { name: "Batch review", exact: true }),
    ).toBeVisible();
    const warning = statement(page, "barclays-warning.pdf");
    await expand(warning);
    const trigger = warning.getByRole("button", {
      name: "Import anyway…",
      exact: true,
    });
    await trigger.click();
    const risk = page.getByRole("dialog", {
      name: "Import an unverified statement?",
      exact: true,
    });
    await expect(risk).toBeVisible();
    await expect(
      risk.getByRole("button", {
        name: "Accept unverified statement",
        exact: true,
      }),
    ).toBeDisabled();
    await expect(risk).toContainText("Balance difference");
    const riskGeometry = await risk.evaluate((node) => ({
      left: node.getBoundingClientRect().left,
      right: node.getBoundingClientRect().right,
      width: node.clientWidth,
      scroll: node.scrollWidth,
    }));
    expect(riskGeometry.left).toBeGreaterThanOrEqual(-1);
    expect(riskGeometry.right).toBeLessThanOrEqual(setup.width + 1);
    expect(riskGeometry.scroll).toBeLessThanOrEqual(riskGeometry.width + 1);
    await risk
      .getByRole("button", { name: "Continue reviewing", exact: true })
      .click();
    await expect(risk).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(
      page.getByRole("button", { name: "Confirm import", exact: true }),
    ).toBeDisabled();
    expect(await records(page, "transactions")).toHaveLength(0);
    // An unfamiliar bank keeps the generic route available without putting
    // this technical mapping sheet in the native-bank happy path.
    await page
      .getByRole("button", { name: "Discard review", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "Discard this review?", exact: true })
      .getByRole("button", { name: "Discard review", exact: true })
      .click();
    await expect(page.locator(".import-statement-card")).toHaveCount(0);
    await page
      .getByLabel("Select statements", { exact: true })
      .setInputFiles(fixture("hsbc"));
    await expect(
      page.getByRole("region", { name: "Batch review", exact: true }),
    ).toBeVisible();
    const hsbc = statement(page, "known-bank-hsbc.pdf");
    await expand(hsbc);
    const details = hsbc.locator(
      ".generic-import-review .generic-parser-details",
    );
    await expand(details);
    const mappingTrigger = hsbc.getByRole("button", {
      name: "Map columns",
      exact: true,
    });
    await mappingTrigger.click();
    const mapping = page.getByRole("dialog", {
      name: "Map columns",
      exact: true,
    });
    await expect(mapping).toBeVisible();
    const mappingGeometry = await mapping.evaluate((node) => ({
      left: node.getBoundingClientRect().left,
      right: node.getBoundingClientRect().right,
      width: node.clientWidth,
      scroll: node.scrollWidth,
    }));
    expect(mappingGeometry.left).toBeGreaterThanOrEqual(-1);
    expect(mappingGeometry.right).toBeLessThanOrEqual(setup.width + 1);
    expect(mappingGeometry.scroll).toBeLessThanOrEqual(
      mappingGeometry.width + 1,
    );
    const inputSizes = await mapping
      .locator("input:visible,select:visible")
      .evaluateAll((nodes) =>
        nodes.map((node) => parseFloat(getComputedStyle(node).fontSize)),
      );
    expect(inputSizes.length).toBeGreaterThan(0);
    expect(Math.min(...inputSizes)).toBeGreaterThanOrEqual(16);
    await mapping
      .getByRole("button", { name: "Close Map columns", exact: true })
      .click();
    await expect(mappingTrigger).toBeFocused();
    expect(await records(page, "transactions")).toHaveLength(0);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(setup.width + 1);
  });
}

test("desktop drops select a batch once and append more PDFs without duplicate drop handling", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openImport(page);
  async function drop(names: string[], target: string) {
    const payloads = await Promise.all(
      names.map(async (name) => ({
        name: `known-bank-${name}.pdf`,
        bytes: [...(await readFile(fixture(name)))],
      })),
    );
    await page.locator(target).evaluate((node, payloads) => {
      const transfer = new DataTransfer();
      for (const payload of payloads)
        transfer.items.add(
          new File([new Uint8Array(payload.bytes)], payload.name, {
            type: "application/pdf",
          }),
        );
      node.dispatchEvent(
        new DragEvent("drop", {
          bubbles: true,
          cancelable: true,
          dataTransfer: transfer,
        }),
      );
    }, payloads);
    await expect(
      page.getByRole("region", { name: "Batch review", exact: true }),
    ).toBeVisible();
  }
  await drop(banks.slice(0, 3), ".upload-card");
  await expect(page.locator(".import-statement-card")).toHaveCount(3);
  await drop([banks[3]], ".import-batch-summary");
  await expect(page.locator(".import-statement-card")).toHaveCount(4);
  await expect(
    page.getByRole("region", { name: "Batch review", exact: true }),
  ).toContainText("4 ready");
  expect(await records(page, "transactions")).toHaveLength(0);
  await page
    .getByRole("button", { name: "Confirm import", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Home", exact: true }),
  ).toBeVisible();
  await expectNativeLedger(page);
});
