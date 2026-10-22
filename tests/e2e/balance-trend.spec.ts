import { test, expect, type Page } from "./fixtures";
import { balanceTrendFixture } from "../../src/tests/balance-trend";

test.use({ hasTouch: true });
async function seed(page: Page, source = balanceTrendFixture()) {
  await page.clock.setFixedTime(new Date("2026-10-08T12:00:00Z"));
  await page.evaluate(
    (data) =>
      new Promise<void>((done, reject) => {
        const request = indexedDB.open("feng-finance");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result,
            tx = db.transaction(
              ["accounts", "statements", "transactions"],
              "readwrite",
            );
          for (const name of [
            "accounts",
            "statements",
            "transactions",
          ] as const)
            for (const row of data[name]) tx.objectStore(name).put(row);
          tx.oncomplete = () => {
            db.close();
            done();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    source,
  );
  await page.reload();
  await page.getByLabel("Selected month").fill("2026-10");
  const card = page.getByRole("region", { name: "Balance trend", exact: true });
  await expect(card).toBeVisible();
  return card;
}
test("cash trend remains useful beside isolated card balances and supports direct date inspection", async ({
  page,
}) => {
  const card = await seed(page);
  await expect(card.getByLabel("Balance to show")).toHaveValue("cash");
  await expect(card.locator(".balance-trend-headline")).toContainText(
    "£1,335.00",
  );
  await expect(card.locator(".balance-trend-change")).toContainText(
    "£85.00 higher (+6.8%)",
  );
  await expect(card.locator(".balance-trend-change")).toContainText(
    "4 to 30 Sep 2026",
  );
  await expect(card.locator("pattern")).toHaveCount(0);
  await expect(card.locator(".position-history path")).toHaveCount(1);
  const inspector = card.getByRole("slider", {
    name: "Inspect balance history",
  });
  await inspector.focus();
  await inspector.press("Home");
  await expect(inspector).toHaveAttribute(
    "aria-valuetext",
    "4 Sep 2026: £1,250.00",
  );
  await inspector.press("End");
  await expect(card.locator(".balance-trend-readout")).toContainText(
    "4 Oct 2026No verified balance",
  );
  const bounds = await inspector.boundingBox();
  await page.touchscreen.tap(
    bounds!.x + bounds!.width * 0.5,
    bounds!.y + bounds!.height * 0.5,
  );
  await expect(card.locator(".balance-trend-readout")).not.toContainText(
    "No verified balance",
  );
  expect(
    await inspector.evaluate(
      (element) => getComputedStyle(element).touchAction,
    ),
  ).toBe("pan-y");
  await card.getByRole("button", { name: "3 months", exact: true }).click();
  await expect(
    card.getByRole("button", { name: "3 months", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(card.getByRole("img")).toHaveAttribute(
    "aria-label",
    /4 Jul 2026 to 4 Oct 2026/,
  );
  await card.getByLabel("Balance to show").selectOption("account:a4");
  await expect(card.locator(".balance-trend-headline")).toContainText(
    "£109.68Debt owedAs of 4 Oct 2026",
  );
  await expect(card.getByRole("img")).toHaveCount(0);
  await expect(card.getByRole("slider")).toHaveCount(0);
  await expect(card.getByText(/Earlier statements will show/)).toBeVisible();
  await card.getByLabel("Balance to show").selectOption("net");
  await expect(
    card.getByText(/Net worth needs verified balances/),
  ).toBeVisible();
  await expect(card.locator(".balance-trend-headline")).toHaveCount(0);
});

test("balance chart fits narrow screens, large text, both themes and desktop without losing readable values", async ({
  page,
}) => {
  const card = await seed(page);
  for (const theme of ["dark", "light"])
    for (const [width, fontSize] of [
      [320, "100%"],
      [390, "100%"],
      [430, "100%"],
      [320, "200%"],
      [1280, "100%"],
    ] as const) {
      await page.setViewportSize({ width, height: 844 });
      await page.evaluate(
        ({ theme, fontSize }) => {
          document.documentElement.dataset.theme = theme;
          document.documentElement.style.fontSize = fontSize;
        },
        { theme, fontSize },
      );
      await expect(card.locator(".balance-trend-headline")).toContainText(
        "£1,335.00",
      );
      // Responsive observers and Safari's resize event commit asynchronously.
      await expect
        .poll(
          () =>
            page.evaluate(
              () => document.documentElement.scrollWidth > innerWidth + 1,
            ),
          { message: `${theme}, ${width}px, ${fontSize}` },
        )
        .toBe(false);
      await expect
        .poll(
          () =>
            card.evaluate((element) => {
              const bounds = element.getBoundingClientRect();
              return [
                ...element.querySelectorAll(
                  "svg text, .financial-value, select",
                ),
              ]
                .filter((child) => {
                  const rect = child.getBoundingClientRect();
                  return (
                    rect.left < bounds.left - 1 || rect.right > bounds.right + 1
                  );
                })
                .map((child) => child.textContent);
            }),
          { message: `${theme}, ${width}px, ${fontSize}` },
        )
        .toEqual([]);
    }
});

test("a credit balance is shown as credit and an unverified statement never becomes a verified trend", async ({
  page,
}) => {
  const source = balanceTrendFixture();
  source.statements.find((s) => s.id === "card")!.closingBalance = 5000;
  source.transactions.find((t) => t.statementId === "card")!.amount = 5000;
  source.statements.find((s) => s.id === "amex")!.validationStatus = "warning";
  const card = await seed(page, source);
  await card.getByLabel("Balance to show").selectOption("account:a4");
  await expect(card.locator(".balance-trend-headline")).toContainText(
    "£50.00Credit balance",
  );
  await expect(card.locator(".balance-trend-change")).toHaveCount(0);
  await card.getByLabel("Balance to show").selectOption("account:a3");
  await expect(card.locator(".balance-trend-headline")).toHaveAttribute(
    "data-verified",
    "false",
  );
  await expect(card.locator(".balance-trend-headline")).toContainText(
    "Reported, unverified",
  );
  await expect(card.getByRole("img")).toHaveCount(0);
});
