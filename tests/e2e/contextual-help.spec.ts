import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Page } from "./fixtures";
import { categoryHistoryFixture } from "../../src/tests/category-history";
import { attentionHistoryFixture } from "../../src/tests/attention-history";

async function seed(
  page: Page,
  data:
    | ReturnType<typeof attentionHistoryFixture>
    | ReturnType<typeof categoryHistoryFixture>,
) {
  await page.clock.setFixedTime(new Date("2026-11-08T12:00:00Z"));
  await page.evaluate(
    (source) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("feng-finance");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const names = Object.keys(source);
          const transaction = database.transaction(names, "readwrite");
          for (const name of names)
            for (const row of source[name as keyof typeof source])
              transaction.objectStore(name).put(row);
          transaction.oncomplete = () => {
            database.close();
            resolve();
          };
          transaction.onerror = () => reject(transaction.error);
        };
      }),
    data,
  );
  await page.reload();
}

async function savedRows(page: Page) {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open("feng-finance");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const names = [
            "accounts",
            "statements",
            "transactions",
            "categories",
            "rules",
          ];
          const transaction = database.transaction(names, "readonly");
          const reads = names.map(
            (name) => [name, transaction.objectStore(name).getAll()] as const,
          );
          transaction.oncomplete = () => {
            database.close();
            resolve(
              Object.fromEntries(
                reads.map(([name, result]) => [name, result.result]),
              ),
            );
          };
          transaction.onerror = () => reject(transaction.error);
        };
      }),
  );
}

test("comparison explanations and warnings open on demand offline, with readable mobile layouts and unchanged figures", async ({
  page,
  context,
}) => {
  const data = categoryHistoryFixture();
  for (const statement of data.statements)
    statement.periodSource = "transaction-coverage";
  await seed(page, data);
  await page.goto("/#/categories/property?month=2026-10");
  const trigger = page.getByRole("button", {
    name: "About this category comparison",
  });
  await expect(trigger).toBeVisible();
  await expect(
    page.getByText("Months used for comparison (6 of 6)"),
  ).toHaveCount(0);
  await expect(
    page.getByRole("status").filter({ hasText: "Partial comparison history" }),
  ).toBeVisible();
  await expect(page.locator(".category-range")).toContainText("£1,300.00");
  const before = await savedRows(page);
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await context.setOffline(true);
  await trigger.focus();
  await page.keyboard.press("Enter");
  const help = page.getByRole("dialog", {
    name: "Category comparison",
    exact: true,
  });
  await expect(help).toBeVisible();
  await expect(help).toContainText("Sample standard deviation: £374.17");
  await expect(help).toContainText("Months used for comparison (6 of 6)");
  await expect(help).toContainText("Faded bars are partial months");
  await expect(page.getByRole("dialog")).toHaveCount(1);
  for (let index = 0; index < 5; index++) {
    await page.keyboard.press("Tab");
    expect(
      await help.evaluate((dialog) => dialog.contains(document.activeElement)),
    ).toBe(true);
  }
  for (const [width, fontSize] of [
    [320, "100%"],
    [390, "200%"],
    [430, "100%"],
  ] as const) {
    await page.setViewportSize({ width, height: 844 });
    await page.evaluate((size) => {
      document.documentElement.style.fontSize = size;
    }, fontSize);
    await expect
      .poll(() =>
        help.evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth + 1),
      )
      .toBe(true);
    await expect(
      help.getByRole("button", { name: "Close Category comparison" }),
    ).toBeVisible();
  }
  const audit = await new AxeBuilder({ page })
    .include("dialog[open]")
    .analyze();
  expect(audit.violations).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(help).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await page
    .getByRole("button", { name: "About partial category history" })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Partial category history" }),
  ).toContainText("totals may change");
  await page
    .getByRole("button", { name: "Close Partial category history" })
    .click();
  await expect(page.locator(".category-range")).toContainText("£1,300.00");
  expect(await savedRows(page)).toEqual(before);
  expect(requests).toEqual([]);
  await trigger.click();
  expect(
    await help.evaluate((dialog) => !!dialog.closest(".feng-private-content")),
  ).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await expect(help).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event("pageshow")));
  await expect(trigger).toBeVisible();
  expect(await savedRows(page)).toEqual(before);
});

test("sorting help isolates financial shortcuts and import help never opens the file picker", async ({
  page,
}) => {
  await seed(page, attentionHistoryFixture());
  await page.goto("/#/transactions?uncategorized=1&allDates=1&sort=1");
  const board = page.getByRole("dialog", {
    name: "Where does this belong?",
    exact: true,
  });
  await expect(board).toContainText("1 of 2 to sort");
  const before = await savedRows(page);
  const sortingHelp = board.getByRole("button", {
    name: "About Sorting transactions",
  });
  await sortingHelp.click();
  const help = board.getByRole("region", {
    name: "Sorting transactions",
    exact: true,
  });
  await expect(help).toBeFocused();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  for (const key of ["1", "2", "3", "j", "k", "Control+z", "Meta+z"])
    await page.keyboard.press(key);
  await expect(board).toContainText("1 of 2 to sort");
  expect(await savedRows(page)).toEqual(before);
  await page.keyboard.press("Escape");
  await expect(help).toHaveCount(0);
  await expect(sortingHelp).toBeFocused();
  await expect(board).toBeVisible();
  await board.getByRole("button", { name: "Close categorisation" }).click();
  await page.goto("/#/import");
  let pickers = 0;
  page.on("filechooser", () => {
    pickers++;
  });
  const importHelp = page.getByRole("button", {
    name: "About Importing statements",
  });
  await importHelp.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", {
    name: "Importing statements",
    exact: true,
  });
  await expect(dialog).toContainText("Digital PDFs work best");
  await dialog.getByText(/Digital PDFs work best/).click();
  await dialog
    .getByRole("button", { name: "Close Importing statements" })
    .click();
  await expect(importHelp).toBeFocused();
  expect(pickers).toBe(0);
  expect(await savedRows(page)).toEqual(before);
});
