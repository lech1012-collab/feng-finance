import { readFile } from "node:fs/promises";
import type { Download } from "@playwright/test";
import type { Backup } from "../../src/domain/models";
import { expect, type Page } from "./fixtures";

/** Actual UI steps for the grouped Settings and the unified backup wizard. */
export async function settingsSection(page: Page, section: string) {
  const origin = new URL(page.url()).origin;
  await page.goto(`${origin}/#/settings?section=${section}`);
  // A pending import is retained in a hidden, inert workspace. Wait for the
  // active page's accessible heading, not every h1 still present in the DOM.
  const heading = page.getByRole("main").getByRole("heading", { level: 1 });
  await expect(heading).toHaveCount(1);
  await expect(heading).toBeVisible();
}

export async function saveReadableBackup(page: Page) {
  await settingsSection(page, "backup");
  await page.getByRole("button", { name: "Save backup", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Save backup", exact: true });
  await sheet
    .getByRole("switch", { name: /Protect with a password/ })
    .uncheck();
  await sheet.getByRole("button", { name: "Save backup", exact: true }).click();
  await expect(sheet).toHaveCount(0);
}

export async function loadDemoUi(page: Page) {
  await settingsSection(page, "currency");
  await page
    .getByRole("switch", { name: "Download daily rates (ECB)" })
    .uncheck();
  await settingsSection(page, "demo");
  await page
    .getByRole("button", { name: "Open demo data", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Demo data opened." }),
  ).toBeVisible();
}

export async function selectPeriod(page: Page, period: string) {
  const labels: Record<string, string> = {
    "1": "1 month",
    "3": "3 months",
    "6": "6 months",
    "12": "12 months",
  };
  if (period === "ytd") {
    await page
      .getByRole("group", { name: "Time range", exact: true })
      .getByRole("button", { name: "Year to date", exact: true })
      .click();
  } else if (labels[period]) {
    await page
      .getByRole("group", { name: "Time range", exact: true })
      .getByRole("button", { name: labels[period], exact: true })
      .click();
  } else {
    const details = page.locator("details.other-periods");
    if (
      !(await details.evaluate(
        (element) => (element as HTMLDetailsElement).open,
      ))
    )
      await details.getByText("Other periods", { exact: true }).click();
    await details
      .getByRole("combobox", { name: "Period", exact: true })
      .selectOption(period);
  }
}

export async function readBackupDownload(file: Download, datedName: string) {
  // WebKit on some platforms replaces spaces in suggested download names.
  expect([datedName, datedName.replace("Feng ", "Feng_")]).toContain(
    file.suggestedFilename(),
  );
  const path = await file.path();
  if (!path) throw new Error("The backup was not saved.");
  const backup = JSON.parse(await readFile(path, "utf8")) as Backup;
  expect(backup).toMatchObject({ format: "feng-finance", version: 1 });
  return backup;
}
