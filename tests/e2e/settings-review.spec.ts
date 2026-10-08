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

async function localRecords(page: Page) {
  return page.evaluate(
    () =>
      new Promise<Record<string, unknown[]>>((resolve, reject) => {
        const request = indexedDB.open("feng-finance");
        request.onerror = () => reject(new Error("Could not read test data."));
        request.onupgradeneeded = () => request.transaction?.abort();
        request.onsuccess = () => {
          const database = request.result;
          const names = Array.from(database.objectStoreNames);
          const transaction = database.transaction(names, "readonly");
          const records: Record<string, unknown[]> = {};
          for (const name of names) {
            const read = transaction.objectStore(name).getAll();
            read.onsuccess = () => {
              records[name] = read.result as unknown[];
            };
          }
          transaction.oncomplete = () => {
            database.close();
            resolve(records);
          };
          transaction.onabort = () => {
            database.close();
            reject(new Error("Could not read test data."));
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
    statements: unknown[];
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
  const recordsBeforePreview = await localRecords(page);
  await page
    .getByLabel("Restore Feng Finance Backup", { exact: true })
    .setInputFiles({
      name: file.filename,
      mimeType: "application/json",
      buffer: Buffer.from(file.contents),
    });
  const preview = page.locator(".restore-warning");
  const counts = preview.getByLabel("Backup contents");
  for (const { count, label } of [
    { count: parsed.accounts.length, label: "account" },
    { count: parsed.transactions.length, label: "transaction" },
    { count: parsed.statements.length, label: "statement" },
    {
      count: parsed.rules.filter((rule) => !rule.builtIn).length,
      label: "personal rule",
    },
  ]) {
    const term = counts.getByRole("term").filter({
      hasText: new RegExp(`^${count === 1 ? label : `${label}s`}$`),
    });
    await expect(term).toBeVisible();
    await expect(term.locator("..").locator("dd")).toHaveText(String(count));
  }
  // Count/label pairs stay separate on narrow screens and with enlarged text.
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    for (const size of ["100%", "200%"]) {
      await page.evaluate((fontSize) => {
        document.documentElement.style.fontSize = fontSize;
      }, size);
      const geometry = await counts
        .locator(".restore-count")
        .evaluateAll((cells) =>
          cells.map((cell) => {
            const rect = cell.getBoundingClientRect();
            const children = Array.from(cell.querySelectorAll("dt, dd")).map(
              (child) => {
                const range = document.createRange();
                range.selectNodeContents(child);
                return Array.from(range.getClientRects()).map((part) => ({
                  left: part.left,
                  right: part.right,
                  top: part.top,
                  bottom: part.bottom,
                }));
              },
            );
            return {
              left: rect.left,
              right: rect.right,
              top: rect.top,
              bottom: rect.bottom,
              children,
            };
          }),
        );
      expect(geometry).toHaveLength(4);
      for (const cell of geometry) {
        for (const text of cell.children.flat()) {
          expect(text.left).toBeGreaterThanOrEqual(cell.left - 1);
          expect(text.right).toBeLessThanOrEqual(cell.right + 1);
        }
        for (const other of geometry.filter((item) => item !== cell)) {
          const overlap =
            cell.left < other.right - 1 &&
            cell.right > other.left + 1 &&
            cell.top < other.bottom - 1 &&
            cell.bottom > other.top + 1;
          expect(overlap).toBe(false);
        }
      }
    }
  }
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "";
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await localRecords(page)).toEqual(recordsBeforePreview);
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

test("Malformed, incompatible and inconsistent backups show safe recovery messages without changing records", async ({
  page,
}) => {
  await demo(page);
  const file = await backup(page);
  const parsed = JSON.parse(file.contents) as Record<string, unknown>;
  const before = await localRecords(page);
  for (const invalid of [
    {
      contents: '{ "PRIVATE MERCHANT":',
      message: "This file is not valid JSON.",
    },
    {
      contents: JSON.stringify({
        format: "other-product",
        description: "PRIVATE MERCHANT",
      }),
      message: "This is not a supported Feng Finance backup.",
    },
    {
      contents: JSON.stringify({ ...parsed, version: 999 }),
      message: "This backup version is not supported by this app.",
    },
    {
      contents: JSON.stringify({ ...parsed, moneyUnit: "major" }),
      message: "This backup uses an unsupported amount format.",
    },
    {
      contents: JSON.stringify({ ...parsed, accounts: [] }),
      message: "This backup contains inconsistent or missing financial records",
    },
  ]) {
    await page
      .getByLabel("Restore Feng Finance Backup", { exact: true })
      .setInputFiles({
        name: "synthetic-invalid-backup.json",
        mimeType: "application/json",
        buffer: Buffer.from(invalid.contents),
      });
    const error = page.getByRole("alert");
    await expect(error).toContainText(invalid.message);
    await expect(error).toContainText(
      "Your existing data has not been changed.",
    );
    await expect(error).not.toContainText("PRIVATE MERCHANT");
    await expect(error).not.toContainText("invalid_value");
    expect((await error.innerText()).length).toBeLessThan(300);
    await expect(page.locator(".restore-warning")).toHaveCount(0);
    expect(await localRecords(page)).toEqual(before);
  }
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
