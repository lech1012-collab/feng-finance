import { settingsSection } from "./flows";
import { test as base, expect, type Page } from "@playwright/test";
import { acknowledgeBeta } from "./fixtures";
import { startStaticHost, type LocalHost } from "./static-host";
import { accounts, transaction } from "../../src/tests/helpers";
import { APP_VERSION, type Statement } from "../../src/domain/models";
import { CURRENT_RELEASE } from "../../src/beta/release";

// These tests deliberately retain the genuine first-launch experience.
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

async function setting(page: Page, key: string) {
  return page.evaluate(
    (name) =>
      new Promise<string | undefined>((resolve, reject) => {
        const request = indexedDB.open("feng-finance");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const read = database
            .transaction("settings")
            .objectStore("settings")
            .get(name);
          read.onsuccess = () => {
            database.close();
            resolve((read.result as { value?: string } | undefined)?.value);
          };
          read.onerror = () => {
            database.close();
            reject(read.error);
          };
        };
      }),
    key,
  );
}

async function safariTab(page: Page, installed = false) {
  await page.addInitScript((standalone) => {
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      value:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/604.1",
    });
    Object.defineProperty(navigator, "platform", {
      configurable: true,
      value: "iPhone",
    });
    Object.defineProperty(navigator, "maxTouchPoints", {
      configurable: true,
      value: 5,
    });
    Object.defineProperty(navigator, "standalone", {
      configurable: true,
      value: standalone,
    });
  }, installed);
}

async function addOldRealImport(page: Page) {
  const row = transaction({ id: "beta-real-payment", categoryId: "groceries" });
  const statement: Statement = {
    id: "s1",
    accountId: "a1",
    institution: "Barclays",
    statementPeriodStart: "2026-09-01",
    statementPeriodEnd: "2026-09-30",
    openingBalance: 10000,
    closingBalance: 9000,
    currency: "GBP",
    sourceFilename: "fictitious-beta.pdf",
    sourceFileHash: "fictitious-beta-hash",
    importedAt: "2026-09-20T12:00:00.000Z",
    parserVersion: "synthetic-beta",
    extractionMethod: "embedded-text",
    validationStatus: "reconciled",
    validationDifference: 0,
    transactionCount: 1,
    warnings: [],
    periodSource: "printed",
  };
  await page.evaluate(
    ({ account, statement, row }) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("feng-finance");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const write = database.transaction(
            ["accounts", "statements", "transactions"],
            "readwrite",
          );
          write.objectStore("accounts").put(account);
          write.objectStore("statements").put(statement);
          write.objectStore("transactions").put(row);
          write.oncomplete = () => {
            database.close();
            resolve();
          };
          write.onabort = () => {
            database.close();
            reject(write.error);
          };
        };
      }),
    { account: accounts[0], statement, row },
  );
}

test("first launch explains privacy before requesting storage and demo survives reload", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const calls: string[] = [];
    let protectedStorage = false;
    const browserStorage = navigator.storage;
    Object.assign(window, { betaStorageCalls: calls });
    // WebKit can return a fresh StorageManager wrapper on each access. Mock
    // the navigator property so the application's own reads use this manager.
    Object.defineProperty(navigator, "storage", {
      configurable: true,
      value: {
        estimate: () => browserStorage.estimate(),
        persisted: async () => {
          calls.push("persisted");
          return protectedStorage;
        },
        persist: async () => {
          calls.push("persist");
          protectedStorage = true;
          return true;
        },
      },
    });
  });
  await page.goto("/#/");
  const notice = page.getByRole("dialog", { name: "Welcome to Feng" });
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("Check figures against your statements");
  await expect(notice).toContainText(
    "Nothing is uploaded, and the developer can't see it.",
  );
  await expect(notice).toContainText("Not financial advice.");
  await expect(notice).toContainText("Start with demo data to explore safely.");
  expect(
    await page.evaluate(() =>
      (
        window as unknown as { betaStorageCalls: string[] }
      ).betaStorageCalls.filter((call) => call === "persist"),
    ),
  ).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(notice).toBeVisible();
  await notice.getByRole("button", { name: "Explore with demo data" }).click();
  await expect(
    page.getByRole("heading", { name: "Home", exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".ui-demo-chip").filter({ visible: true }),
  ).toBeVisible();
  await expect.poll(() => setting(page, "storagePersisted")).toBe("true");
  expect(
    await page.evaluate(() =>
      (
        window as unknown as { betaStorageCalls: string[] }
      ).betaStorageCalls.filter((call) => call === "persist"),
    ),
  ).toEqual(["persist"]);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Home", exact: true }),
  ).toBeVisible();
  await expect(notice).toHaveCount(0);
  await expect(
    page.locator(".ui-demo-chip").filter({ visible: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "What's new in Feng" }),
  ).toHaveCount(0);
});

