import { test, expect, type Page } from "./fixtures";
import { accounts, transaction } from "../../src/tests/helpers";

async function seed(page: Page, records: Record<string, object[]>) {
  await page.clock.setFixedTime(new Date("2026-10-20T12:00:00Z"));
  await page.evaluate(
    (data) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("feng-finance");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const write = db.transaction(Object.keys(data), "readwrite");
          for (const [table, rows] of Object.entries(data))
            for (const row of rows) write.objectStore(table).put(row);
          write.oncomplete = () => {
            db.close();
            resolve();
          };
          write.onabort = () => {
            db.close();
            reject(write.error);
          };
        };
      }),
    records,
  );
  await page.reload();
}

const purchase = (id: string, date: string) =>
  transaction({
    id,
    merchant: id,
    description: id,
    categoryId: "groceries",
    date,
  });

test("Home, category history, refunds and Activity use the same payday boundaries", async ({
  page,
}) => {
  await seed(page, {
    accounts: [accounts[0]],
    settings: [
      {
        key: "period:start",
        value: JSON.stringify({ mode: "payday", day: 1 }),
      },
    ],
    transactions: [
      purchase("Early market", "2026-09-23"),
      purchase("Cycle market", "2026-09-25"),
      transaction({
        id: "September salary",
        date: "2026-09-24",
        amount: 200000,
        categoryId: "salary",
        type: "income",
      }),
      transaction({
        id: "Cycle refund",
        merchant: "Cycle refund",
        date: "2026-09-26",
        amount: 420,
        categoryId: "refund",
        type: "income",
      }),
      purchase("Future market", "2026-12-05"),
    ],
  });
  await expect(page.locator(".month-picker input[type=month]")).toHaveValue(
    "2026-10",
  );
  await page
    .locator(".not-counted")
    .getByRole("link", { name: "Refunds" })
    .click();
  await expect(page.locator(".transaction-row")).toHaveCount(1);
  await expect(page.locator(".transaction-list")).toContainText("Link refund");
  await page.locator(".transaction-row").click();
  await page.locator("a.back-link").click();
  await expect(page.locator(".transaction-row")).toHaveCount(1);
  await expect(page.locator(".filters")).toContainText("Refunds");
  await page.goto("/#/");
  await page
    .locator(".categories-card")
    .getByRole("link", { name: /Groceries/ })
    .click();
  await page.getByRole("link", { name: "View all transactions" }).click();
  await expect(page.locator(".transaction-row")).toHaveCount(1);
  await expect(page.locator(".transaction-list")).toContainText(
    /Cycle Market/i,
  );
  await page.goBack();
  await page.getByRole("button", { name: "Previous month" }).click();
  await expect(page).toHaveURL(/month=2026-09/);
  await page.getByRole("link", { name: "View all transactions" }).click();
  await expect(page.locator(".transaction-list")).toContainText(
    /Early Market/i,
  );
  await expect(page.locator(".transaction-row")).toHaveCount(1);
  await page.goBack();
  await expect(page.locator(".month-picker input[type=month]")).toHaveValue(
    "2026-09",
  );
});

test("filtering a selection removes hidden payments and Accounts returns to the filtered list", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 870 });
  await seed(page, {
    accounts: [
      { ...accounts[0], tracking: "manual", displayName: "Cash wallet" },
    ],
    valuations: [
      {
        id: "opening",
        accountId: "a1",
        date: "2026-08-01",
        valueMinor: 10000,
        note: "Cash opening balance",
      },
    ],
    transactions: ["First market", "Second market"].map((id, i) => ({
      ...purchase(id, `2026-09-0${i + 1}`),
      source: "manual",
    })),
  });
  await page.goto("/#/transactions?month=2026-09");
  const account = page.getByRole("button", { name: /Cash wallet/i });
  await expect(account).toContainText("£80.00");
  await page
    .locator(".transaction-row")
    .filter({ hasText: /First Market/i })
    .click({ modifiers: ["Control"] });
  await expect(
    page.getByRole("button", { name: "Clear selection" }),
  ).toBeVisible();
  await page.locator("#transaction-search").fill("Second");
  await expect(page.locator(".transaction-row")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Clear selection" }),
  ).toHaveCount(0);
  await page
    .locator(".transaction-tools")
    .getByRole("link", { name: "Accounts" })
    .click();
  await page.locator("a.back-link").click();
  await expect(page.locator("#transaction-search")).toHaveValue("Second");
  await expect(page.locator(".transaction-list")).toContainText(
    /Second Market/i,
  );
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(page.locator(".transaction-row")).toHaveCount(2);
  await expect(
    page.getByRole("button", { name: "Clear selection" }),
  ).toHaveCount(0);
});

