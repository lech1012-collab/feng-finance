import { expect, type Page, type Locator } from "./fixtures";

/** Deliberate UI decisions only. These helpers never alter imported state directly. */
export async function showTransferChoices(page: Page) {
  const disclosure = page.locator("details.import-transfer-review");
  await expect(disclosure).toBeVisible();
  if (!(await disclosure.evaluate((node) => (node as HTMLDetailsElement).open)))
    await disclosure.locator(":scope > summary").click();
  return disclosure.getByRole("region", {
    name: "Confirm internal transfers",
    exact: true,
  });
}

export async function acceptUnverifiedStatement(
  page: Page,
  statement?: Locator,
) {
  const source = statement ?? page.locator(".import-statement-card[open]");
  await source
    .getByRole("button", { name: "Import anyway…", exact: true })
    .click();
  const sheet = page.getByRole("dialog", {
    name: "Import an unverified statement?",
    exact: true,
  });
  const accept = sheet.getByRole("button", {
    name: "Accept unverified statement",
    exact: true,
  });
  await expect(accept).toBeDisabled();
  await sheet
    .getByRole("checkbox", {
      name: "I checked the original statement and accept importing these unverified figures.",
      exact: true,
    })
    .check();
  await accept.click();
  await expect(sheet).toHaveCount(0);
  await expect(
    source.getByRole("button", {
      name: "Undo unverified acceptance",
      exact: true,
    }),
  ).toBeVisible();
}

export async function acceptStatementWarnings(statement: Locator) {
  await statement
    .getByRole("button", {
      name: "Accept these statement warnings",
      exact: true,
    })
    .click();
  await expect(
    statement.getByRole("button", {
      name: "Undo warning acceptance",
      exact: true,
    }),
  ).toBeVisible();
}
