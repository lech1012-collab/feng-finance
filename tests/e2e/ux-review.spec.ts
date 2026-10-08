import { test, expect, type Page } from "@playwright/test";

/** Fictitious source records reproduce a partially imported household without
 * requiring a real statement or relying on categories/amounts from demo mode. */
async function seedPartialAccounts(page: Page) {
  await page.clock.setFixedTime(new Date("2026-10-07T12:00:00Z"));
  await page.goto("/#/");
  await expect(
    page.getByRole("heading", { name: "Home", exact: true }),
  ).toBeVisible();
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("feng-finance");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const write = database.transaction(
            ["accounts", "statements", "transactions"],
            "readwrite",
          );
          const stamp = "2026-10-01T12:00:00Z";
          write.objectStore("accounts").put({
            id: "ux-cash",
            institution: "Barclays",
            displayName: "Everyday cash",
            accountType: "current",
            currency: "GBP",
            maskedAccountIdentifier: "•••• 4321",
            createdAt: stamp,
            updatedAt: stamp,
          });
          write.objectStore("accounts").put({
            id: "ux-card",
            institution: "American Express",
            displayName: "Rewards card",
            accountType: "credit",
            currency: "GBP",
            maskedAccountIdentifier: "•••• 1008",
            createdAt: stamp,
            updatedAt: stamp,
          });
          write.objectStore("statements").put({
            id: "ux-card-september",
            institution: "American Express",
            accountId: "ux-card",
            statementPeriodStart: "2026-08-06",
            statementPeriodEnd: "2026-09-05",
            periodSource: "printed",
            openingBalance: 0,
            closingBalance: -135790,
            currency: "GBP",
            sourceFilename: "synthetic-ux-review.pdf",
            sourceFileHash: "synthetic-ux-review",
            importedAt: stamp,
            parserVersion: "test",
            extractionMethod: "embedded-text",
            validationStatus: "reconciled",
            validationDifference: 0,
            transactionCount: 2,
            warnings: [],
          });
          for (const [id, date, amount, merchant, categoryId] of [
            ["ux-aug", "2026-08-12", -100000, "WAITROSE", "groceries"],
            [
              "ux-sep",
              "2026-09-03",
              -35790,
              "PRIME VIDEO RENT / BUY AMZN.UK/BILL",
              "entertainment",
            ],
          ] as const)
            write.objectStore("transactions").put({
              id,
              accountId: "ux-card",
              statementId: "ux-card-september",
              date,
              description: merchant,
              merchant,
              amount,
              currency: "GBP",
              type: "expense",
              categoryId,
              tags: [],
              sourcePage: 1,
              extractionConfidence: 1,
              transactionFingerprint: id,
              occurrence: 0,
              isTransfer: false,
              isReviewed: true,
              createdAt: stamp,
              updatedAt: stamp,
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
  );
  await page.reload();
  await page.getByLabel("Selected month").fill("2026-09");
  await expect(page.locator(".position-coverage")).toContainText(
    "1 of 2 accounts",
  );
}

test("UX trust: partial card imports show debt, unknown cash/income and no invented net", async ({
  page,
}) => {
  await seedPartialAccounts(page);
  const position = page.locator(".position-metrics");
  await expect(
    position.locator("div").filter({ hasText: /^Cash/ }),
  ).toContainText("Unknown");
  await expect(
    position.locator("div").filter({ hasText: /^Card debt/ }),
  ).toContainText("£1,357.90");
  await expect(
    position.locator("div").filter({ hasText: /^Card debt/ }),
  ).not.toContainText("-£");
  await expect(
    position.locator("div").filter({ hasText: /^Net position/ }),
  ).toContainText("Unavailable");
  const monthly = page.locator(".month-summary");
  await expect(monthly.locator(".month-income")).toContainText(
    "No income source imported",
  );
  await expect(monthly.locator(".month-net")).toContainText("n/a");
  await expect(monthly.locator(".hero-comparison")).toContainText(
    "Not comparable yet",
  );
  await expect(monthly.locator(".hero-comparison")).not.toContainText(
    "vs previous month",
  );
  await expect(monthly.locator(".month-status")).toContainText(
    "From imported accounts only",
  );
  await expect(
    page
      .locator(".balance-account-missing")
      .getByRole("button", { name: "Import", exact: true }),
  ).toBeVisible();
});

test("UX trust: missing months are accessible gaps instead of zero-valued cash flow", async ({
  page,
}) => {
  await seedPartialAccounts(page);
  const homeFlow = page.locator(".flow-card");
  const missing = homeFlow.getByRole("button", {
    name: "Apr: No statements",
    exact: true,
  });
  await missing.click();
  await expect(homeFlow.getByRole("status")).toHaveText("Apr: No statements");
  await expect(homeFlow.locator('svg pattern[id^="missing-"]')).toHaveCount(1);
  await page.goto("/#/analysis");
  await page
    .getByRole("combobox", { name: "Period", exact: true })
    .selectOption("6");
  const chart = page.locator("section.card").filter({
    has: page.getByRole("heading", {
      name: "Income, expenses & net cash flow",
      exact: true,
    }),
  });
  await chart.getByText("View chart values", { exact: true }).click();
  const missingRow = chart.locator("tbody tr").filter({ hasText: /^Apr/ });
  await expect(missingRow).toContainText("No statements");
  await expect(missingRow).not.toContainText("£0.00");
  const partialRow = chart.locator("tbody tr").filter({ hasText: /^Sep/ });
  await expect(partialRow).toContainText("Partial");
  await expect(
    partialRow.getByRole("cell", { name: "Not imported", exact: true }),
  ).toHaveCount(2);
  await expect(partialRow).toContainText("-£357.90");
});

test("UX scope: the analysis period drives the date range and every monthly chart row", async ({
  page,
}) => {
  await seedPartialAccounts(page);
  await page.goto("/#/analysis");
  const chart = page.locator("section.card").filter({
    has: page.getByRole("heading", {
      name: "Income, expenses & net cash flow",
      exact: true,
    }),
  });
  await chart.getByText("View chart values", { exact: true }).click();
  const scopes = [
    ["1", "1 month", "1 to 30 Sep 2026", 1],
    ["3", "3 months", "1 Jul to 30 Sep 2026", 3],
    ["6", "6 months", "1 Apr to 30 Sep 2026", 6],
    ["12", "12 months", "1 Oct 2025 to 30 Sep 2026", 12],
  ] as const;
  for (const [value, label, range, count] of scopes) {
    await page
      .getByRole("combobox", { name: "Period", exact: true })
      .selectOption(value);
    await expect(chart.locator(".section-heading")).toContainText(label);
    await expect(
      page.locator("main > p").filter({ hasText: range }),
    ).toBeVisible();
    await expect(chart.locator("tbody tr")).toHaveCount(count);
  }
});

test("UX mobile: Home and transaction controls stay usable at narrow widths and larger text", async ({
  page,
}) => {
  await seedPartialAccounts(page);
  for (const width of [320, 375, 390, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    for (const scale of ["100%", "200%"]) {
      await page.goto("/#/");
      await page.evaluate((size) => {
        document.documentElement.style.fontSize = size;
      }, scale);
      await expect(
        page.getByRole("heading", { name: "Home", exact: true }),
      ).toBeVisible();
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        )
        .toBe(true);
      for (const control of [
        page.getByRole("button", { name: "Previous month", exact: true }),
        page.getByRole("button", { name: "Next month", exact: true }),
        page.locator(".import-main"),
      ]) {
        const box = await control.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.width).toBeGreaterThanOrEqual(44);
        expect(box!.height).toBeGreaterThanOrEqual(44);
      }
      await page.goto("/#/transactions");
      await page.evaluate((size) => {
        document.documentElement.style.fontSize = size;
      }, scale);
      await expect(
        page.getByRole("heading", { name: "Transactions", exact: true }),
      ).toBeVisible();
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        )
        .toBe(true);
    }
  }
});
