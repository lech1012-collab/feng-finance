import { resolve } from "node:path";
import { test, expect, type Locator, type Page } from "./fixtures";

async function tabTo(page: Page, target: Locator) {
  await expect(target).toBeVisible();
  for (let step = 0; step < 100; step++) {
    if (
      await target.evaluate(
        (element) =>
          element === document.activeElement ||
          element.contains(document.activeElement),
      )
    )
      return;
    await page.keyboard.press("Tab");
  }
  throw new Error(
    `Keyboard could not reach ${(await target.getAttribute("aria-label")) ?? (await target.textContent())}.`,
  );
}

async function ledger(page: Page) {
  return page.evaluate(
    () =>
      new Promise<{
        transactions: Array<{
          id: string;
          date: string;
          amount: number;
          currency: string;
          accountId: string;
          statementId: string;
          transactionFingerprint: string;
          categoryId?: string;
        }>;
        statements: unknown[];
      }>((resolve, reject) => {
        const open = indexedDB.open("feng-finance");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const database = open.result;
          const read = database.transaction(
            ["transactions", "statements"],
            "readonly",
          );
          const transactions = read.objectStore("transactions").getAll();
          const statements = read.objectStore("statements").getAll();
          read.oncomplete = () => {
            database.close();
            resolve({
              transactions: transactions.result,
              statements: statements.result,
            });
          };
          read.onerror = () => {
            database.close();
            reject(read.error);
          };
        };
      }),
  );
}

test("desktop keyboard import, Home and categorisation have accessible names, local-only requests and unchanged source money", async ({
  page,
  context,
}) => {
  test.setTimeout(120000);
  await page.clock.setFixedTime(new Date("2026-10-14T12:00:00Z"));
  await page.setViewportSize({ width: 1440, height: 900 });
  const origin = new URL(page.url()).origin;
  const unexpected: string[] = [];
  context.on("request", (request) => {
    if (!/^https?:/.test(request.url())) return;
    const address = new URL(request.url());
    if (
      address.origin !== origin ||
      request.method() !== "GET" ||
      request.postData()
    )
      unexpected.push(
        `${request.method()} ${address.origin}${address.pathname}`,
      );
  });
  const choose = page.getByRole("button", {
    name: "Import your first statement",
    exact: true,
  });
  await tabTo(page, choose);
  const picker = page.waitForEvent("filechooser");
  await page.keyboard.press("Enter");
  await (await picker).setFiles(resolve("tests/fixtures/barclays-sort.pdf"));
  const confirm = page.getByRole("button", {
    name: "Confirm import",
    exact: true,
  });
  await expect(confirm).toBeEnabled();
  await tabTo(page, confirm);
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Home", exact: true }),
  ).toBeVisible();
  const before = await ledger(page);
  expect(
    before.transactions.map((row) => row.amount).sort((a, b) => a - b),
  ).toEqual([-3000, -2000, -1500]);
  const navigation = page
    .getByRole("navigation", { name: "Main navigation" })
    .filter({ visible: true });
  await tabTo(
    page,
    navigation.getByRole("link", { name: "Transactions", exact: true }),
  );
  await page.keyboard.press("Enter");
  const row = page.getByRole("link", {
    name: /Corner Shop,.*Needs category.*−£30\.00/,
  });
  await tabTo(page, row);
  await expect(row).toHaveAttribute("aria-keyshortcuts", "C");
  await page.keyboard.press("c");
  const sheet = page.getByRole("dialog", { name: "Where does this belong?" });
  await expect(sheet).toBeVisible();
  const groceries = sheet.getByRole("button", {
    name: "Categorise as Groceries",
    exact: true,
  });
  await tabTo(page, groceries);
  await page.keyboard.press("Enter");
  await expect
    .poll(
      async () =>
        (await ledger(page)).transactions.filter(
          (row) => row.categoryId === "groceries",
        ).length,
    )
    .toBe(2);
  await expect(
    page.getByRole("button", { name: "Undo", exact: true }),
  ).toBeVisible();
  const after = await ledger(page);
  const sourceFields = (rows: typeof before.transactions) =>
    rows.map(
      ({
        id,
        date,
        amount,
        currency,
        accountId,
        statementId,
        transactionFingerprint,
      }) => ({
        id,
        date,
        amount,
        currency,
        accountId,
        statementId,
        transactionFingerprint,
      }),
    );
  expect(sourceFields(after.transactions)).toEqual(
    sourceFields(before.transactions),
  );
  expect(after.statements).toEqual(before.statements);
  // The advertised shortcut remains available while reviewing source evidence,
  // including after the six-second notification has expired.
  await page.keyboard.press("Control+z");
  await expect
    .poll(
      async () =>
        (await ledger(page)).transactions.filter(
          (row) => row.categoryId === "groceries",
        ).length,
    )
    .toBe(0);
  const undone = await ledger(page);
  expect(sourceFields(undone.transactions)).toEqual(
    sourceFields(before.transactions),
  );
  expect(undone.statements).toEqual(before.statements);
  expect(unexpected).toEqual([]);
});
