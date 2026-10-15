import { test, expect, type Page } from "./fixtures";
import { loadDemoUi } from "./flows";

async function stored(page: Page) {
  return page.evaluate(
    () =>
      new Promise<{
        transactions: unknown[];
        series: unknown[];
        decisions: unknown[];
      }>((resolve, reject) => {
        const open = indexedDB.open("feng-finance");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(
            ["transactions", "recurringSeries", "settings"],
            "readonly",
          );
          const rows = tx.objectStore("transactions").getAll();
          const series = tx.objectStore("recurringSeries").getAll();
          const settings = tx.objectStore("settings").getAll();
          tx.oncomplete = () => {
            db.close();
            resolve({
              transactions: rows.result,
              series: series.result,
              decisions: settings.result.filter((s: { key: string }) =>
                s.key.startsWith("recurring:match:"),
              ),
            });
          };
          tx.onerror = () => {
            db.close();
            reject(tx.error);
          };
        };
      }),
  );
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-14T12:00:00Z"));
  await loadDemoUi(page);
  await page.goto("/#/planning?tab=calendar");
});

test("same-bill confirmation is reversible, persists locally and leaves the ledger intact", async ({
  page,
}) => {
  const before = await stored(page);
  const review = page.getByRole("button", {
    name: "Review possible match",
    exact: true,
  });
  await review.click();
  const sheet = page.getByRole("dialog", {
    name: "Is this the same as Netflix?",
    exact: true,
  });
  await expect(
    sheet.getByRole("region", { name: "Saved payment", exact: true }),
  ).toBeVisible();
  await expect(
    sheet.getByRole("region", { name: "Detected payment", exact: true }),
  ).toBeVisible();
  await sheet.getByRole("button", { name: "Same bill", exact: true }).click();
  await expect(review).toHaveCount(0);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(review).toBeVisible();
  expect(await stored(page)).toEqual(before);
  await review.click();
  await sheet.getByRole("button", { name: "Same bill", exact: true }).click();
  await expect.poll(async () => (await stored(page)).decisions.length).toBe(1);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Planning", exact: true }),
  ).toBeVisible();
  await expect(review).toHaveCount(0);
  const after = await stored(page);
  expect(after.transactions).toEqual(before.transactions);
  expect(after.series).toEqual(before.series);
  expect(after.decisions).toHaveLength(1);
});

test("keeping similar bills separate creates a distinct series and one Undo removes it", async ({
  page,
}) => {
  const before = await stored(page);
  const review = page.getByRole("button", {
    name: "Review possible match",
    exact: true,
  });
  await review.click();
  await page
    .getByRole("dialog", { name: "Is this the same as Netflix?", exact: true })
    .getByRole("button", { name: "Keep separate", exact: true })
    .click();
  await expect
    .poll(async () => (await stored(page)).series.length)
    .toBe(before.series.length + 1);
  const after = await stored(page);
  expect(after.transactions).toEqual(before.transactions);
  expect(after.decisions).toHaveLength(1);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(review).toBeVisible();
  expect(await stored(page)).toEqual(before);
});
