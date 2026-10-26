import { test, expect, type Page } from "./fixtures";
import { resolve } from "node:path";

async function records(page: Page, table: string) {
  return page.evaluate(
    (name) =>
      new Promise<Record<string, unknown>[]>((resolve, reject) => {
        const request = indexedDB.open("feng-finance");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const query = database.transaction(name).objectStore(name).getAll();
          query.onsuccess = () => {
            database.close();
            resolve(query.result);
          };
          query.onerror = () => {
            database.close();
            reject(query.error);
          };
        };
      }),
    table,
  );
}

test("manual assets, earmarked pots, debt plans and scenarios keep actual bank records unchanged", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-10-07T12:00:00Z"));
  await page.goto("/#/import");
  await page
    .getByLabel("Select statements")
    .setInputFiles(resolve("tests/fixtures/barclays-income.pdf"));
  await expect(page.locator(".import-outcome-footer")).toContainText("new");
  await page
    .getByRole("button", { name: "Confirm import", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Home", exact: true }),
  ).toBeVisible();
  const originalTransactions = await records(page, "transactions");
  const originalStatements = await records(page, "statements");
  const cash = page
    .locator(".position-metrics > a")
    .filter({ hasText: /^Cash/ });
  await expect(cash).toContainText("£5,126.00");

  await page.goto("/#/settings#manual-accounts");
  const assets = page.locator("main");
  await assets
    .getByRole("button", { name: "Add account", exact: true })
    .click();
  await assets.getByLabel("Name", { exact: true }).fill("Fictitious flat");
  await assets.getByLabel("Value as of", { exact: true }).fill("2026-09-30");
  await assets.getByLabel("Account value", { exact: true }).fill("100000");
  await assets
    .getByRole("button", { name: "Save valuation", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Account valuation saved",
  );
  await page.goto("/#/");
  await expect(page.locator(".position-net-worth")).toContainText(
    "£105,126.00",
  );
  await expect(cash).toContainText("£5,126.00");
  await expect(page.locator(".month-net")).toContainText("+£4,126.00");

  await page.goto("/#/planning");
  await page.getByRole("tab", { name: "Pots", exact: true }).click();
  await page.getByRole("button", { name: "New pot", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Fictitious holiday");
  await page.getByLabel("Target amount", { exact: true }).fill("600");
  await page.getByLabel("Due date", { exact: true }).fill("2027-03-31");
  await page.getByRole("button", { name: "Save pot", exact: true }).click();
  await page
    .getByLabel("Fictitious holiday contribution", { exact: true })
    .fill("100");
  await page
    .getByRole("button", { name: "Confirm contribution", exact: true })
    .click();
  await expect
    .poll(async () =>
      Number(
        await page
          .getByRole("progressbar", { name: "Fictitious holiday saved" })
          .getAttribute("aria-valuenow"),
      ),
    )
    .toBeCloseTo(100 / 6, 5);
  await page.goto("/#/");
  await expect(cash).toContainText("£5,126.00");
  await expect(cash).toContainText("Set aside £100.00");

  await page.goto("/#/settings#manual-accounts");
  await assets
    .getByRole("button", { name: "Add account", exact: true })
    .click();
  await assets.getByLabel("Name", { exact: true }).fill("Fictitious loan");
  await assets
    .getByRole("combobox", { name: "Type", exact: true })
    .selectOption("loan");
  await assets.getByLabel("Value as of", { exact: true }).fill("2026-09-30");
  await assets.getByLabel("Amount owed", { exact: true }).fill("2000");
  await assets.getByLabel("APR %", { exact: true }).fill("24");
  await assets
    .getByLabel("Minimum monthly payment", { exact: true })
    .fill("100");
  await assets
    .getByRole("button", { name: "Save valuation", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Account valuation saved",
  );
  await page.goto("/#/planning");
  await page.getByRole("tab", { name: "Debt", exact: true }).click();
  await page
    .getByRole("button", { name: "Edit repayment plan", exact: true })
    .click();
  await page
    .getByLabel("Monthly amount available", { exact: true })
    .fill("300");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(
    page.getByText("Estimated debt-free", { exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Forecast", exact: true }).click();
  await page
    .getByRole("button", { name: "Edit scenario", exact: true })
    .click();
  await page.getByLabel("Amount (GBP)").fill("200");
  await page.getByLabel("Label", { exact: true }).fill("Fictitious repair");
  await page
    .getByRole("button", { name: "Add adjustment", exact: true })
    .click();
  await page.getByLabel("Scenario name", { exact: true }).fill("Repair plan");
  await page
    .getByRole("button", { name: "Save scenario", exact: true })
    .click();
  await expect(
    page.getByText("Scenario saved.", { exact: false }),
  ).toBeVisible();
  expect(await records(page, "scenarios")).toHaveLength(1);
  expect(await records(page, "transactions")).toEqual(originalTransactions);
  expect(await records(page, "statements")).toEqual(originalStatements);
  await page.reload();
  await page
    .getByRole("button", { name: "Edit scenario", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Saved scenario", exact: true })
    .selectOption({ label: "Repair plan" });
  await expect(
    page.getByRole("button", { name: "Remove Fictitious repair" }),
  ).toBeVisible();
});
