import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function settings(page: Page) {
  await page.goto("/#/settings");
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();
}
async function demo(page: Page) {
  await settings(page);
  await page
    .getByRole("button", { name: "Load demo data", exact: true })
    .click();
  await expect(
    page.getByText("Fictitious demo data added.", { exact: true }),
  ).toBeVisible();
}
async function backup(page: Page) {
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export Feng Finance Backup", exact: true })
    .click();
  const download = await downloadPromise;
  const path = await download.path();
  if (!path) throw new Error("Backup download was unavailable.");
  return {
    contents: await readFile(path, "utf8"),
    filename: download.suggestedFilename(),
  };
}
async function transactionRecords(page: Page) {
  return page.evaluate(
    () =>
      new Promise<unknown[]>((resolve, reject) => {
        const request = indexedDB.open("feng-finance");
        request.onerror = () =>
          reject(new Error("Could not read the test database."));
        request.onupgradeneeded = () => request.transaction?.abort();
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction("transactions", "readonly");
          const records = transaction.objectStore("transactions").getAll();
          transaction.oncomplete = () => {
            database.close();
            resolve(records.result as unknown[]);
          };
          transaction.onabort = () => {
            database.close();
            reject(new Error("Could not read the stored transactions."));
          };
        };
      }),
  );
}

test("Settings backup metadata and restore preview explain replacement before committing", async ({
  page,
}) => {
  await demo(page);
  const file = await backup(page);
  const parsed = JSON.parse(file.contents) as {
    accounts: unknown[];
    transactions: unknown[];
    rules: { builtIn: boolean }[];
    settings: { key: string; value: string }[];
    exportedAt: string;
  };
  expect(parsed.transactions.length).toBeGreaterThan(0);
  expect(parsed.settings).toContainEqual({
    key: "backup:lastExportAt",
    value: parsed.exportedAt,
  });
  await expect(page.locator(".backup-status")).toContainText(
    `${parsed.transactions.length} transactions`,
  );
  await expect(
    page.getByText(
      "Backup prepared for download. Save it in Files or iCloud Drive.",
      { exact: true },
    ),
  ).toBeVisible();
  await page
    .getByLabel("Restore Feng Finance Backup", { exact: true })
    .setInputFiles({
      name: file.filename,
      mimeType: "application/json",
      buffer: Buffer.from(file.contents),
    });
  const preview = page.locator(".restore-warning");
  await expect(preview.getByLabel("Backup contents")).toContainText(
    `${parsed.accounts.length} accounts`,
  );
  await expect(preview).toContainText("Backup version 1");
  await expect(preview).toContainText("will be replaced");
  const replace = preview.getByRole("button", {
    name: "Replace data with backup",
    exact: true,
  });
  await expect(replace).toBeDisabled();
  await preview
    .getByRole("button", { name: "Cancel restore", exact: true })
    .click();
  await expect(preview).toHaveCount(0);
  await expect(page.locator(".backup-status")).toContainText(
    `${parsed.transactions.length} transactions`,
  );
});

test("Erasing every record requires ERASE and a downloaded backup can restore it", async ({
  page,
}) => {
  await demo(page);
  const file = await backup(page);
  const wipe = page.getByRole("button", {
    name: "Erase everything",
    exact: true,
  });
  const phrase = page.getByLabel("Type ERASE to confirm permanent deletion", {
    exact: true,
  });
  await expect(wipe).toBeDisabled();
  await phrase.fill("erase");
  await expect(wipe).toBeDisabled();
  await phrase.fill("ERASE");
  await expect(wipe).toBeEnabled();
  await wipe.click();
  await expect(
    page.getByText("All local financial data was cleared.", { exact: true }),
  ).toBeVisible();
  await expect(page.locator("#backup")).toContainText(
    "Save your 0 transactions",
  );
  await expect(phrase).toHaveValue("");
  await page
    .getByLabel("Restore Feng Finance Backup", { exact: true })
    .setInputFiles({
      name: file.filename,
      mimeType: "application/json",
      buffer: Buffer.from(file.contents),
    });
  const preview = page.locator(".restore-warning");
  await preview
    .getByLabel(
      "I understand that this replaces all existing data on this device.",
    )
    .check();
  await preview
    .getByRole("button", { name: "Replace data with backup", exact: true })
    .click();
  await expect(
    page.getByText("Backup restored successfully.", { exact: true }),
  ).toBeVisible();
  await expect(page.locator("#backup")).not.toContainText(
    "Save your 0 transactions",
  );
  await expect(page.locator(".backup-status")).toContainText(
    "Last backup export:",
  );
});

test("Personal rules show scope and can be edited or deleted without touching past payments", async ({
  page,
}) => {
  await demo(page);
  const before = await transactionRecords(page);
  expect(before.length).toBeGreaterThan(0);
  await page.locator("#rules > summary").click();
  const create = page.locator("#rules > .rule-editor");
  await create.locator("summary").click();
  await create
    .getByLabel("Text pattern", { exact: true })
    .fill("FICTIONAL UX STORE");
  await create.getByLabel("Match", { exact: true }).selectOption("exact");
  await create
    .getByLabel("Category", { exact: true })
    .selectOption("childcare");
  await create
    .getByRole("button", { name: "Create rule", exact: true })
    .click();
  const item = page
    .locator(".rule-item")
    .filter({ hasText: "FICTIONAL UX STORE" });
  await expect(item).toContainText("Childcare");
  await expect(item).toContainText("All accounts");
  await expect(item).toContainText("Exact merchant");
  await expect(item).toContainText("0 matching transactions");
  await item.getByRole("button", { name: /Edit rule/ }).click();
  const editor = item.locator(".rule-editor");
  await editor.getByLabel("Category", { exact: true }).selectOption("shopping");
  await editor.getByRole("button", { name: "Save rule", exact: true }).click();
  await expect(item).toContainText("Shopping");
  await expect(item.locator(".rule-editor")).toHaveCount(0);
  await item.getByRole("button", { name: /Delete rule/ }).click();
  await expect(item).toHaveCount(0);
  expect(await transactionRecords(page)).toEqual(before);
});
