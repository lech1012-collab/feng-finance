import { resolve } from "node:path";
import { expect, test } from "./fixtures";

test("a reloaded import identifies its source files and lets the owner restart or dismiss the review", async ({
  page,
}) => {
  const pdf = resolve("tests/fixtures/barclays-planning-09.pdf");
  const quickPicker = page.getByLabel("Quick import statements");
  await quickPicker.setInputFiles(pdf);
  const confirm = page.getByRole("button", {
    name: "Confirm import",
    exact: true,
  });
  await expect(confirm).toBeEnabled();

  await page.reload();
  const recovery = page.getByRole("region", {
    name: "Reselect your statements",
  });
  await expect(recovery).toContainText("barclays-planning-09.pdf");
  const choose = page.waitForEvent("filechooser");
  await recovery.getByRole("button", { name: "Choose files again" }).click();
  await (await choose).setFiles(pdf);
  await expect(confirm).toBeEnabled();
  await expect(recovery).toHaveCount(0);

  await page.reload();
  await recovery.getByRole("button", { name: "Dismiss" }).click();
  await page.reload();
  await expect(recovery).toHaveCount(0);
  await quickPicker.setInputFiles(pdf);
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(page.locator(".position-summary")).toBeVisible();
  await page.reload();
  await expect(page.locator(".position-summary")).toBeVisible();
  await expect(recovery).toHaveCount(0);
});
