import { expect, test, type Page } from "./fixtures";

async function seed(page: Page) {
  await page.clock.setFixedTime(new Date("2026-10-08T12:00:00Z"));
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
            ["accounts", "statements", "transactions", "tags"],
            "readwrite",
          );
          const stamp = "2026-10-08T12:00:00Z";
          write.objectStore("accounts").put({
            id: "query-account",
            institution: "Barclays",
            displayName: "Fictitious everyday account",
            accountType: "current",
            currency: "GBP",
            maskedAccountIdentifier: "Fictitious",
            createdAt: stamp,
            updatedAt: stamp,
          });
          write.objectStore("statements").put({
            id: "query-statement",
            institution: "Barclays",
            accountId: "query-account",
            statementPeriodStart: "2026-09-01",
            statementPeriodEnd: "2026-09-30",
            openingBalance: 0,
            closingBalance: 97152,
            currency: "GBP",
            sourceFilename: "synthetic.pdf",
            sourceFileHash: "synthetic-query",
            importedAt: stamp,
            parserVersion: "synthetic",
            extractionMethod: "embedded-text",
            validationStatus: "reconciled",
            validationDifference: 0,
            transactionCount: 3,
            warnings: [],
          });
          write.objectStore("tags").put({
            id: "query-trip",
            name: "Lisbon trip",
            colour: "#A99BD6",
            archived: false,
          });
          for (const [id, amount, merchant, categoryId, tags] of [
            ["query-small", -349, "AMZN DIGITAL", undefined, []],
            [
              "query-large",
              -2499,
              "AMZN MARKETPLACE",
              "shopping",
              ["query-trip"],
            ],
            ["query-salary", 100000, "FICTIONAL SALARY", "salary", []],
          ] as const)
            write.objectStore("transactions").put({
              id,
              accountId: "query-account",
              statementId: "query-statement",
              date: "2026-09-26",
              amount,
              merchant,
              description: merchant,
              currency: "GBP",
              type: amount > 0 ? "income" : "expense",
              categoryId,
              tags,
              sourcePage: 1,
              source: "pdf",
              extractionConfidence: 1,
              transactionFingerprint: id,
              occurrence: 0,
              isTransfer: false,
              isReviewed: false,
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
}

async function transactionRecord(page: Page, id: string) {
  return page.evaluate(
    (id) =>
      new Promise<Record<string, unknown> | undefined>((resolve, reject) => {
        const request = indexedDB.open("feng-finance");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const read = database
            .transaction("transactions", "readonly")
            .objectStore("transactions")
            .get(id);
          read.onsuccess = () => {
            database.close();
            resolve(read.result);
          };
          read.onerror = () => {
            database.close();
            reject(read.error);
          };
        };
      }),
    id,
  );
}

test("explicit AMZN amount rule previews, updates one purchase and Undo restores it", async ({
  page,
}) => {
  await seed(page);
  await page.goto("/#/settings");
  await page.locator("#rules > summary").click();
  const manager = page.locator("#categorization-rules");
  await manager
    .getByRole("button", { name: "Create rule", exact: true })
    .click();
  const editor = page.getByRole("dialog", { name: "Create rule", exact: true });
  await editor.getByLabel("Rule name", { exact: true }).fill("Prime Video");
  await editor.getByLabel("Condition 1 value", { exact: true }).fill("AMZN");
  await editor
    .getByRole("button", { name: "Add condition", exact: true })
    .click();
  await editor
    .getByRole("combobox", { name: "Condition 2 field", exact: true })
    .selectOption("amount");
  await editor
    .getByRole("combobox", { name: "Condition 2 comparison", exact: true })
    .selectOption("lt");
  await editor.getByLabel("Condition 2 value", { exact: true }).fill("10");
  await editor
    .getByRole("combobox", { name: "Category", exact: true })
    .selectOption("entertainment");
  await editor.getByRole("button", { name: "Add action", exact: true }).click();
  await editor
    .getByRole("combobox", { name: "Action", exact: true })
    .nth(1)
    .selectOption("rename");
  await editor.getByLabel("Display name", { exact: true }).fill("Prime Video");
  await expect(
    editor.getByRole("heading", { name: "Matches 1 existing transaction" }),
  ).toBeVisible();
  await editor.getByRole("button", { name: "Save rule", exact: true }).click();
  await expect
    .poll(
      async () => (await transactionRecord(page, "query-small"))?.categoryId,
    )
    .toBe("entertainment");
  expect(await transactionRecord(page, "query-small")).toMatchObject({
    merchant: "Prime Video",
    amount: -349,
  });
  expect(await transactionRecord(page, "query-large")).toMatchObject({
    categoryId: "shopping",
    amount: -2499,
  });
  await manager.getByRole("button", { name: "Undo", exact: true }).click();
  await expect
    .poll(async () => (await transactionRecord(page, "query-small"))?.merchant)
    .toBe("AMZN DIGITAL");
  expect(
    (await transactionRecord(page, "query-small"))?.categoryId,
  ).toBeUndefined();
});

test("text query saves a reusable view and Analyse saves a category report", async ({
  page,
}) => {
  await seed(page);
  await page.goto("/#/");
  await expect(
    page.getByRole("heading", { name: "Home", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("/");
  await expect(
    page.getByRole("searchbox", { name: "Search transactions", exact: true }),
  ).toBeFocused();
  await page.goto("/#/transactions?allDates=1&advanced=1");
  const search = page.getByRole("region", {
    name: "Advanced transaction search",
  });
  await search
    .getByRole("searchbox", { name: "Advanced transaction query" })
    .fill("amzn <10 2026");
  await expect(
    search.getByText("1 matching transaction", { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator('.transaction-list a[href*="/transactions/query-small"]'),
  ).toBeVisible();
  await expect(
    page.locator('.transaction-list a[href*="/transactions/query-large"]'),
  ).toHaveCount(0);
  await search
    .getByRole("button", { name: "Build a filter", exact: true })
    .click();
  await search
    .getByLabel("View name", { exact: true })
    .fill("Small Amazon purchases");
  await search.getByRole("button", { name: "Save view", exact: true }).click();
  await expect(
    search.getByRole("button", { name: "Small Amazon purchases", exact: true }),
  ).toBeVisible();
  await page.goto("/#/analysis");
  const report = page.locator("#report-builder");
  await report
    .getByRole("combobox", { name: "Group by", exact: true })
    .selectOption("merchant");
  await report
    .getByLabel("Report name", { exact: true })
    .fill("Merchant totals");
  await report
    .getByRole("button", { name: "Save report", exact: true })
    .click();
  await expect(
    report.getByRole("button", { name: "Merchant totals", exact: true }),
  ).toBeVisible();
  await report
    .getByRole("combobox", { name: "Group by", exact: true })
    .selectOption("tag");
  await expect(
    report.getByRole("rowheader", { name: "Lisbon trip", exact: true }),
  ).toBeVisible();
  await expect(report.getByRole("row", { name: /Lisbon trip/ })).toContainText(
    "-£24.99",
  );
  await report.getByRole("link", { name: "Lisbon trip", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Transactions", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Advanced transaction search" })
      .getByRole("status")
      .filter({ hasText: /^1 matching transaction$/ }),
  ).toBeVisible();
  await expect(
    page.locator('.transaction-list a[href*="/transactions/query-large"]'),
  ).toBeVisible();
  await expect(
    page.locator('.transaction-list a[href*="/transactions/query-small"]'),
  ).toHaveCount(0);
});
