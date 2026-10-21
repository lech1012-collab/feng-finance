import { resolve } from "node:path";
import { test, expect, type Page } from "./fixtures";
import { showAllStatements } from "./import-actions";

async function records(page: Page, store: string) {
  return page.evaluate(
    (name) =>
      new Promise<Record<string, unknown>[]>((done, reject) => {
        const request = indexedDB.open("feng-finance");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result,
            tx = db.transaction(name, "readonly");
          const rows = tx.objectStore(name).getAll();
          tx.oncomplete = () => {
            db.close();
            done(rows.result);
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    store,
  );
}
async function select(page: Page, unread = false) {
  await page.goto("/#/import");
  await page
    .getByLabel("Select statements", { exact: true })
    .setInputFiles([
      resolve(`tests/fixtures/card-sidebar-${unread ? "unread" : "exact"}.pdf`),
      resolve("tests/fixtures/known-bank-amex.pdf"),
    ]);
  await expect(
    page.getByRole("group", { name: "Statement view", exact: true }),
  ).toBeVisible({ timeout: 90000 });
}
test("a single Barclaycard ledger with sidebar limits imports with a second PDF and no transaction questions", async ({
  page,
}) => {
  test.setTimeout(150000);
  await select(page);
  await showAllStatements(page);
  const card = page
    .locator(".import-statement-card:visible")
    .filter({ hasText: "card-sidebar-exact.pdf" });
  await expect(card).toContainText("Barclays");
  await expect(
    page.getByRole("button", { name: "Review statement", exact: true }),
  ).toHaveCount(0);
  if (!(await card.evaluate((element) => (element as HTMLDetailsElement).open)))
    await card.locator(":scope > summary").click();
  await card.getByText("Statement details", { exact: true }).click();
  const overview = page.getByRole("dialog", {
    name: "Statement overview",
    exact: true,
  });
  await expect(overview).toContainText("23 transactions read.");
  await overview.getByRole("button", { name: /Check transactions/ }).click();
  const list = page.getByRole("dialog", {
    name: "Check transactions",
    exact: true,
  });
  await expect(
    list.getByRole("button", { name: "To check (0)", exact: true }),
  ).toBeVisible();
  await expect(
    list.getByRole("button", { name: "All (23)", exact: true }),
  ).toBeVisible();
  await list.getByRole("button", { name: "Done", exact: true }).click();
  expect(await records(page, "transactions")).toHaveLength(0);
  await page
    .getByRole("button", { name: "Confirm import", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Home", exact: true }),
  ).toBeVisible();
  const saved = await records(page, "transactions");
  expect(saved).toHaveLength(30);
  const statements = await records(page, "statements");
  const cardStatement = statements.find(
    (s) => s.sourceFilename === "card-sidebar-exact.pdf",
  );
  const postedCardRows = saved.filter(
    (t) => t.statementId === cardStatement?.id,
  );
  expect(postedCardRows).toHaveLength(23);
  expect(
    saved.find((t) => t.description === "FICTIONAL BEAUTY SHOP")?.amount,
  ).toBe(-2300);
  expect(
    saved.find((t) => t.description === "FICTIONAL RESTAURANT")?.amount,
  ).toBe(-4600);
  expect(
    postedCardRows
      .filter((t) =>
        /AVAILABLE OR|CONTACTLESS|PAYMENT INSTRUCTIONS/.test(
          String(t.description),
        ),
      )
      .map((t) => t.description),
  ).toEqual([]);
  expect(
    statements.every(
      (s) =>
        s.validationStatus === "reconciled" && s.validationDifference === 0,
    ),
  ).toBe(true);
});

test("one unread purchase asks one amount question without rechecking cover dates or help text", async ({
  page,
}, info) => {
  test.setTimeout(150000);
  await select(page, true);
  const card = page
    .locator(".import-statement-card:visible")
    .filter({ hasText: "card-sidebar-unread.pdf" });
  await card
    .getByRole("button", { name: "Review statement", exact: true })
    .click();
  const editor = page.getByRole("dialog", {
    name: "Correct amount",
    exact: true,
  });
  await expect(editor).toBeVisible({ timeout: 30000 });
  await expect(editor).toContainText("Transaction 1 of 1 to check");
  await expect(editor).toContainText(/FICTIONAL BEAUTY SHOP/i);
  await expect(
    page.getByRole("dialog", { name: "Identify account", exact: true }),
  ).toHaveCount(0);
  await editor.getByLabel("Amount (GBP)", { exact: true }).fill("23.00");
  await editor.getByRole("button", { name: "Money out", exact: true }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({ path: info.outputPath("one-source-exception.png") });
  await editor
    .getByRole("button", { name: "Save and continue", exact: true })
    .click();
  const done = page.getByRole("dialog", {
    name: "Statement checked",
    exact: true,
  });
  await expect(done).toBeVisible();
  await done.getByRole("button", { name: "Done", exact: true }).click();
  expect(await records(page, "transactions")).toHaveLength(0);
  await page
    .getByRole("button", { name: "Confirm import", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Home", exact: true }),
  ).toBeVisible();
  expect(await records(page, "transactions")).toHaveLength(30);
  const statement = (await records(page, "statements")).find(
    (s) => s.sourceFilename === "card-sidebar-unread.pdf",
  );
  expect(statement).toMatchObject({
    transactionCount: 23,
    validationStatus: "reconciled",
    validationDifference: 0,
  });
});
