import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

test("cancel keeps demo open, and switching ledgers in another tab clears a pending personal review", async ({
  page,
  context,
}) => {
  const pdf = resolve("tests/fixtures/barclays-planning-09.pdf");
  const publicRateRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).hostname === "data-api.ecb.europa.eu")
      publicRateRequests.push(request.url());
  });
  await page.goto("/#/");
  await page.getByRole("button", { name: "Explore with demo data" }).click();
  const demoChip = page.locator(".ui-demo-chip").filter({ visible: true });
  await expect(demoChip).toBeVisible();

  const picker = page.waitForEvent("filechooser");
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "Import", exact: true })
    .click();
  await (await picker).setFiles([]);
  await expect(demoChip).toBeVisible();
  await expect(page.locator(".position-summary")).toContainText("8 accounts");

  await page.goto("/#/import");
  await page
    .getByLabel("Select statements", { exact: true })
    .setInputFiles(pdf);
  const confirm = page.getByRole("button", {
    name: "Confirm import",
    exact: true,
  });
  await expect(confirm).toBeEnabled();
  expect(publicRateRequests).toEqual([]);
  await expect(demoChip).toHaveCount(0);
  await page.goto("/#/settings?section=demo");
  await expect(
    page.getByRole("button", { name: "Open demo data" }),
  ).toBeDisabled();

  const secondTab = await context.newPage();
  await secondTab.goto("/#/settings?section=demo");
  await secondTab.getByRole("button", { name: "Open demo data" }).click();
  await expect(demoChip).toBeVisible();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Demo data was opened in another tab" }),
  ).toBeVisible();
  await page.goto("/#/import");
  await expect(confirm).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Import statements" }),
  ).toBeVisible();

  // A desktop file drop uses the same personal-ledger handoff as either picker.
  const bytes = Array.from(await readFile(pdf));
  const files = await page.evaluateHandle((bytes) => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File([new Uint8Array(bytes)], "september.pdf", {
        type: "application/pdf",
      }),
    );
    return transfer;
  }, bytes);
  await page
    .locator(".import-workspace")
    .dispatchEvent("drop", { dataTransfer: files });
  await files.dispose();
  await expect(confirm).toBeEnabled();
  await expect(demoChip).toHaveCount(0);
  await confirm.click();
  await expect(page.locator(".position-summary")).toContainText("1 account");

  await secondTab.getByRole("button", { name: "Open demo data" }).click();
  await expect(page.locator(".position-summary")).toContainText("8 accounts");
  await secondTab
    .getByRole("button", { name: "Return to personal finances" })
    .click();
  await expect(page.locator(".position-summary")).toContainText("1 account");
  await expect(page.locator(".position-summary")).toContainText("£9,636.00");
});
