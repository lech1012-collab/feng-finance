import { settingsSection, loadDemoUi } from "./flows";
import {
  devices,
  expect,
  test as base,
  type Page,
  acknowledgeBeta,
} from "./fixtures";
import { readFile, rm } from "node:fs/promises";
import { startStaticHost, type LocalHost } from "./static-host";

const test = base.extend<{ offlineHost: LocalHost; receiptPage: Page }>({
  offlineHost: async ({}, use) => {
    const host = await startStaticHost();
    try {
      await use(host);
    } finally {
      await host.stop();
    }
  },
  receiptPage: async (
    { browserName, playwright, contextOptions, page },
    use,
    testInfo,
  ) => {
    if (browserName !== "webkit") {
      await use(page);
      return;
    }
    // Linux WebKit's ephemeral context rejects even a four-byte native Blob
    // in IndexedDB. A fresh persistent profile models installed Safari storage
    // and exercises the real compression, Blob writes and atomic Undo paths.
    const { defaultBrowserType: _browserType, ...iphone } =
      devices["iPhone 13"];
    const profile = testInfo.outputPath("webkit-receipt-profile");
    const context = await playwright.webkit.launchPersistentContext(profile, {
      ...iphone,
      ...contextOptions,
      viewport: testInfo.project.use.viewport ?? iphone.viewport,
    });
    const receiptPage = context.pages()[0] ?? (await context.newPage());
    try {
      await use(receiptPage);
    } finally {
      try {
        // Playwright's runner captures this persistent context's trace too.
        await context.close();
      } finally {
        await rm(profile, { recursive: true, force: true });
      }
    }
  },
});

async function settingsWithDemo(page: Page, origin = "") {
  await page.goto(`${origin}/#/settings`);
  await acknowledgeBeta(page);
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();
  await loadDemoUi(page);
}
async function records(page: Page, names: string[]) {
  return page.evaluate(
    (tables) =>
      new Promise<Record<string, unknown[]>>((resolve, reject) => {
        const request = indexedDB.open("feng-finance");
        request.onerror = () =>
          reject(new Error("Synthetic test database could not be opened."));
        request.onsuccess = () => {
          const database = request.result,
            transaction = database.transaction(tables, "readonly"),
            result: Record<string, unknown[]> = {};
          for (const name of tables) {
            const read = transaction.objectStore(name).getAll();
            read.onsuccess = () => {
              result[name] = read.result as unknown[];
            };
          }
          transaction.oncomplete = () => {
            database.close();
            resolve(result);
          };
          transaction.onabort = () => {
            database.close();
            reject(new Error("Synthetic test database could not be read."));
          };
        };
      }),
    names,
  );
}
async function expectNoHorizontalOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
}

test("app lock hides finances after background timeout and remains usable at 320 and 390 pixels", async ({
  page,
}, testInfo) => {
  await settingsWithDemo(page);
  await settingsSection(page, "security");
  const security = page.locator("#security");
  await security
    .getByRole("button", { name: "Set up app lock", exact: true })
    .click();
  await security
    .getByLabel("Choose a 6-digit app PIN", { exact: true })
    .fill("628391");
  await security.getByLabel("Confirm PIN", { exact: true }).fill("628391");
  await security.getByLabel("Lock after being away").selectOption("1");
  await security
    .getByRole("button", { name: "Enable app lock", exact: true })
    .click();
  await expect(
    security.getByText("App lock is on.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Where you stand", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    let visibility = "hidden";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibility,
    });
    document.dispatchEvent(new Event("visibilitychange"));
    const originalNow = Date.now;
    Date.now = () => originalNow() + 120000;
    visibility = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    Date.now = originalNow;
  });
  await expect(
    page.getByLabel("6-digit app PIN", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".feng-private-content")).toHaveCount(0);
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await expectNoHorizontalOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath(`app-lock-${width}.png`),
      fullPage: true,
    });
  }
  await page.getByLabel("6-digit app PIN", { exact: true }).fill("628391");
  await page.getByRole("button", { name: "Unlock", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Where you stand", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByLabel("6-digit app PIN", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".feng-private-content")).toHaveCount(0);
});

