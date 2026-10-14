import { selectPeriod, settingsSection } from "./flows";
import { acknowledgeBeta, expect, test as base, type Page } from "./fixtures";
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

async function seed(page: Page, rates = true, origin = "") {
  await page.clock.setFixedTime(new Date("2026-10-08T12:00:00Z"));
  await page.goto(`${origin}/#/`);
  await acknowledgeBeta(page);
  await expect(
    page.getByRole("heading", { name: "Home", exact: true }),
  ).toBeVisible();
  await page.evaluate(
    (withRates) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("feng-finance");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const write = database.transaction(
            ["accounts", "statements", "transactions", "fxRates", "settings"],
            "readwrite",
          );
          const stamp = "2026-10-08T12:00:00Z";
          for (const [id, displayName, currency] of [
            ["report-gbp", "Everyday GBP", "GBP"],
            ["report-eur", "Travel EUR", "EUR"],
          ])
            write.objectStore("accounts").put({
              id,
              displayName,
              currency,
              institution: id === "report-gbp" ? "Barclays" : "Revolut",
              accountType: "current",
              tracking: "statement",
              maskedAccountIdentifier: "Fictitious",
              createdAt: stamp,
              updatedAt: stamp,
            });
          for (const [
            id,
            date,
            amount,
            accountId,
            currency,
            categoryId,
            merchant,
          ] of [
            [
              "report-salary",
              "2026-09-25",
              300000,
              "report-gbp",
              "GBP",
              "salary",
              "FICTITIOUS SALARY",
            ],
            [
              "report-food",
              "2026-09-02",
              -10000,
              "report-gbp",
              "GBP",
              "groceries",
              "FICTITIOUS GROCER",
            ],
            [
              "report-shop",
              "2026-09-03",
              -4000,
              "report-gbp",
              "GBP",
              "shopping",
              "FICTITIOUS SHOP",
            ],
            [
              "report-euro-food",
              "2026-09-03",
              -12000,
              "report-eur",
              "EUR",
              "groceries",
              "FICTITIOUS EURO GROCER",
            ],
          ] as const)
            write.objectStore("transactions").put({
              id,
              date,
              amount,
              accountId,
              currency,
              categoryId,
              merchant,
              description: merchant,
              statementId: `${accountId}:september`,
              type: amount > 0 ? "income" : "expense",
              source: "pdf",
              kind: "normal",
              tags: [],
              sourcePage: 1,
              extractionConfidence: 1,
              occurrence: 0,
              transactionFingerprint: id,
              isTransfer: false,
              isReviewed: true,
              createdAt: stamp,
              updatedAt: stamp,
            });
          for (const [
            accountId,
            openingBalance,
            closingBalance,
            currency,
            transactionCount,
          ] of [
            ["report-gbp", 100000, 386000, "GBP", 3],
            ["report-eur", 200000, 188000, "EUR", 1],
          ] as const)
            write.objectStore("statements").put({
              id: `${accountId}:september`,
              accountId,
              openingBalance,
              closingBalance,
              currency,
              transactionCount,
              institution: accountId === "report-gbp" ? "Barclays" : "Revolut",
              statementPeriodStart: "2026-09-01",
              statementPeriodEnd: "2026-09-30",
              validationStatus: "reconciled",
              sourceFilename: "Fictitious September statement",
              sourceFileHash: accountId,
              extractionMethod: "embedded-text",
              parserVersion: "synthetic",
              warnings: [],
              importedAt: stamp,
            });
          write
            .objectStore("settings")
            .put({ key: "fx:download", value: withRates ? "false" : "true" });
          write
            .objectStore("settings")
            .put({ key: "review:autoClose", value: "false" });
          if (withRates)
            for (const date of ["2026-09-01", "2026-09-30"])
              write.objectStore("fxRates").put({
                id: `ecb:${date}:EUR:GBP`,
                date,
                base: "EUR",
                quote: "GBP",
                rate: "0.8571",
                source: "ecb",
              });
          write.oncomplete = () => {
            database.close();
            resolve();
          };
          write.onerror = () => {
            database.close();
            reject(write.error);
          };
        };
      }),
    rates,
  );
  await page.reload();
  await expect(page.locator(".month-picker input")).toHaveValue("2026-09");
}
async function records(page: Page, table: string) {
  return page.evaluate(
    (name) =>
      new Promise<Record<string, unknown>[]>((resolve, reject) => {
        const request = indexedDB.open("feng-finance");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const read = database
            .transaction(name, "readonly")
            .objectStore(name)
            .getAll();
          read.onsuccess = () => {
            database.close();
            resolve(read.result);
          };
          read.onerror = () => reject(read.error);
        };
      }),
    table,
  );
}

