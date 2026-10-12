import { resolve } from "node:path";
import { test as base, expect, acknowledgeBeta, type Page } from "./fixtures";
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
const fixture = (name: string) => resolve(`tests/fixtures/${name}.pdf`);

async function records(page: Page) {
  return page.evaluate(
    () =>
      new Promise<{
        transactions: Array<{
          amount: number;
          date: string;
          description: string;
          parseSource?: string;
          sourcePage: number;
        }>;
        statements: Array<{
          openingBalance?: number;
          closingBalance?: number;
          validationStatus: string;
          validationDifference?: number;
          validationPolicy?: string;
          extractionMethod: string;
          unreadPages?: number[];
        }>;
        attachments: number;
        diagnostics: number;
      }>((resolveRecords, reject) => {
        const opening = indexedDB.open("feng-finance");
        opening.onerror = () => reject(opening.error);
        opening.onsuccess = () => {
          const database = opening.result;
          const transaction = database.transaction(
            ["transactions", "statements", "attachments", "importDiagnostics"],
            "readonly",
          );
          const transactions = transaction.objectStore("transactions").getAll();
          const statements = transaction.objectStore("statements").getAll();
          const attachments = transaction.objectStore("attachments").count();
          const diagnostics = transaction
            .objectStore("importDiagnostics")
            .count();
          transaction.oncomplete = () => {
            database.close();
            resolveRecords({
              transactions: transactions.result,
              statements: statements.result,
              attachments: attachments.result,
              diagnostics: diagnostics.result,
            });
          };
          transaction.onerror = () => {
            database.close();
            reject(transaction.error);
          };
        };
      }),
  );
}

async function privateInstalledApp(page: Page, host: LocalHost) {
  await page.goto(`${host.origin}/#/`);
  await acknowledgeBeta(page);
  await page.goto(`${host.origin}/#/settings`);
  const rates = page.getByLabel("Download public ECB rates");
  if (await rates.isChecked()) {
    await rates.uncheck();
    await expect(page.getByText("Rate preference saved.")).toBeVisible();
  }
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true);
  const assets = await page.evaluate(async () => {
    const keys = (
      await Promise.all(
        (await caches.keys()).map(async (key) =>
          (await (await caches.open(key)).keys()).map((request) => request.url),
        ),
      )
    ).flat();
    return {
      pdfWorker: keys.some((url) => /pdf\.worker.*\.mjs/.test(url)),
      parentWorker: keys.some((url) => /ocr-runtime\.worker.*\.js/.test(url)),
      ocrWorker: keys.some((url) => /\/ocr\/worker\.min\.js/.test(url)),
      language: keys.some((url) => /\/ocr\/eng\.traineddata\.gz/.test(url)),
      wasm: keys.some((url) => /\/ocr\/.*\.wasm/.test(url)),
    };
  });
  expect(assets).toEqual({
    pdfWorker: true,
    parentWorker: true,
    ocrWorker: true,
    language: true,
    wasm: true,
  });
  await host.stop();
  // A real unavailable origin preserves Safari's normal blob URL behavior.
  // Playwright setOffline bypasses WebKit's service worker and breaks local blobs.
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();
  await page.goto(`${host.origin}/#/import`);
  await expect(
    page.getByRole("heading", { name: "Import statements", exact: true }),
  ).toBeVisible();
}

async function select(page: Page, name: string) {
  await page
    .getByLabel("Select statements", { exact: true })
    .setInputFiles(fixture(name));
  await expect(page.locator(".import-review-list")).toBeVisible({
    timeout: 150000,
  });
  const card = page.locator(".import-statement-card").first();
  if (!(await card.evaluate((node) => (node as HTMLDetailsElement).open)))
    await card.locator(":scope > summary").click();
  return card;
}

