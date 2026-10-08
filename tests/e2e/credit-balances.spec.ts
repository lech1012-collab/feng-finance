import { test, expect, type Page } from "@playwright/test";
import { resolve } from "node:path";
import type { Transaction } from "../../src/domain/models";

const fixture = (name: string) => resolve(`tests/fixtures/${name}.pdf`);

async function importStatement(page: Page, name: string) {
  await page.goto("/#/import");
  await expect(
    page.getByRole("heading", { name: "Import statements", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Select PDF statements").setInputFiles(fixture(name));
  await expect(page.locator(".import-review-list")).toBeVisible({
    timeout: 90000,
  });
  const card = page.locator(".import-statement-card");
  await expect(card).toHaveCount(1);
  if (!(await card.evaluate((element) => (element as HTMLDetailsElement).open)))
    await card.locator(":scope > summary").click();
  await expect(
    card.getByText("✓ Statement reconciled", { exact: true }),
  ).toBeVisible();
  const confirm = page.getByRole("button", {
    name: "Confirm import",
    exact: true,
  });
  const acknowledgement = card.getByLabel(
    /I compared the extracted rows with the PDF/,
  );
  if (name === "barclaycard" || name === "amex-uk-layout")
    await expect(acknowledgement).toBeVisible();
  if (name === "amex-uk-layout")
    await expect(
      card.getByText(/1 transaction dates fall outside/),
    ).toBeVisible();
  if (await acknowledgement.count()) {
    await expect(confirm).toBeDisabled();
    await acknowledgement.check();
  }
  await confirm.click();
  await expect(
    page.getByRole("heading", { name: "Home", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: "Import complete" }),
  ).toBeVisible();
}

function positionMetric(page: Page, label: string) {
  return page.locator(".position-metrics > div").filter({
    has: page.locator("span").filter({ hasText: new RegExp(`^${label}$`) }),
  });
}

async function assertSingleClosingPoint(
  page: Page,
  date: string,
  signedBalance: string,
) {
  const rows = page.locator(".balance-chart tbody tr");
  const closing = rows.filter({ has: page.getByText(date, { exact: true }) });
  await expect(closing).toHaveCount(1);
  await expect(closing).toContainText(signedBalance);
  await expect(rows.filter({ hasText: "£" })).toHaveCount(1);
  await expect(page.locator(".balance-periods")).toHaveCount(0);
  await expect(page.locator(".balance-range-note")).toContainText(
    "Import another reconciled statement",
  );
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-08T12:00:00Z"));
});

test("Barclaycard issue-date balance is debt, persists, and never becomes a September balance", async ({
  page,
}) => {
  await importStatement(page, "barclaycard");
  await expect(page.getByLabel("Selected month")).toHaveValue("2026-10");
  await expect(positionMetric(page, "Card debt").locator("strong")).toHaveText(
    "£109.68",
  );
  await expect(positionMetric(page, "Cash")).toContainText("Unknown");
  await expect(positionMetric(page, "Net position")).toContainText(
    "Unavailable",
  );
  await expect(page.locator(".balance-account-value")).toContainText(
    "Card debt",
  );
  await expect(page.locator(".balance-account-main")).toContainText(
    "As of 4 Oct 2026",
  );
  await expect(page.locator(".balance-account-value")).not.toContainText(
    "Unverified",
  );
  // A reconciled closing sum does not turn inferred transaction coverage into
  // verified monthly coverage, or invent daily balances between purchases.
  await expect(page.locator(".month-summary")).toContainText(
    "Monthly history is not fully verified",
  );
  await assertSingleClosingPoint(page, "4 Oct", "-£109.68");

  await page.getByLabel("Selected month").fill("2026-09");
  await expect(positionMetric(page, "Card debt")).toContainText("Unknown");
  await expect(page.locator(".balance-account-value")).toContainText("Unknown");
  await expect(
    page.locator(".balance-chart tbody tr").filter({ hasText: "£" }),
  ).toHaveCount(0);
  await expect(
    page.locator(".balance-chart table").getByText("4 Oct", { exact: true }),
  ).toHaveCount(0);
  // £114.68 of purchases and a £5 refund leave £109.68 of card debt.
  // Statement debt must not replace gross spending in the month card.
  await expect(page.locator(".month-spending strong")).toHaveText("£114.68");
  await expect(page.locator(".month-net strong")).toHaveText("n/a");

  await page.getByLabel("Selected month").fill("2026-10");
  await page.reload();
  await expect(page.getByLabel("Selected month")).toHaveValue("2026-10");
  await expect(positionMetric(page, "Card debt").locator("strong")).toHaveText(
    "£109.68",
  );
  await page.goto("/#/transactions?month=2026-10&allDates=1");
  const accountChip = page
    .getByRole("group", { name: "Filter by account" })
    .getByRole("button", { name: /Barclays.*4444/ });
  await expect(accountChip).toContainText("£109.68 debt");
  await expect(accountChip).not.toContainText("-£109.68");
  await expect(accountChip).not.toContainText("Unverified");
});

test("Amex dated purchase exception keeps its reconciled closing debt and requires review", async ({
  page,
}) => {
  await importStatement(page, "amex-uk-layout");
  await expect(page.getByLabel("Selected month")).toHaveValue("2026-10");
  await expect(positionMetric(page, "Card debt").locator("strong")).toHaveText(
    "£160.00",
  );
  await expect(page.locator(".balance-account-main")).toContainText(
    "As of 5 Oct 2026",
  );
  await expect(page.locator(".balance-account-value")).not.toContainText(
    "Unverified",
  );
  await expect(page.locator(".month-summary")).toContainText(
    "Monthly history is not fully verified",
  );
  await assertSingleClosingPoint(page, "5 Oct", "-£160.00");
  await page.reload();
  await expect(positionMetric(page, "Card debt").locator("strong")).toHaveText(
    "£160.00",
  );
  await page.goto("/#/transactions?month=2026-10&allDates=1");
  const accountChip = page
    .getByRole("group", { name: "Filter by account" })
    .getByRole("button", { name: /American Express.*0444/ });
  await expect(accountChip).toContainText("£160.00 debt");
  await expect(accountChip).not.toContainText("-£160.00");
  await expect(accountChip).not.toContainText("Unverified");
  await page.reload();
  await expect(accountChip).toContainText("£160.00 debt");
});

test("a missing stored card row retains the reported balance but removes verified debt, net and history", async ({
  page,
}) => {
  // Both printed October closing dates are past, so the current account can
  // provide a genuine cash/net baseline before simulating a missing card row.
  await page.clock.setFixedTime(new Date("2026-11-08T12:00:00Z"));
  await importStatement(page, "barclays-october");
  await importStatement(page, "barclaycard");
  await expect(page.getByLabel("Selected month")).toHaveValue("2026-10");
  await expect(positionMetric(page, "Cash").locator("strong")).toHaveText(
    "£955.00",
  );
  await expect(positionMetric(page, "Card debt").locator("strong")).toHaveText(
    "£109.68",
  );
  await expect(
    positionMetric(page, "Net position").locator("strong"),
  ).toHaveText("£845.32");

  const affectedRows = await page.evaluate(
    () =>
      new Promise<{ before: number; after: number }>((resolve, reject) => {
        const request = indexedDB.open("feng-finance");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const write = database.transaction(["transactions"], "readwrite");
          const store = write.objectStore("transactions");
          const records = store.getAll();
          let before = 0;
          let after = 0;
          records.onsuccess = () => {
            const rows = records.result as Transaction[];
            const purchase = rows.find((row) => row.merchant === "WAITROSE");
            if (!purchase) {
              write.abort();
              return;
            }
            before = rows.filter(
              (row) => row.statementId === purchase.statementId,
            ).length;
            store.delete(purchase.id);
            const remaining = store
              .index("statementId")
              .count(purchase.statementId);
            remaining.onsuccess = () => {
              after = remaining.result;
            };
          };
          write.oncomplete = () => {
            database.close();
            resolve({ before, after });
          };
          write.onerror = () => reject(write.error);
          write.onabort = () =>
            reject(new Error("Synthetic purchase was not found"));
        };
      }),
  );
  expect(affectedRows).toEqual({ before: 6, after: 5 });
  await page.reload();
  await expect(page.getByLabel("Selected month")).toHaveValue("2026-10");
  await expect(positionMetric(page, "Cash").locator("strong")).toHaveText(
    "£955.00",
  );
  await expect(positionMetric(page, "Card debt").locator("strong")).toHaveText(
    "Unknown",
  );
  await expect(
    positionMetric(page, "Net position").locator("strong"),
  ).toHaveText("Unavailable");
  const reportedCard = page
    .locator(".balance-account")
    .filter({ hasText: "4444" });
  await expect(reportedCard).toContainText("£109.68");
  await expect(reportedCard).toContainText("Unverified reported balance");
  await expect(reportedCard).toContainText("Stored transactions do not match");
  await expect(page.locator(".month-summary")).toContainText(
    "Monthly history is not fully verified",
  );
  await expect(
    page.locator(".balance-chart tbody tr").filter({ hasText: "-£109.68" }),
  ).toHaveCount(0);
  await expect(
    page.locator(".balance-chart tbody tr").filter({ hasText: "£845.32" }),
  ).toHaveCount(0);
  await page.goto("/#/transactions?month=2026-10&allDates=1");
  const accountChip = page
    .getByRole("group", { name: "Filter by account" })
    .getByRole("button", { name: /Barclays.*4444/ });
  await expect(accountChip).toContainText("£109.68 debt");
  await expect(accountChip).toContainText("Reported · Unverified");
});