test("reporting totals reconcile native currencies and lead to source payments offline", async ({
  page,
  context,
  offlineHost,
}) => {
  await seed(page, true, offlineHost.origin);
  await expect(page.locator(".month-income strong")).toHaveText("≈ £3,000.00");
  await expect(page.locator(".month-spending strong")).toHaveText("≈ £242.85");
  await expect(page.locator(".month-net strong")).toHaveText("+≈£2,757.15");
  await expect(page.locator(".position-summary")).toContainText("≈ £5,471.35");
  await page.goto(`${offlineHost.origin}/#/accounts`);
  await expect(page.locator(".account-overview-list")).toContainText(
    "€1,880.00",
  );
  await page.goto(`${offlineHost.origin}/#/`);
  const original = await records(page, "transactions");
  expect(original.find((t) => t.id === "report-euro-food")).toMatchObject({
    amount: -12000,
    currency: "EUR",
  });
  await page.locator(".month-spending").click();
  await expect(page.locator(".transaction-list .transaction-row")).toHaveCount(
    3,
  );
  await expect(page.locator(".transaction-list")).toContainText("−€120.00");
  await expect(page.locator(".transaction-list")).not.toContainText(
    "Fictitious salary",
  );
  await page.goto(`${offlineHost.origin}/#/analysis`);
  await selectPeriod(page, "1");
  await expect(page.locator(".metric-strip")).toContainText("≈ £242.85");
  await expect(page.locator(".metric-strip")).toContainText("≈ £3,000.00");
  await page.goto(`${offlineHost.origin}/#/`);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true);
  // Prove a real service-worker reload with the origin unavailable. WebKit's
  // emulated offline navigation bypasses the worker, so set that flag afterward.
  await offlineHost.stop();
  await page.reload();
  await context.setOffline(true);
  await expect(page.locator(".month-spending strong")).toHaveText("≈ £242.85");
  expect(await records(page, "transactions")).toEqual(original);
});

test("closing a reviewed month and changing its date range require explicit reopen and can be undone", async ({
  page,
}) => {
  await seed(page);
  await page.goto("/#/review?month=2026-09");
  for (let step = 0; step < 3; step++)
    await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Close September", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Close September", exact: true })
    .click();
  await expect
    .poll(async () => (await records(page, "monthCloses")).length)
    .toBe(1);
  await settingsSection(page, "period");
  const period = page.locator("section.card").filter({
    has: page.getByRole("heading", { name: "Your month", exact: true }),
  });
  page.once("dialog", (dialog) => dialog.dismiss());
  await period
    .getByRole("combobox", { name: "Starts on", exact: true })
    .selectOption("fixed");
  await expect(
    period.getByRole("combobox", { name: "Starts on", exact: true }),
  ).toHaveValue("calendar");
  expect(await records(page, "monthCloses")).toHaveLength(1);
  page.once("dialog", (dialog) => dialog.accept());
  await period
    .getByRole("combobox", { name: "Starts on", exact: true })
    .selectOption("fixed");
  await expect
    .poll(async () => (await records(page, "monthCloses")).length)
    .toBe(0);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(
    period.getByRole("combobox", { name: "Starts on", exact: true }),
  ).toHaveValue("calendar");
  expect(await records(page, "monthCloses")).toHaveLength(1);
});