test("Home transfer review follows both sides of the period boundary and preserves other months", async ({
  page,
}) => {
  const transferRows = [
    "2026-09-30",
    "2026-10-01",
    "2026-08-08",
    "2026-08-09",
  ].map((date, i) =>
    transaction({
      id: `side-${i}`,
      date,
      merchant: `Match ${i}`,
      description: `Match ${i}`,
      accountId: i % 2 ? "a2" : "a1",
      amount: i % 2 ? 900 : -900,
    }),
  );
  await seed(page, {
    accounts: accounts.slice(0, 2),
    transactions: transferRows,
    transferProposals: [
      {
        id: "current",
        debitTxId: "side-0",
        creditTxId: "side-1",
        score: 100,
        status: "pending",
      },
      {
        id: "old",
        debitTxId: "side-2",
        creditTxId: "side-3",
        score: 100,
        status: "pending",
      },
    ],
  });
  await page
    .locator(".home-todos")
    .getByRole("link", { name: /transfer/i })
    .click();
  const queue = page.getByRole("region", { name: "Transfers to confirm" });
  await expect(queue).toContainText("Match 0");
  await expect(queue).toContainText("Match 1");
  await expect(queue).not.toContainText("Match 2");
  await queue
    .getByRole("button", { name: "These are separate payments" })
    .click();
  await expect(
    page.getByText("No transfers left to confirm for these dates."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(queue).toBeVisible();
  await page.goto("/#/transactions?transfers=1&month=2026-08");
  await expect(queue).toContainText("Match 2");
  await expect(queue).not.toContainText("Match 0");
});

test("foreign spending without a rate never appears as zero and empty subscriptions open the picker", async ({
  page,
}) => {
  await seed(page, {
    accounts: [{ ...accounts[0], currency: "EUR" }],
    transactions: [
      { ...purchase("Foreign market", "2026-09-02"), currency: "EUR" },
    ],
  });
  const categories = page.locator(".categories-card");
  await expect(categories).toContainText("Add exchange rates");
  await expect(categories).not.toContainText("No spending");
  await categories.getByRole("link", { name: "Review exchange rates" }).click();
  await expect(page.locator("#global-currency")).toBeVisible();
  await page.goto("/#/subscriptions");
  const picker = page.waitForEvent("filechooser");
  await page
    .getByRole("button", { name: "Import statements", exact: true })
    .click();
  const chooser = await picker;
  expect(chooser.isMultiple()).toBe(true);
  await chooser.setFiles([]);
  await expect(page).toHaveURL(/subscriptions/);
  await page.goto("/#/transactions?month=bad");
  await expect(page.locator(".transaction-row")).toHaveCount(1);
});

test("returning from a purchase restores the category, selected month and originating analysis range", async ({
  page,
}) => {
  await seed(page, {
    accounts: [accounts[0]],
    transactions: [
      purchase("Garden market", "2026-09-03"),
      purchase("Park market", "2026-10-02"),
    ],
  });
  await page.goto("/#/analysis?period=3");
  await page
    .getByRole("combobox", { name: "Category analysis" })
    .selectOption("groceries");
  await page.getByRole("button", { name: "Previous month" }).click();
  await page
    .locator("a.subscription-evidence")
    .filter({ hasText: /Garden market/i })
    .click();
  await page.getByRole("link", { name: /Category overview/ }).click();
  await expect(page.locator(".month-picker input[type=month]")).toHaveValue(
    "2026-09",
  );
  await page.locator("a.back-link").click();
  await expect(page).toHaveURL(/analysis\?period=3/);
  await expect(
    page.getByRole("button", { name: "3 months", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("a bill in the Home review count opens in the queue and evidence returns to the chosen view", async ({
  page,
}) => {
  await seed(page, {
    accounts: [accounts[0]],
    transactions: ["2026-08-02", "2026-09-02", "2026-10-02"].map((date, i) =>
      transaction({
        id: `water-${i}`,
        date,
        merchant: "Example Water",
        description: "Example Water",
        categoryId: "utilities",
        amount: -3400,
      }),
    ),
  });
  await page
    .locator(".home-todos")
    .getByRole("link", { name: /1 recurring charge to review/i })
    .click();
  await expect(page.locator(".subscription-list")).toContainText(
    /Example Water/i,
  );
  await page.getByRole("button", { name: "Bills", exact: true }).click();
  await page.getByRole("button", { name: "All detected", exact: true }).click();
  await page.getByText(/View 3 charges and source evidence/).click();
  await page.locator(".recurring-charge-row").first().click();
  await page.getByRole("link", { name: /‹ Subscriptions/ }).click();
  await expect(
    page.getByRole("button", { name: "Bills", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("button", { name: "All detected", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});
