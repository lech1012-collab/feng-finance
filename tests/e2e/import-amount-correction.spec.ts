import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Page } from "./fixtures";

async function ledger(page: Page) {
  return page.evaluate(
    () =>
      new Promise<{
        transactions: Array<{
          amount: number;
          date: string;
          description: string;
        }>;
        statements: Array<{
          openingBalance: number;
          closingBalance: number;
          validationStatus: string;
          validationDifference: number;
        }>;
      }>((resolveRows, reject) => {
        const opening = indexedDB.open("feng-finance");
        opening.onerror = () => reject(opening.error);
        opening.onsuccess = () => {
          const database = opening.result;
          const tx = database.transaction(
            ["transactions", "statements"],
            "readonly",
          );
          const transactions = tx.objectStore("transactions").getAll();
          const statements = tx.objectStore("statements").getAll();
          tx.oncomplete = () => {
            database.close();
            resolveRows({
              transactions: transactions.result,
              statements: statements.result,
            });
          };
          tx.onerror = () => {
            database.close();
            reject(tx.error);
          };
        };
      }),
  );
}

for (const setup of [
  { id: "320", width: 320, height: 568 },
  { id: "390-keyboard-space", width: 390, height: 844, keyboard: true },
  { id: "390-text200", width: 390, height: 844, large: true },
]) {
  test(`unread Beauty Code amount is editable without moving mobile cards at ${setup.id}`, async ({
    page,
    browserName,
  }, testInfo) => {
    await page.setViewportSize({ width: setup.width, height: setup.height });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/#/import");
    if ("large" in setup)
      await page.addStyleTag({ content: "html{font-size:200%!important}" });
    const requests: string[] = [];
    page.on("request", (request) => {
      if (
        request.url().startsWith("http") &&
        (new URL(request.url()).origin !== new URL(page.url()).origin ||
          request.method() !== "GET" ||
          request.postData())
      )
        requests.push(request.url());
    });
    await page
      .getByLabel("Select statements", { exact: true })
      .setInputFiles(resolve("tests/fixtures/beauty-code-correction.pdf"));
    const card = page.locator(".import-statement-card");
    await expect(card).toBeVisible();
    if (!(await card.evaluate((node) => (node as HTMLDetailsElement).open)))
      await card.locator(":scope > summary").click();
    const row = page.locator(".generic-review-row").filter({
      has: page.locator("summary strong", { hasText: "BEAUTY CODE" }),
    });
    const trigger = row.getByRole("button", {
      name: "Correct amount",
      exact: true,
    });
    await expect(trigger).toBeVisible();
    const confirm = page.getByRole("button", {
      name: "Confirm import",
      exact: true,
    });
    await expect(confirm).toBeDisabled();
    const cardX = await row.evaluate(
      (node) => node.getBoundingClientRect().left,
    );
    await trigger.click();
    const editor = page.getByRole("dialog", {
      name: "Correct transaction amount",
      exact: true,
    });
    await expect(editor).toBeVisible();
    const amount = editor.getByLabel("Amount (GBP)", { exact: true });
    await expect(amount).toBeEditable();
    await expect(amount).toHaveAttribute("inputmode", "decimal");
    await expect(amount).toHaveValue("");
    await expect(
      editor.getByRole("img", { name: /Original statement row/ }),
    ).toBeVisible();
    await expect(
      editor.getByRole("img", { name: /Original statement row/ }),
    ).toHaveAttribute("draggable", "false");
    await amount.fill("80.00");
    await editor.getByRole("button", { name: "Save row", exact: true }).click();
    await expect(editor.getByRole("alert")).toContainText(
      "Choose Money in or Money out",
    );
    await editor
      .getByRole("button", { name: "Money out", exact: true })
      .click();
    await amount.fill("80.001");
    await editor.getByRole("button", { name: "Save row", exact: true }).click();
    await expect(editor.getByRole("alert")).toContainText(
      "correct decimal places",
    );
    expect((await ledger(page)).transactions).toHaveLength(0);
    if ("keyboard" in setup) {
      // Tests reduced available space. A physical iPhone keyboard remains a manual check.
      await page.setViewportSize({ width: setup.width, height: 480 });
    }
    await amount.fill("80.00");
    const geometry = await editor.evaluate((node) => ({
      left: node.getBoundingClientRect().left,
      right: node.getBoundingClientRect().right,
      width: node.clientWidth,
      scroll: node.scrollWidth,
    }));
    expect(geometry.left).toBeGreaterThanOrEqual(-1);
    expect(geometry.right).toBeLessThanOrEqual(setup.width + 1);
    expect(geometry.scroll).toBeLessThanOrEqual(geometry.width + 1);
    expect(await page.evaluate(() => document.body.style.overflow)).toBe(
      "hidden",
    );
    if (browserName === "chromium") await page.mouse.wheel(240, 0);
    else {
      // Mobile WebKit's driver does not implement mouse.wheel. Exercise a
      // horizontal pointer drag instead; real iPhone touch panning is manual.
      const bounds = await editor.boundingBox();
      if (!bounds) throw new Error("Correction editor is not laid out");
      await page.mouse.move(40, bounds.y + 20);
      await page.mouse.down();
      await page.mouse.move(setup.width - 40, bounds.y + 20, { steps: 8 });
      await page.mouse.up();
    }
    expect(await page.evaluate(() => window.scrollX)).toBe(0);
    expect(
      await row.evaluate((node) => node.getBoundingClientRect().left),
    ).toBe(cardX);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(setup.width + 1);
    expect(
      await amount.evaluate((node) =>
        parseFloat(getComputedStyle(node).fontSize),
      ),
    ).toBeGreaterThanOrEqual(16);
    await page.screenshot({
      path: testInfo.outputPath("beauty-code-correction.png"),
    });
    if (setup.id === "320") {
      const audit = await new AxeBuilder({ page })
        .include(".ux-sheet")
        .analyze();
      expect(
        audit.violations.filter(
          (v) => v.impact === "critical" || v.impact === "serious",
        ),
      ).toEqual([]);
    }
    await editor
      .getByRole("button", { name: "Cancel correction", exact: true })
      .click();
    await expect(editor).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(confirm).toBeDisabled();
    expect((await ledger(page)).transactions).toHaveLength(0);
    await trigger.click();
    await amount.fill("80.00");
    await editor
      .getByRole("button", { name: "Money out", exact: true })
      .click();
    await editor.getByRole("button", { name: "Save row", exact: true }).click();
    await expect(editor).toHaveCount(0);
    await expect(
      page.getByText("Statement figures match exactly", { exact: true }),
    ).toBeVisible();
    await expect(confirm).toBeEnabled();
    expect((await ledger(page)).transactions).toHaveLength(0);
    await confirm.click();
    await expect(
      page.getByRole("heading", { name: "Home", exact: true }),
    ).toBeVisible();
    const saved = await ledger(page);
    expect(
      saved.transactions.map((t) => t.amount).sort((a, b) => a - b),
    ).toEqual([-8000, 200000]);
    expect(
      saved.transactions.find((t) => t.description === "BEAUTY CODE"),
    ).toMatchObject({ amount: -8000, date: "2026-09-02" });
    expect(saved.statements).toEqual([
      expect.objectContaining({
        openingBalance: 50000,
        closingBalance: 242000,
        validationStatus: "reconciled",
        validationDifference: 0,
      }),
    ]);
    expect(requests).toEqual([]);
  });
}