test.describe("public-rate HTTP privacy", () => {
  // WebKit does not expose service-worker-owned requests to page.route. Disable
  // workers only here so this test inspects the real page HTTP request and CSP.
  // Offline behavior retains real service workers in the other workflows.
  test.use({ serviceWorkers: "block" });

  test("foreign accounts request only a public ECB table and keep financial data local", async ({
    page,
  }) => {
    const external: {
      url: string;
      method: string;
      body: string | null;
      cookie?: string;
    }[] = [];
    await page.route("https://data-api.ecb.europa.eu/**", async (route) => {
      const request = route.request();
      external.push({
        url: request.url(),
        method: request.method(),
        body: request.postData(),
        cookie: request.headers().cookie,
      });
      await route.fulfill({
        status: 200,
        contentType: "text/csv",
        body: "TIME_PERIOD,CURRENCY,CURRENCY_DENOM,OBS_VALUE\n2026-09-01,GBP,EUR,0.8571\n2026-09-30,GBP,EUR,0.8571\n2026-10-08,GBP,EUR,0.8571",
      });
    });
    await seed(page, false);
    await expect(page.locator(".month-spending strong")).toHaveText(
      "≈ £242.85",
    );
    expect(external).toHaveLength(1);
    expect(external[0]).toEqual({
      url: "https://data-api.ecb.europa.eu/service/data/EXR/D..EUR.SP00.A?lastNObservations=1020&format=csvdata",
      method: "GET",
      body: null,
      cookie: undefined,
    });
    for (const secret of [
      "report-eur",
      "FICTITIOUS",
      "188000",
      "12000",
      "Barclays",
      "Revolut",
    ])
      expect(external[0].url).not.toContain(secret);
  });
});