test("import acknowledgement opens Files before asynchronous storage permission completes", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const browserStorage = navigator.storage;
    Object.defineProperty(navigator, "storage", {
      configurable: true,
      value: {
        estimate: () => browserStorage.estimate(),
        persisted: async () => false,
        persist: () =>
          new Promise<boolean>((resolve) =>
            Object.assign(window, { finishBetaStorage: () => resolve(true) }),
          ),
      },
    });
  });
  await page.goto("/#/");
  const notice = page.getByRole("dialog", { name: "Welcome to Feng" });
  const chooser = page.waitForEvent("filechooser");
  await notice.getByRole("button", { name: "Import my statements" }).click();
  await (await chooser).setFiles([]);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          typeof (window as unknown as { finishBetaStorage?: () => void })
            .finishBetaStorage,
      ),
    )
    .toBe("function");
  await expect(
    page.getByRole("heading", { name: "Home", exact: true }),
  ).toHaveCount(0);
  await page.evaluate(() =>
    (
      window as unknown as { finishBetaStorage: () => void }
    ).finishBetaStorage(),
  );
  await expect(
    page.getByRole("heading", { name: "Home", exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".ui-demo-chip").filter({ visible: true }),
  ).toHaveCount(0);
  await expect.poll(() => setting(page, "betaNoticeAcceptedVersion")).toBe("1");
});

test("Safari install guidance waits seven days and stops after three visible appearances", async ({
  page,
}) => {
  await safariTab(page);
  await page.clock.setFixedTime(new Date("2026-10-11T12:00:00Z"));
  await page.goto("/#/");
  const firstNotice = page.getByRole("dialog", { name: "Welcome to Feng" });
  await expect(firstNotice).toContainText("Tap Share in Safari.");
  await expect
    .poll(() => setting(page, "installBannerShowCount"))
    .toBeUndefined();
  await acknowledgeBeta(page);
  const banner = page.getByRole("region", {
    name: "Install Feng",
    exact: true,
  });
  for (const [index, date] of [
    "2026-10-11",
    "2026-10-19",
    "2026-10-27",
  ].entries()) {
    if (index) {
      await page.clock.setFixedTime(new Date(`${date}T12:00:00Z`));
      await page.reload();
    }
    await expect(banner).toBeVisible();
    await expect
      .poll(() => setting(page, "installBannerShowCount"))
      .toBe(String(index + 1));
    await banner.getByRole("button", { name: "Not now", exact: true }).click();
    await expect(banner).toHaveCount(0);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Home", exact: true }),
    ).toBeVisible();
    await expect(banner).toHaveCount(0);
  }
  await page.clock.setFixedTime(new Date("2026-11-05T12:00:00Z"));
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Home", exact: true }),
  ).toBeVisible();
  await expect(banner).toHaveCount(0);
  expect(await setting(page, "installBannerShowCount")).toBe("3");
});

test("installed iPhone mode keeps installation metadata and suppresses the Safari banner", async ({
  page,
}) => {
  await safariTab(page, true);
  await page.goto("/#/");
  await acknowledgeBeta(page);
  await expect(
    page.getByRole("region", { name: "Install Feng", exact: true }),
  ).toHaveCount(0);
  await settingsSection(page, "about");
  await page.getByText("Install help", { exact: true }).click();
  await expect(
    page.getByText("Feng is already installed. Open it from your Home Screen."),
  ).toBeVisible();
  const manifest = await page
    .locator("link[rel=manifest]")
    .getAttribute("href");
  expect(manifest).toBeTruthy();
  const manifestData = await (await page.request.get(manifest!)).json();
  expect(manifestData).toMatchObject({
    name: "Feng",
    short_name: "Feng",
    display: "standalone",
    scope: ".",
    start_url: ".",
  });
  const appleIcon = await page
    .locator("link[rel=apple-touch-icon]")
    .getAttribute("href");
  expect(appleIcon).toMatch(/\/icons\/icon-180\.png$/);
  expect((await page.request.get(appleIcon!)).ok()).toBe(true);
  expect(
    await page.evaluate(async (href) => {
      const icon = new Image();
      icon.src = href;
      await icon.decode();
      return { width: icon.naturalWidth, height: icon.naturalHeight };
    }, appleIcon!),
  ).toEqual({ width: 180, height: 180 });
  await expect(
    page.locator('meta[name="apple-mobile-web-app-capable"]'),
  ).toHaveAttribute("content", "yes");
});