test("a scanned statement imports offline from cached local OCR assets without sending financial data", async ({
  page,
  context,
  offlineHost,
}) => {
  test.setTimeout(180000);
  await privateInstalledApp(page, offlineHost);
  const network: Array<{ url: string; method: string; body: string | null }> =
    [];
  const errors: string[] = [];
  context.on("request", (request) => {
    if (/^https?:/.test(request.url()))
      network.push({
        url: request.url(),
        method: request.method(),
        body: request.postData(),
      });
  });
  page.on("pageerror", (error) => errors.push(error.message));
  const card = await select(page, "ocr-generic");
  const proof = card.getByRole("region", {
    name: "Statement reading and checks",
  });
  await expect(proof).toContainText("Statement figures match exactly");
  await expect(proof).toContainText("Read from image");
  await expect(
    page.getByRole("button", { name: "Confirm import", exact: true }),
  ).toBeEnabled();
  expect((await records(page)).transactions).toHaveLength(0);
  await page
    .getByRole("button", { name: "Confirm import", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Home", exact: true }),
  ).toBeVisible();
  const saved = await records(page);
  expect(saved.transactions).toHaveLength(2);
  expect(
    saved.transactions
      .map((transaction) => transaction.amount)
      .sort((a, b) => a - b),
  ).toEqual([-7843, 220000]);
  expect(
    saved.transactions.every(
      (transaction) =>
        transaction.parseSource === "ocr" && transaction.sourcePage === 1,
    ),
  ).toBe(true);
  expect(saved.statements).toHaveLength(1);
  expect(saved.statements[0]).toMatchObject({
    openingBalance: 50000,
    closingBalance: 262157,
    validationDifference: 0,
    validationStatus: "reconciled",
    validationPolicy: "exact-v2.2",
    extractionMethod: "OCR",
  });
  expect(saved.attachments).toBe(0);
  expect(saved.diagnostics).toBe(0);
  expect(errors).toEqual([]);
  expect(
    network.every(
      (request) =>
        new URL(request.url).origin === offlineHost.origin &&
        request.method === "GET" &&
        request.body === null &&
        /^(?:\/(?:assets|ocr|pdfjs)\/|\/(?:sw\.js|index\.html)?$)/.test(
          new URL(request.url).pathname,
        ),
    ),
  ).toBe(true);
});

test("unusable embedded transaction text automatically falls back to local image reading", async ({
  page,
}) => {
  test.setTimeout(180000);
  await page.goto("/#/import");
  const card = await select(page, "ocr-garbled");
  const proof = card.getByRole("region", {
    name: "Statement reading and checks",
  });
  await expect(proof).toContainText("Statement figures match exactly");
  await expect(proof).toContainText("Read from image");
  await page
    .getByRole("button", { name: "Confirm import", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Home", exact: true }),
  ).toBeVisible();
  const saved = await records(page);
  expect(
    saved.transactions
      .map((transaction) => transaction.amount)
      .sort((a, b) => a - b),
  ).toEqual([-7843, 220000]);
  expect(
    saved.transactions.every(
      (transaction) => !transaction.description.includes("#@!~?"),
    ),
  ).toBe(true);
  expect(saved.statements[0]).toMatchObject({
    validationStatus: "reconciled",
    validationDifference: 0,
    extractionMethod: "OCR",
  });
});

test("stopping scanned-page reading retains completed rows and requires explicit unverified import for unread pages", async ({
  page,
  offlineHost,
}) => {
  test.setTimeout(180000);
  await privateInstalledApp(page, offlineHost);
  await page
    .getByLabel("Select statements", { exact: true })
    .setInputFiles(fixture("ocr-cancel"));
  const progress = page.getByRole("region", { name: "Checking statements" });
  await expect(progress).toContainText("Reading scanned page 2 of 2", {
    timeout: 150000,
  });
  await progress.getByRole("button", { name: "Stop processing" }).click();
  await expect(page.locator(".import-review-list")).toBeVisible({
    timeout: 30000,
  });
  const card = page.locator(".import-statement-card").first();
  if (!(await card.evaluate((node) => (node as HTMLDetailsElement).open)))
    await card.locator(":scope > summary").click();
  await expect(card).toContainText("Not imported: unread pages 2.");
  await expect(card).toContainText("This statement is not verified yet");
  await expect(
    page.getByRole("button", { name: "Confirm import", exact: true }),
  ).toBeDisabled();
  expect((await records(page)).transactions).toHaveLength(0);
  await card
    .getByRole("button", { name: "Import anyway…", exact: true })
    .click();
  const warning = page.getByRole("dialog", {
    name: "Import an unverified statement?",
  });
  await expect(warning).toContainText("Pages 2 have not been read");
  await expect(
    warning.getByRole("button", {
      name: "Import unverified statement",
      exact: true,
    }),
  ).toBeDisabled();
  await warning
    .getByLabel(
      "I checked the original statement and accept importing these unverified figures.",
    )
    .check();
  await warning
    .getByRole("button", { name: "Import unverified statement", exact: true })
    .click();
  await expect(warning).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Confirm import", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Confirm import", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Home", exact: true }),
  ).toBeVisible();
  const saved = await records(page);
  expect(saved.transactions).toHaveLength(2);
  expect(
    saved.transactions.every((transaction) => transaction.sourcePage === 1),
  ).toBe(true);
  expect(saved.statements[0]).toMatchObject({
    validationStatus: "warning",
    unreadPages: [2],
    extractionMethod: "OCR",
  });
});

test("a one-penny digital discrepancy stays unverified until the source amount is corrected", async ({
  page,
}) => {
  test.setTimeout(180000);
  await page.goto("/#/import");
  const card = await select(page, "generic-one-penny");
  const proof = card.getByRole("region", {
    name: "Statement reading and checks",
  });
  await expect(proof).toContainText("This statement is not verified yet");
  await expect(proof).toContainText("£0.01");
  await expect(
    page.getByRole("button", { name: "Confirm import", exact: true }),
  ).toBeDisabled();
  expect((await records(page)).transactions).toHaveLength(0);
  const row = card
    .locator(".generic-review-row")
    .filter({ has: page.locator("summary strong", { hasText: "WAITROSE" }) });
  const sourceCrop = row.getByRole("img", {
    name: "Original statement row on page 1",
  });
  await expect(sourceCrop).toBeVisible();
  await sourceCrop.evaluate(async (node) => {
    if (!(node instanceof HTMLImageElement))
      throw new Error("The original statement crop is not an image.");
    await node.decode();
  });
  expect(
    await sourceCrop.evaluate(
      (node) =>
        node instanceof HTMLImageElement &&
        node.complete &&
        node.naturalWidth > 0 &&
        node.naturalHeight > 0,
    ),
  ).toBe(true);
  await row
    .getByRole("button", { name: "Correct this row", exact: true })
    .click();
  await row.getByLabel("Amount (GBP)", { exact: true }).fill("-78.43");
  await row
    .getByRole("button", { name: "Save correction", exact: true })
    .click();
  await expect(proof).toContainText("Statement figures match exactly");
  await expect(
    page.getByRole("button", { name: "Confirm import", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Confirm import", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Home", exact: true }),
  ).toBeVisible();
  const saved = await records(page);
  expect(
    saved.transactions
      .map((transaction) => transaction.amount)
      .sort((a, b) => a - b),
  ).toEqual([-7843, 220000]);
  expect(saved.statements[0]).toMatchObject({
    validationStatus: "reconciled",
    validationDifference: 0,
    validationPolicy: "exact-v2.2",
  });
});