test("first run and the main pages fit narrow screens and large text without overlapping navigation", async ({
  page,
}, testInfo) => {
  // Twenty page/viewport combinations, including settled 200% text charts.
  test.setTimeout(180000);
  await page.goto("/#/");
  await expect(page.locator("main section.card")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Try fictitious demo data", exact: true }),
  ).toBeVisible();
  await seed(page);
  for (const width of [320, 375, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    for (const route of [
      "/",
      "/transactions?allDates=1",
      "/analysis",
      "/planning",
      "/settings",
    ]) {
      await page.goto(`/#${route}`);
      await expect(page.locator("main h1")).toBeVisible();
      await page.evaluate(() => {
        document.documentElement.style.fontSize = "200%";
        // Match the wider Linux Safari system font as well as mobile defaults.
        // The native tax-year menu previously leaked beyond its flex label.
        document.documentElement.style.fontFamily = '"DejaVu Sans", sans-serif';
      });
      // Font changes update Recharts through ResizeObserver on a later frame.
      // Check the settled layout, retaining the exact overflow in failure output.
      await expect
        .poll(
          () =>
            page.evaluate(() => {
              const viewportWidth = window.innerWidth;
              const documentWidth = document.documentElement.scrollWidth;
              if (documentWidth <= viewportWidth + 1) return { fits: true };
              return {
                fits: false,
                viewportWidth,
                documentWidth,
                leakingContainers: Array.from(
                  document.querySelectorAll("body *"),
                )
                  .filter(
                    (element) =>
                      element.clientWidth > 0 &&
                      element.scrollWidth > element.clientWidth + 1 &&
                      getComputedStyle(element).overflowX === "visible",
                  )
                  .map((element) => ({
                    tag: element.tagName,
                    className: element.getAttribute("class"),
                    clientWidth: element.clientWidth,
                    scrollWidth: element.scrollWidth,
                    text: element.textContent?.slice(0, 120),
                  }))
                  .slice(0, 20),
                overflowing: Array.from(document.querySelectorAll("body *"))
                  .filter((element) => {
                    const rect = element.getBoundingClientRect();
                    return rect.right > viewportWidth + 1 && rect.width > 0;
                  })
                  .map((element) => ({
                    tag: element.tagName,
                    className: element.getAttribute("class"),
                    text: element.textContent?.slice(0, 120),
                    right: element.getBoundingClientRect().right,
                    width: element.getBoundingClientRect().width,
                    clientWidth: element.clientWidth,
                    scrollWidth: element.scrollWidth,
                  }))
                  .slice(0, 20),
              };
            }),
          {
            timeout: 3000,
            intervals: [100, 250, 500],
            message: `${width}px ${route}: layout must fit after text resizing`,
          },
        )
        .toEqual({ fits: true });
      if (route === "/analysis") {
        await page.goto("/#/analysis?view=reports");
        await page
          .getByRole("button", { name: "Edit report", exact: true })
          .click();
        const taxYear = page.getByRole("combobox", {
          name: "UK tax year",
          exact: true,
        });
        expect(
          await taxYear.evaluate((element) => {
            const label = element.closest("label")!;
            return label.scrollWidth <= label.clientWidth + 1;
          }),
          `${width}px ${route}: the tax-year choice must fit inside its field`,
        ).toBe(true);
      }
      if (route === "/analysis") {
        await page
          .getByRole("button", { name: "Close Edit report", exact: true })
          .click();
        await page.goto("/#/analysis");
      }
      const navigation = page.locator(".mobile-navigation");
      await expect(navigation).toBeVisible();
      const navigationHeightRatio = await navigation.evaluate(
        (element) =>
          element.getBoundingClientRect().height / window.innerHeight,
      );
      expect(
        navigationHeightRatio,
        `${width}px ${route}: navigation must leave the content usable at 200% text`,
      ).toBeLessThanOrEqual(0.2);
      const order = await navigation.locator("a").allTextContents();
      expect(order.map((s) => s.trim())).toEqual([
        "Import",
        "Activity",
        "Home",
        "Analyse",
        "Planning",
      ]);
      await page.screenshot({
        path: testInfo.outputPath(
          `layout-${width}-${route.split("?")[0].replaceAll("/", "") || "home"}.png`,
        ),
        fullPage: false,
      });
      await page.evaluate(() => {
        document.documentElement.style.fontSize = "";
        document.documentElement.style.fontFamily = "";
      });
    }
  }
});

test("manual cash wallets include movements older than the chart history", async ({
  page,
}) => {
  await seed(page);
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("feng-finance");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const write = database.transaction(
            ["accounts", "valuations", "transactions"],
            "readwrite",
          );
          const stamp = "2026-10-08T12:00:00Z";
          write.objectStore("accounts").put({
            id: "old-wallet",
            institution: "Other",
            displayName: "Old cash wallet",
            accountType: "current",
            currency: "GBP",
            tracking: "manual",
            maskedAccountIdentifier: "Fictitious",
            createdAt: stamp,
            updatedAt: stamp,
          });
          write.objectStore("valuations").put({
            id: "wallet-opening",
            accountId: "old-wallet",
            date: "2020-01-01",
            valueMinor: 10000,
            createdAt: stamp,
          });
          for (const [id, date, amount] of [
            ["old-wallet-income", "2021-01-01", 2000],
            ["old-wallet-purchase", "2026-09-01", -1000],
          ] as const)
            write.objectStore("transactions").put({
              id,
              accountId: "old-wallet",
              statementId: "manual",
              date,
              description: "FICTITIOUS CASH MOVEMENT",
              merchant: "FICTITIOUS CASH",
              amount,
              currency: "GBP",
              type: amount > 0 ? "income" : "expense",
              kind: amount > 0 ? "income" : "expense",
              categoryId: amount > 0 ? "other-income" : "groceries",
              tags: [],
              isTransfer: false,
              isReviewed: true,
              source: "manual",
              sourcePage: 0,
              extractionConfidence: 1,
              transactionFingerprint: id,
              createdAt: stamp,
              updatedAt: stamp,
            });
          write.oncomplete = () => {
            database.close();
            resolve();
          };
          write.onerror = () => reject(write.error);
        };
      }),
  );
  await page.reload();
  await page.goto("/#/accounts");
  const wallet = page
    .locator(".account-overview-row")
    .filter({ hasText: "Old cash wallet" });
  await expect(wallet.locator("strong").last()).toHaveText("£110.00");
  await page.goto("/#/");
  await expect(
    page
      .locator(".position-metrics > a")
      .filter({ hasText: /^Cash/ })
      .locator("strong"),
  ).toHaveText("≈ £5,581.35");
});
