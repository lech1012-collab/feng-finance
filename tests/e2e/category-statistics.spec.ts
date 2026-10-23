import { test, expect, type Page } from "./fixtures";
import { categoryHistoryFixture } from "../../src/tests/category-history";

async function seed(page: Page) {
  await page.clock.setFixedTime(new Date("2026-11-08T12:00:00Z"));
  const source = categoryHistoryFixture();
  await page.evaluate(
    (data) =>
      new Promise<void>((done, reject) => {
        const request = indexedDB.open("feng-finance");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(
            ["accounts", "statements", "transactions"],
            "readwrite",
          );
          for (const name of [
            "accounts",
            "statements",
            "transactions",
          ] as const)
            for (const row of data[name]) tx.objectStore(name).put(row);
          tx.oncomplete = () => {
            db.close();
            done();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    source,
  );
  // Native IndexedDB seeding bypasses Dexie's observable query cache. Reload
  // before reading through the app so empty first-launch results cannot linger.
  await page.reload();
  await page.goto("/#/categories/property?month=2026-10");
  await expect(
    page.getByRole("heading", { name: "Property", exact: true }),
  ).toBeVisible();
  return page.locator(".category-kpis").first();
}

test("category averages use six complete bank months while unrelated card history stays incomplete", async ({
  page,
}) => {
  const kpis = await seed(page);
  await expect(kpis.locator(".metric").nth(1)).toContainText("£1,300.00");
  await expect(kpis).toContainText("6 verified previous months out of 6");
  await expect(page.locator(".category-range")).toContainText(
    "Standard deviation: £374.17",
  );
  await expect(page.getByText(/Comparison accounts:/)).toContainText("Current");
  await expect(page.getByText(/Comparison accounts:/)).not.toContainText(
    "Travel",
  );
  const months = page.locator(".category-comparison-months");
  await months.locator("summary").click();
  await expect(months.locator(".category-comparison-list > li")).toHaveCount(6);
  await expect(months).toContainText("April 2026");
  await expect(months).toContainText(
    "October 2026 is the selected month and is excluded",
  );
  await page.getByText("View values", { exact: true }).click();
  await expect(page.locator(".category-months a")).toHaveCount(7);
  await page
    .locator(".category-months a")
    .filter({ hasText: "June 2026" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Transactions", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".transaction-row")).toHaveCount(1);
  await expect(
    page.getByText("Fictional property cost", { exact: true }).first(),
  ).toBeVisible();
});

test("comparisons update when another category account enters scope and explain its missing dates on mobile", async ({
  page,
}) => {
  const kpis = await seed(page);
  await expect(kpis.locator(".metric").nth(1)).toContainText("£1,300.00");
  await page.goto("/#/transactions/card-purchase");
  await page
    .getByRole("combobox", { name: "Category", exact: true })
    .selectOption("property");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise<string>((done, reject) => {
            const request = indexedDB.open("feng-finance");
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
              const db = request.result;
              const tx = db.transaction("transactions", "readonly");
              const row = tx.objectStore("transactions").get("card-purchase");
              tx.oncomplete = () => {
                db.close();
                done(row.result?.categoryId);
              };
              tx.onerror = () => reject(tx.error);
            };
          }),
      ),
    )
    .toBe("property");
  await page.goto("/#/categories/property?month=2026-10");
  await expect(kpis.locator(".metric").nth(1)).toContainText("Unavailable");
  await expect(kpis).toContainText("0 verified previous months out of 6");
  const months = page.locator(".category-comparison-months");
  await months.locator("summary").click();
  await expect(months).toContainText("statement dates need verification");
  await expect(months.locator(".category-comparison-list > li")).toHaveCount(6);
  await expect(
    months
      .locator(".category-comparison-list > li")
      .filter({ hasText: "Included" }),
  ).toHaveCount(0);
  for (const [width, fontSize] of [
    [390, "100%"],
    [320, "100%"],
    [390, "200%"],
    [430, "100%"],
  ] as const) {
    await page.setViewportSize({ width, height: 844 });
    await page.evaluate((size) => {
      document.documentElement.style.fontSize = size;
    }, fontSize);
    await expect
      .poll(
        () =>
          page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth + 1,
          ),
        { message: `${width}px, ${fontSize}` },
      )
      .toBe(false);
    await expect(
      months
        .getByText("statement dates need verification", { exact: false })
        .first(),
    ).toBeVisible();
  }
});