test("existing Safari imports warn about separate storage and retain their overdue backup date", async ({
  page,
}) => {
  await safariTab(page);
  await page.clock.setFixedTime(new Date("2026-10-11T12:00:00Z"));
  await page.goto("/#/");
  await acknowledgeBeta(page);
  await page
    .getByRole("region", { name: "Install Feng", exact: true })
    .getByRole("button", { name: "Don't show again" })
    .click();
  await addOldRealImport(page);
  // Native fixture writes do not emit Dexie's live-query mutation events.
  // Reopen the app as an existing user to check the retained import date.
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Home", exact: true }),
  ).toBeVisible();
  const backupNotice = page.getByRole("region", {
    name: "Save a backup",
    exact: true,
  });
  await expect(backupNotice).toContainText("Data is separate here");
  const previouslySeen = await setting(page, "separateStorageWarningSeen");
  await backupNotice
    .getByRole("button", {
      name: "About Separate browser and installed-app data",
    })
    .click();
  await expect(
    page.getByRole("dialog", {
      name: "Separate browser and installed-app data",
    }),
  ).toContainText(
    "Data in this Safari tab is separate from the installed app.",
  );
  await page
    .getByRole("button", {
      name: "Close Separate browser and installed-app data",
    })
    .click();
  expect(await setting(page, "separateStorageWarningSeen")).toBe(
    previouslySeen,
  );
  await backupNotice.getByRole("button", { name: "I understand" }).click();
  await expect(backupNotice).toContainText("Backup due");
  await backupNotice
    .getByRole("button", { name: "About Keeping a backup" })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Keeping a backup" }),
  ).toContainText("You imported your first statements a week ago.");
  await page.getByRole("button", { name: "Close Keeping a backup" }).click();
  const download = page.waitForEvent("download");
  await backupNotice.getByRole("button", { name: "Save backup" }).click();
  const backupSheet = page.getByRole("dialog", {
    name: "Save backup",
    exact: true,
  });
  await backupSheet
    .getByRole("switch", { name: /Protect with a password/ })
    .uncheck();
  await backupSheet
    .getByRole("button", { name: "Save backup", exact: true })
    .click();
  expect((await download).suggestedFilename()).toMatch(
    /^Feng \d{1,2}-[A-Za-z]{3}-\d{4}\.json$/,
  );
  await expect(backupNotice).toHaveCount(0);
  await page.goto("/#/");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Home", exact: true }),
  ).toBeVisible();
  await expect(backupNotice).toHaveCount(0);
});

test("first-launch notice fits narrow iPhones and large text without hiding either choice", async ({
  page,
}) => {
  await safariTab(page);
  await page.goto("/#/");
  const notice = page.getByRole("dialog", { name: "Welcome to Feng" });
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });
    await expect(notice).toBeVisible();
    await expect
      .poll(() =>
        notice.evaluate(
          (element) => element.scrollWidth <= element.clientWidth + 1,
        ),
      )
      .toBe(true);
    for (const name of ["Explore with demo data", "Import my statements"]) {
      const choice = notice.getByRole("button", { name, exact: true });
      await choice.scrollIntoViewIfNeeded();
      await expect(choice).toBeInViewport();
      const box = await choice.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }
  }
});