test("encrypted backups expose no financial text and wrong-password/cancel restores leave all records untouched", async ({
  page,
}, testInfo) => {
  await settingsWithDemo(page);
  await settingsSection(page, "backup");
  await page.getByRole("button", { name: "Save backup", exact: true }).click();
  const panel = page.locator("main");
  const saveSheet = page.getByRole("dialog", {
    name: "Save backup",
    exact: true,
  });
  await panel
    .getByLabel("Backup password", { exact: true })
    .fill("synthetic secret phrase 2026");
  await panel
    .getByLabel("Confirm backup password", { exact: true })
    .fill("synthetic secret phrase 2026");
  const downloading = page.waitForEvent("download");
  await saveSheet
    .getByRole("button", { name: "Save backup", exact: true })
    .click();
  const downloaded = await downloading,
    path = await downloaded.path();
  if (!path)
    throw new Error("Synthetic encrypted backup download was unavailable.");
  const contents = await readFile(path, "utf8");
  expect(downloaded.suggestedFilename()).toMatch(/\.feng$/);
  expect(contents).not.toContain("WAITROSE");
  expect(contents).not.toContain("SIEMENS");
  expect(JSON.parse(contents)).toMatchObject({
    encrypted: true,
    encryption: "AES-256-GCM",
    iterations: 600000,
  });
  await expect(page.getByRole("status")).toContainText("Backup ready.");
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    )
    .toBeLessThanOrEqual(1);
  await expect(page.locator(".backup-status")).toContainText("Last backup:");
  await expect(page.locator(".backup-status time")).toBeVisible();
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "";
  });
  const tables = [
    "accounts",
    "statements",
    "transactions",
    "settings",
    "categories",
    "rules",
    "changeLog",
  ];
  const before = await records(page, tables);
  await panel.getByLabel("Choose Feng backup", { exact: true }).setInputFiles({
    name: downloaded.suggestedFilename(),
    mimeType: "application/vnd.feng.backup+json",
    buffer: Buffer.from(contents),
  });
  const restorePassword = panel
    .getByLabel("Backup password", { exact: true })
    .last();
  await restorePassword.fill("incorrect synthetic password");
  await panel
    .getByRole("button", { name: "Unlock and preview", exact: true })
    .click();
  await expect(panel.getByRole("alert")).toContainText("No data has changed.");
  expect(await records(page, tables)).toEqual(before);
  await expect(page.locator(".restore-warning")).toHaveCount(0);
  await restorePassword.fill("synthetic secret phrase 2026");
  await panel
    .getByRole("button", { name: "Unlock and preview", exact: true })
    .click();
  await expect(page.locator(".restore-warning")).toBeVisible();
  expect(await records(page, tables)).toEqual(before);
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await expectNoHorizontalOverflow(page);
    await page.locator(".restore-warning").screenshot({
      path: testInfo.outputPath(`encrypted-restore-${width}.png`),
    });
  }
  await page
    .getByRole("button", { name: "Cancel restore", exact: true })
    .click();
  await expect(page.locator(".restore-warning")).toHaveCount(0);
  expect(await records(page, tables)).toEqual(before);
});

test("notes and compressed image/PDF attachments work offline with no financial network requests", async ({
  receiptPage: page,
  offlineHost,
}, testInfo) => {
  await settingsWithDemo(page, offlineHost.origin);
  const rows = await records(page, ["transactions"]);
  const first = (rows.transactions as { id: string }[])[0];
  await page.goto(`${offlineHost.origin}/#/transactions/${first.id}`);
  const manager = page.getByRole("region", {
    name: "Transaction notes and attachments",
  });
  await expect(
    manager.getByRole("heading", {
      name: "Notes and attachments",
      exact: true,
    }),
  ).toBeVisible();
  const image = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 3200;
    canvas.height = 1800;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#335588";
    context.fillRect(0, 0, 3200, 1800);
    context.fillStyle = "#ffffff";
    context.font = "60px sans-serif";
    context.fillText(
      "Fictitious receipt used only for automated testing",
      80,
      100,
    );
    return canvas.toDataURL("image/png").split(",")[1];
  });
  // WebKit's emulated offline mode also blocks local blob decoding. A stopped
  // private origin proves actual offline operation without mocking the decoder.
  await offlineHost.stop();
  const requests: string[] = [];
  page.on("request", (request) => {
    if (/^https?:/.test(request.url())) requests.push(request.url());
  });
  await manager
    .getByLabel("Private note", { exact: true })
    .fill("Fictitious travel receipt, privately stored.");
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
  });
  await expect(
    page.getByRole("status").filter({ hasText: "Note saved." }),
  ).toBeVisible();
  await manager
    .getByLabel("Choose transaction attachment", { exact: true })
    .setInputFiles({
      name: "synthetic-receipt.png",
      mimeType: "image/png",
      buffer: Buffer.from(image, "base64"),
    });
  await expect(
    manager.getByText("1 of 5 attachments.", { exact: false }),
  ).toBeVisible();
  await expect
    .poll(() =>
      manager
        .locator("img")
        .evaluate((element) => (element as HTMLImageElement).naturalWidth),
    )
    .toBe(1600);
  const dimensions = await manager.locator("img").evaluate((element) => ({
    width: (element as HTMLImageElement).naturalWidth,
    height: (element as HTMLImageElement).naturalHeight,
  }));
  expect(dimensions).toEqual({ width: 1600, height: 900 });
  await manager
    .getByLabel("Choose transaction attachment", { exact: true })
    .setInputFiles({
      name: "synthetic-receipt.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.7\nsynthetic local receipt"),
    });
  await expect(
    manager.getByText("2 of 5 attachments.", { exact: false }),
  ).toBeVisible();
  expect(requests).toEqual([]);
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await expectNoHorizontalOverflow(page);
    await manager.screenshot({
      path: testInfo.outputPath(`offline-attachments-${width}.png`),
    });
  }
  await manager
    .getByRole("button", { name: "Remove synthetic-receipt.pdf", exact: true })
    .click();
  await expect(
    manager.getByText("1 of 5 attachments.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(
    manager.getByText("2 of 5 attachments.", { exact: false }),
  ).toBeVisible();
  expect(requests).toEqual([]);
});
