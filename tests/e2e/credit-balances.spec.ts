import { saveReadableBackup, settingsSection, loadDemoUi } from "./flows";
import {
  acceptStatementWarnings,
  acceptUnverifiedStatement,
  revealStatement,
} from "./import-actions";
import { test, expect, type Page } from "./fixtures";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import type { Transaction } from "../../src/domain/models";

const fixture = (name: string) => resolve(`tests/fixtures/${name}.pdf`);

async function importStatement(page: Page, name: string) {
  await page.goto("/#/import");
  await expect(
    page.getByRole("heading", { name: "Import statements", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Select statements").setInputFiles(fixture(name));
  await expect(
    page.getByRole("group", { name: "Statement view", exact: true }),
  ).toBeVisible({
    timeout: 90000,
  });
  const card = page.locator(".import-statement-card");
  await expect(card).toHaveCount(1);
  await revealStatement(card);
  if (!(await card.evaluate((element) => (element as HTMLDetailsElement).open)))
    await card.locator(":scope > summary").click();
  if (name === "amex-uk-layout")
    await expect(
      card.locator(".validation").getByText("Statement needs review", {
        exact: true,
      }),
    ).toBeVisible();
  else
    await expect(
      card.getByText("✓ Statement reconciled", { exact: true }),
    ).toBeVisible();
  const confirm = page.getByRole("button", {
    name: "Confirm import",
    exact: true,
  });
  const acknowledgement = card.getByRole("button", {
    name: "Accept these statement warnings",
    exact: true,
  });
  if (name === "barclaycard" || name === "amex-uk-layout")
    await expect(acknowledgement).toBeVisible();
  if (name === "amex-uk-layout")
    await expect(
      card.getByText(
        /transaction dates? (?:is|fall) outside the statement period/,
      ),
    ).toBeVisible();
  if (name === "amex-uk-layout") {
    await expect(confirm).toBeDisabled();
    await expect(card.locator(".generic-import-review")).toHaveCount(0);
    await acceptUnverifiedStatement(page, card);
    await expect(
      card.getByRole("button", {
        name: "Undo warning acceptance",
        exact: true,
      }),
    ).toBeVisible();
  } else if (await acknowledgement.count()) {
    await expect(confirm).toBeDisabled();
    await acceptStatementWarnings(card);
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
  return page.locator(".position-metrics > a").filter({
    has: page.locator("span").filter({ hasText: new RegExp(`^${label}$`) }),
  });
}

async function assertSingleClosingPoint(
  page: Page,
  date: string,
  balance: string,
) {
  const trend = page.getByRole("region", {
    name: "Balance trend",
    exact: true,
  });
  await expect(trend.locator(".balance-trend-headline")).toContainText(balance);
  await expect(trend.locator(".balance-trend-headline")).toContainText(
    "Debt owed",
  );
  await expect(trend.locator(".balance-trend-headline time")).toHaveText(
    `${date} 2026`,
  );
  await expect(trend.locator(".balance-trend-headline")).toHaveAttribute(
    "data-verified",
    "true",
  );
  await expect(trend.getByRole("img")).toHaveCount(0);
  await expect(trend.getByRole("slider")).toHaveCount(0);
  await expect(trend.locator(".balance-periods")).toHaveCount(0);
  await expect(trend.getByText(/Earlier statements will show/)).toBeVisible();
  await trend.getByText("How this is calculated", { exact: true }).click();
  await expect(
    trend.getByText(
      /Card summaries supply balances only on their statement dates/,
    ),
  ).toBeVisible();
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
  await expect(positionMetric(page, "Cash")).toContainText("Not imported");
  await expect(positionMetric(page, "Net worth")).toContainText("Unavailable");
  await page.goto("/#/accounts");
  const cardAccount = page
    .locator(".account-overview-row")
    .filter({ hasText: "4444" });
  await expect(cardAccount).toContainText("£109.68");
  await expect(cardAccount).toContainText("Debt owed");
  await expect(cardAccount).toContainText("As of 4 Oct · Verified");
  await page.goto("/#/");
  // A reconciled closing sum does not turn inferred transaction coverage into
  // verified monthly coverage, or invent daily balances between purchases.
  await expect(page.locator(".month-summary")).toContainText(
    "Monthly history is not fully verified",
  );
  await assertSingleClosingPoint(page, "4 Oct", "£109.68");

  await page.setViewportSize({ width: 375, height: 844 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  const overlappingText = await page
    .locator(".position-metrics > a")
    .evaluateAll((columns) =>
      columns.flatMap((column) => {
        const bounds = column.getBoundingClientRect();
        const walker = document.createTreeWalker(column, NodeFilter.SHOW_TEXT);
        const overflow: string[] = [];
        while (walker.nextNode()) {
          if (!walker.currentNode.textContent?.trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(walker.currentNode);
          if (
            [...range.getClientRects()].some(
              (rect) =>
                rect.left < bounds.left - 2 || rect.right > bounds.right + 2,
            )
          )
            overflow.push(walker.currentNode.textContent);
        }
        return overflow;
      }),
    );
  expect(overlappingText).toEqual([]);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "";
  });
  await page.setViewportSize({ width: 390, height: 844 });

  await page.getByLabel("Selected month").fill("2026-09");
  await expect(positionMetric(page, "Card debt")).toContainText("Unknown");
  await expect(page.locator(".position-history circle")).toHaveCount(0);
  await expect(
    page.locator(".position-history title").filter({ hasText: "4 Oct 2026" }),
  ).toHaveCount(0);
  // £114.68 of purchases and a £5 refund leave £109.68 of card debt.
  // Statement debt must not replace gross spending in the month card.
  await expect(page.locator(".month-spending strong")).toHaveText("£114.68*");
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
    .getByRole("button", { name: /Barclaycard/ });
  await expect(accountChip).toContainText("£109.68 debt");
  await expect(accountChip).not.toContainText("−£109.68");
  await expect(accountChip).not.toContainText("Unverified");
});

test("Amex dates outside the period preserve reported debt while remaining unverified", async ({
  page,
}) => {
  await importStatement(page, "amex-uk-layout");
  await expect(page.getByLabel("Selected month")).toHaveValue("2026-10");
  await expect(positionMetric(page, "Card debt").locator("strong")).toHaveText(
    "Unknown",
  );
  await page.goto("/#/accounts");
  const cardAccount = page
    .locator(".account-overview-row")
    .filter({ hasText: "0444" });
  await expect(cardAccount).toContainText("As of 5 Oct · Unverified");
  await expect(cardAccount).toContainText("£160.00");
  await page.goto("/#/");
  await expect(page.locator(".month-summary")).toContainText(
    "Monthly history is not fully verified",
  );
  await expect(
    page.locator(".position-history circle[data-verified=true]"),
  ).toHaveCount(0);
  await expect(
    page.locator(".balance-trend-headline[data-verified=false]"),
  ).toContainText("£160.00Debt owedAs of 5 Oct 2026 · Reported, unverified");
  await page.reload();
  await expect(positionMetric(page, "Card debt").locator("strong")).toHaveText(
    "Unknown",
  );
  await page.goto("/#/transactions?month=2026-10&allDates=1");
  const accountChip = page
    .getByRole("group", { name: "Filter by account" })
    .getByRole("button", { name: /Amex/ });
  await expect(accountChip).toContainText("£160.00 debt");
  await expect(accountChip).not.toContainText("−£160.00");
  await expect(accountChip).toContainText("Reported · Unverified");
  await page.reload();
  await expect(accountChip).toContainText("£160.00 debt");
  await expect(accountChip).toContainText("Reported · Unverified");
  await page.goto("/#/settings");
  const downloaded = page.waitForEvent("download");
  await saveReadableBackup(page);
  const backupPath = await (await downloaded).path();
  const backup = JSON.parse(await readFile(backupPath!, "utf8"));
  expect(backup.statements).toHaveLength(1);
  expect(backup.statements[0]).toMatchObject({
    openingBalance: -120000,
    closingBalance: -16000,
    validationDifference: 0,
    validationStatus: "warning",
    validationOverride: true,
  });
  expect(
    backup.transactions.find(
      (transaction: { date: string }) => transaction.date === "2026-09-05",
    ),
  ).toMatchObject({ date: "2026-09-05", bookingDate: "2026-09-05" });
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
  await expect(positionMetric(page, "Net worth").locator("strong")).toHaveText(
    "£845.32",
  );

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
  await expect(positionMetric(page, "Net worth").locator("strong")).toHaveText(
    "Unavailable",
  );
  await page.goto("/#/accounts");
  const reportedCard = page
    .locator(".account-overview-row")
    .filter({ hasText: "4444" });
  await expect(reportedCard).toContainText("£109.68");
  await expect(reportedCard).toContainText("Unverified");
  await expect(reportedCard).toContainText("Stored transactions do not match");
  await page.goto("/#/");
  await page
    .getByRole("combobox", { name: "Balance to show", exact: true })
    .selectOption({ label: "Barclaycard · •••• 4444" });
  await expect(page.locator(".month-summary")).toContainText(
    "Monthly history is not fully verified",
  );
  await expect(
    page
      .locator(".position-history circle[data-verified=true] title")
      .filter({ hasText: "£109.68 debt owed" }),
  ).toHaveCount(0);
  await expect(
    page.locator(".balance-trend-headline[data-verified=false]"),
  ).toContainText("£109.68");
  await expect(page.locator(".balance-trend-headline")).toContainText(
    "Reported, unverified",
  );
  await expect(page.locator(".balance-trend-change")).toHaveCount(0);
  await expect(
    page.locator(".position-history [data-total-position][data-verified=true]"),
  ).toHaveCount(0);
  await page.goto("/#/transactions?month=2026-10&allDates=1");
  const accountChip = page
    .getByRole("group", { name: "Filter by account" })
    .getByRole("button", { name: /Barclaycard/ });
  await expect(accountChip).toContainText("£109.68 debt");
  await expect(accountChip).toContainText("Reported · Unverified");
});
