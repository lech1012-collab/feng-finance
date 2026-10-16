import { resolve } from "node:path";
import { test, expect, type Locator, type Page } from "./fixtures";
import { loadDemoUi } from "./flows";

async function repaymentRecords(page: Page) {
  return page.evaluate(
    () =>
      new Promise<{
        plan?: { key: string; value: string };
        accounts: unknown[];
      }>((resolve, reject) => {
        const open = indexedDB.open("feng-finance");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const database = open.result;
          const read = database.transaction(
            ["settings", "accounts"],
            "readonly",
          );
          const plan = read.objectStore("settings").get("debt-plan:GBP");
          const accounts = read.objectStore("accounts").getAll();
          read.oncomplete = () => {
            database.close();
            resolve({ plan: plan.result, accounts: accounts.result });
          };
          read.onerror = () => {
            database.close();
            reject(read.error);
          };
        };
      }),
  );
}

test("repayment drafts stay unsaved until Done and both editors preserve Undo and source records", async ({
  page,
}) => {
  await loadDemoUi(page);
  await page.goto("/#/planning?tab=debt");
  const editPlan = page.getByRole("button", {
    name: "Edit repayment plan",
    exact: true,
  });
  await expect(editPlan).toBeVisible();
  const before = await repaymentRecords(page);
  const source = await ledger(page);
  await editPlan.click();
  let sheet = page.getByRole("dialog", { name: "Repayment plan", exact: true });
  const oldAmount = await sheet
    .getByLabel("Monthly amount available", { exact: true })
    .inputValue();
  await sheet
    .getByLabel("Monthly amount available", { exact: true })
    .fill("450.00");
  await page.waitForTimeout(1100);
  expect(await repaymentRecords(page)).toEqual(before);
  await page.keyboard.press("Escape");
  await editPlan.click();
  sheet = page.getByRole("dialog", { name: "Repayment plan", exact: true });
  await expect(
    sheet.getByLabel("Monthly amount available", { exact: true }),
  ).toHaveValue(oldAmount);
  await sheet
    .getByLabel("Monthly amount available", { exact: true })
    .fill("450.00");
  await sheet.getByRole("button", { name: "Done", exact: true }).click();
  const savedPlan = page
    .getByRole("status")
    .filter({ hasText: "Repayment settings saved." });
  await savedPlan.getByRole("button", { name: "Undo", exact: true }).click();
  await expect.poll(() => repaymentRecords(page)).toEqual(before);

  await page
    .getByRole("button", { name: "Edit repayment terms", exact: true })
    .first()
    .click();
  sheet = page.getByRole("dialog", { name: / terms$/ });
  const apr = sheet.getByRole("textbox").first();
  const oldApr = await apr.inputValue();
  const nextApr = oldApr === "19.9" ? "20.1" : "19.9";
  await apr.fill(nextApr);
  await page.waitForTimeout(1100);
  expect(await repaymentRecords(page)).toEqual(before);
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Edit repayment terms", exact: true })
    .first()
    .click();
  sheet = page.getByRole("dialog", { name: / terms$/ });
  await expect(sheet.getByRole("textbox").first()).toHaveValue(oldApr);
  await sheet.getByRole("textbox").first().fill(nextApr);
  await sheet.getByRole("button", { name: "Done", exact: true }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "Debt terms saved." })
    .getByRole("button", { name: "Undo", exact: true })
    .click();
  await expect.poll(() => repaymentRecords(page)).toEqual(before);
  expect(await ledger(page)).toEqual(source);
});

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

test.describe("UK date entry", () => {
  test.use({ locale: "en-US" });
  test("rule conditions fit desktop sheets and both date boundaries use UK order", async ({
    page,
    baseURL,
  }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto(`${baseURL}/#/settings?section=rules`);
    await page
      .getByRole("button", { name: "Create rule", exact: true })
      .click();
    const sheet = page.getByRole("dialog", {
      name: "Create rule",
      exact: true,
    });
    const field = sheet.getByRole("combobox", {
      name: "Condition 1 field",
      exact: true,
    });
    const comparison = sheet.getByRole("combobox", {
      name: "Condition 1 comparison",
      exact: true,
    });
    const value = sheet.getByRole("textbox", {
      name: "Condition 1 value",
      exact: true,
    });
    const fieldBox = await field.boundingBox(),
      comparisonBox = await comparison.boundingBox();
    expect(fieldBox!.width).toBeGreaterThan(300);
    expect(comparisonBox!.y).toBeGreaterThan(fieldBox!.y + fieldBox!.height);
    await field.selectOption("date");
    await comparison.selectOption("between");
    await value.fill("01092026");
    const end = sheet.getByRole("textbox", {
      name: "Condition 1 range end",
      exact: true,
    });
    await end.fill("30092026");
    await expect(value).toHaveValue("01/09/2026");
    await expect(end).toHaveValue("30/09/2026");
    await end.fill("31/04/2026");
    await expect(end).toHaveAttribute("aria-invalid", "true");
    expect((await ledger(page)).transactions).toEqual([]);
  });
  test("uses UK day/month order in a US browser and never saves a stale date after invalid entry", async ({
    page,
    baseURL,
  }) => {
    await page.clock.setFixedTime(new Date("2026-10-14T12:00:00Z"));
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto(`${baseURL}/#/transactions`);
    await page
      .getByRole("button", { name: "Add manual transaction", exact: true })
      .click();
    const sheet = page.getByRole("dialog", {
      name: "Manual transaction",
      exact: true,
    });
    const date = sheet.getByRole("textbox", { name: "Date", exact: true });
    await expect(date).toHaveValue("14/10/2026");
    await date.fill("09/01/2026");
    await expect(date).toHaveValue("09/01/2026");
    await date.fill("09012026");
    await expect(date).toHaveValue("09/01/2026");
    await sheet
      .getByLabel("Description", { exact: true })
      .fill("Fictitious UK date payment");
    await sheet.getByLabel(/Amount/).fill("12.34");
    await sheet
      .getByRole("button", { name: "Save manual transaction", exact: true })
      .click();
    await expect(sheet).toHaveCount(0);
    const saved = await ledger(page);
    expect(saved.transactions).toHaveLength(1);
    expect(saved.transactions[0]).toMatchObject({
      date: "2026-01-09",
      amount: -1234,
    });
    await page
      .getByRole("button", { name: "Add manual transaction", exact: true })
      .click();
    await date.fill("09/30/2026");
    await date.press("Tab");
    await expect(date).toHaveAttribute("aria-invalid", "true");
    await expect(sheet.getByRole("alert")).toContainText("DD/MM/YYYY");
    expect((await ledger(page)).transactions).toEqual(saved.transactions);
  });
});

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
