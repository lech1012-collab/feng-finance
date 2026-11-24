import { resolve } from "node:path";
import { test, expect, type Page } from "@playwright/test";
import type { Backup } from "../../src/domain/models";
import { encryptBackup } from "../../src/security/backup-encryption";
import { accounts, transaction } from "../../src/tests/helpers";
import { acknowledgeBeta } from "./fixtures";

const backup: Backup = {
  format: "feng-finance",
  version: 1,
  schemaVersion: 4,
  moneyUnit: "minor",
  exportedAt: "2026-10-03T12:00:00Z",
  accounts: [accounts[0]],
  transactions: [
    transaction({
      source: "manual",
      statementId: "",
      merchant: "Synthetic recovery entry",
    }),
  ],
  statements: [],
  categories: [],
  rules: [],
  transferLinks: [],
  settings: [],
};
const uploaded = (value: unknown, name = "synthetic-backup.json") => ({
  name,
  mimeType: "application/json",
  buffer: Buffer.from(JSON.stringify(value)),
});
async function confirmRestore(page: Page) {
  const sheet = page.getByRole("dialog", {
    name: "Restore backup",
    exact: true,
  });
  const replace = sheet.getByRole("button", {
    name: "Replace data with backup",
  });
  await expect(replace).toBeDisabled();
  await sheet
    .getByRole("checkbox", {
      name: "Replace the existing data in my personal workspace.",
    })
    .check();
  await replace.click();
  await expect(
    page.getByRole("heading", { name: "Home", exact: true }),
  ).toBeVisible();
}

test("a fresh backup link allows cancellation and Welcome restores an encrypted legacy personal backup", async ({
  page,
}) => {
  for (const url of ["/#/settings?section=backup", "/#/settings#backup"]) {
    await page.goto(url);
    await expect(
      page.getByRole("heading", { name: "Restore your backup" }),
    ).toBeVisible();
    await expect(
      page.getByRole("dialog", { name: "Welcome to Feng" }),
    ).toHaveCount(0);
  }
  const restore = page.getByRole("button", { name: "Restore a backup" });
  const choose = async () => {
    const event = page.waitForEvent("filechooser");
    await restore.click();
    const picker = await event;
    expect(await picker.element().getAttribute("accept")).toContain(".feng");
    return picker;
  };
  await (await choose()).setFiles([]);
  await expect(restore).toBeEnabled();
  const protectedBackup = await encryptBackup(
    backup,
    "synthetic recovery passphrase",
  );
  await (
    await choose()
  ).setFiles(uploaded(protectedBackup, "synthetic-backup.feng"));
  const unlock = page.getByRole("dialog", { name: "Unlock backup" });
  const password = unlock.getByLabel("Backup password", { exact: true });
  await password.fill("incorrect demonstration password");
  await unlock.getByRole("button", { name: "Unlock and preview" }).click();
  await expect(unlock.getByRole("alert")).toContainText("No data has changed");
  await password.fill("synthetic recovery passphrase");
  await unlock.getByRole("button", { name: "Unlock and preview" }).click();
  const preview = page.getByRole("dialog", {
    name: "Restore backup",
    exact: true,
  });
  await expect(
    preview.getByRole("heading", { name: "Restore your personal workspace?" }),
  ).toBeVisible();
  await preview.getByRole("button", { name: "Cancel restore" }).click();
  await page.getByRole("link", { name: "Back to Welcome" }).click();
  await expect(
    page.getByRole("dialog", { name: "Welcome to Feng" }),
  ).toBeVisible();
  await (await choose()).setFiles(
    uploaded(protectedBackup, "synthetic-backup.feng"),
  );
  await password.fill("synthetic recovery passphrase");
  await unlock.getByRole("button", { name: "Unlock and preview" }).click();
  await confirmRestore(page);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Home", exact: true }),
  ).toBeVisible();
  await page.goto("/#/transactions?allDates=1");
  await expect(page.locator(".transaction-list .transaction-row")).toHaveCount(
    1,
  );
  await expect(page.locator(".transaction-list")).toContainText(
    "Synthetic recovery entry",
    { ignoreCase: true },
  );
});

test("cancelling restore keeps an import; successful restore and erasure release the old review", async ({
  page,
}) => {
  const pdf = resolve("tests/fixtures/barclays-planning-09.pdf");
  await page.goto("/");
  await acknowledgeBeta(page);
  const start = async () => {
    await page.getByLabel("Quick import statements").setInputFiles(pdf);
    await expect(
      page.getByRole("button", { name: "Confirm import", exact: true }),
    ).toBeEnabled();
  };
  await start();
  await page.goto("/#/settings?section=backup");
  const pick = () =>
    page.getByLabel("Choose Feng backup").setInputFiles(uploaded(backup));
  await pick();
  await page.getByRole("button", { name: "Cancel restore" }).click();
  await page.goto("/#/import");
  await expect(
    page.getByRole("button", { name: "Confirm import", exact: true }),
  ).toBeEnabled();
  await page.goto("/#/settings?section=backup");
  await pick();
  await confirmRestore(page);

  const priorBatch = page.getByRole("button", { name: /Resume import/ });
  const hint = page.getByRole("region", { name: "Reselect your statements" });
  await expect(priorBatch).toHaveCount(0);
  await page.goto("/#/import");
  await expect(
    page.getByRole("button", { name: "Confirm import", exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await expect(hint).toHaveCount(0);
  await start();
  await page.goto("/#/settings?section=danger");
  await page
    .getByLabel("Type ERASE to confirm permanent deletion")
    .fill("ERASE");
  await page
    .getByRole("button", { name: "Erase everything", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Welcome to Feng" }),
  ).toBeVisible();
  await page.goto("/");
  await acknowledgeBeta(page);
  await page.goto("/#/import");
  await expect(
    page.getByRole("button", { name: "Confirm import", exact: true }),
  ).toHaveCount(0);
  await expect(hint).toHaveCount(0);
});