test("Settings feedback opens the configured email and includes only technical details", async ({
  page,
}) => {
  await page.goto("/#/");
  await acknowledgeBeta(page);
  await addOldRealImport(page);
  await settingsSection(page, "about");
  await page
    .getByRole("button", { name: "Send feedback", exact: true })
    .click();
  const feedback = page.getByRole("dialog", {
    name: "Send feedback",
    exact: true,
  });
  await expect(feedback).toContainText(
    "Please don't send real statements or screenshots showing real figures.",
  );
  await expect(feedback.getByRole("link", { name: /Open/ })).toHaveAttribute(
    "href",
    /^mailto:lech1012@googlemail\.com\?/,
  );
  const destination = await feedback
    .getByRole("link", { name: "Open email", exact: true })
    .getAttribute("href");
  const context =
    new URLSearchParams(destination!.split("?")[1]).get("body") ?? "";
  expect(context).toContain("Feng");
  expect(context).not.toMatch(
    /WAITROSE|fictitious-beta|4321|2026-09-20|\b10\.00\b/,
  );

  await feedback.getByRole("button", { name: "Close feedback" }).click();
  await expect(
    page.getByRole("button", { name: "Send feedback", exact: true }),
  ).toBeFocused();
});

test("a version change waits for Home and shows What's new once with current release points", async ({
  page,
}) => {
  await page.goto("/#/");
  await acknowledgeBeta(page);
  await addOldRealImport(page);
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("feng-finance");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const write = database.transaction("settings", "readwrite");
          write
            .objectStore("settings")
            .put({ key: "lastSeenVersion", value: "2.0.1" });
          write.oncomplete = () => {
            database.close();
            resolve();
          };
          write.onabort = () => {
            database.close();
            reject(write.error);
          };
        };
      }),
  );
  await page.goto("/#/settings");
  // A real update reloads the document. A hash-only navigation cannot notify
  // Dexie's live query about the old-version preference seeded natively above.
  await page.reload();
  const release = page.getByRole("dialog", {
    name: "What's new in Feng",
    exact: true,
  });
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();
  await expect(release).toHaveCount(0);
  await page.goto("/#/");
  await expect(release).toBeVisible();
  await expect(release).toContainText(`Version ${APP_VERSION}`);
  await expect(
    release.getByRole("list").first().getByRole("listitem"),
  ).toHaveCount(CURRENT_RELEASE.points.length);
  await expect(
    release.getByRole("heading", { name: "Please test", exact: true }),
  ).toBeVisible();
  await release.getByRole("button", { name: "Done", exact: true }).click();
  await expect(release).toHaveCount(0);
  await expect.poll(() => setting(page, "lastSeenVersion")).toBe(APP_VERSION);
  await page.goto("/#/settings");
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();
  await page.goto("/#/");
  await expect(
    page.getByRole("heading", { name: "Home", exact: true }),
  ).toBeVisible();
  await expect(release).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Home", exact: true }),
  ).toBeVisible();
  await expect(release).toHaveCount(0);
});

test("waiting updates appear only on Home and preserve data after an explicit Reload", async ({
  page,
  offlineHost,
}) => {
  await page.goto(`${offlineHost.origin}/#/`);
  await acknowledgeBeta(page);
  await addOldRealImport(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true);
  await page.goto(`${offlineHost.origin}/#/settings`);
  offlineHost.advanceWorker();
  await page.evaluate(async () => {
    const worker = await navigator.serviceWorker.getRegistration();
    if (!worker) throw new Error("Synthetic host has no worker.");
    await worker.update();
  });
  await expect
    .poll(
      () =>
        page.evaluate(
          async () =>
            !!(await navigator.serviceWorker.getRegistration())?.waiting,
        ),
      { timeout: 30000 },
    )
    .toBe(true);
  await expect(
    page.getByRole("button", { name: "Reload", exact: true }),
  ).toHaveCount(0);
  await page.goto(`${offlineHost.origin}/#/`);
  const reload = page.getByRole("button", { name: "Reload", exact: true });
  await expect(reload).toBeVisible();
  await expect(
    page.getByText("A new version of Feng is ready", { exact: true }),
  ).toBeVisible();
  const load = page.waitForEvent("load");
  await reload.click();
  await load;
  await expect(
    page.getByRole("heading", { name: "Home", exact: true }),
  ).toBeVisible();
  await expect(reload).toHaveCount(0);
  await page.goto(`${offlineHost.origin}/#/transactions?allDates=1`);
  await expect(page.getByRole("link", { name: /WAITROSE/i })).toHaveCount(1);
});
