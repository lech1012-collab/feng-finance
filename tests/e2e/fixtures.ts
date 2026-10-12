import { test as base, expect, devices, type Page } from "@playwright/test";

export { expect, devices };
export type { Page, Locator } from "@playwright/test";

/**
 * Existing finance workflows start after the real first-launch acknowledgement.
 * New profiles and private offline origins must call this after their first goto.
 * No production flags or direct preference writes bypass the beta introduction.
 */
export async function acknowledgeBeta(page: Page) {
  const notice = page.getByRole("dialog", { name: "Welcome to Feng" });
  await expect
    .poll(
      async () =>
        (await notice.isVisible()) ||
        (await page
          .locator(".feng-private-content main h1")
          .first()
          .isVisible()),
    )
    .toBe(true);
  if (!(await notice.isVisible())) return;
  const picker = page.waitForEvent("filechooser");
  await notice.getByRole("button", { name: "Import my statements" }).click();
  // The acknowledgement opens the native picker in the same user gesture.
  // Cancel it for workflows that select their own fixture later.
  await (await picker).setFiles([]);
  await expect(notice).toHaveCount(0);
  await expect(
    page.locator(".feng-private-content main h1").first(),
  ).toBeVisible();
}

export const test = base.extend({
  page: async ({ page, baseURL, serviceWorkers }, use) => {
    await page.goto(`${baseURL ?? "http://127.0.0.1:4173"}/#/`);
    await acknowledgeBeta(page);
    // Finish initial caching before a workflow observes network traffic or
    // switches to a private origin; those assertions should cover that origin.
    if (serviceWorkers !== "block")
      await page.evaluate(async () => {
        if ("serviceWorker" in navigator) await navigator.serviceWorker.ready;
      });
    await use(page);
  },
});
