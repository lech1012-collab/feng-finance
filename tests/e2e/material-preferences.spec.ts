import { expect, test, type Locator } from "./fixtures";

test.use({ serviceWorkers: "block" });

/** Sample the computed CSS color so rgb(), color(srgb …), and system colors
 * all use the same alpha scale across browser engines. */
async function expectOpaqueSurface(
  element: Locator,
  pseudo: string | null = null,
) {
  await expect(element).toBeVisible();
  const surface = await element.evaluate((node, pseudo) => {
    const style = getComputedStyle(node, pseudo);
    const canvas = document.createElement("canvas").getContext("2d")!;
    canvas.fillStyle = style.backgroundColor;
    canvas.fillRect(0, 0, 1, 1);
    return {
      alpha: canvas.getImageData(0, 0, 1, 1).data[3],
      blur:
        style.getPropertyValue("backdrop-filter") ||
        style.getPropertyValue("-webkit-backdrop-filter") ||
        "none",
    };
  }, pseudo);
  expect(surface).toEqual({ alpha: 255, blur: "none" });
}

test("an open help sheet follows the system appearance while it is in use", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/#/analysis");
  const trigger = page.getByRole("button", {
    name: "Analysis coverage explained",
  });
  await trigger.click();
  const sheet = page.getByRole("dialog", {
    name: "Analysis coverage explained",
  });
  await expect(sheet).toBeVisible();
  const heading = sheet.getByRole("heading", {
    name: "Analysis coverage explained",
  });
  const light = await heading.evaluate((node) => getComputedStyle(node).color);
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(heading).not.toHaveCSS("color", light);
  await page.emulateMedia({ colorScheme: "light" });
  await expect(heading).toHaveCSS("color", light);
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
});

for (const preference of [
  "reduced transparency",
  "increased contrast",
  "forced colors",
] as const) {
  test(`${preference} keeps navigation and help sheets opaque`, async ({
    page,
    browserName,
    context,
  }) => {
    if (preference === "reduced transparency") {
      // Playwright exposes this media preference through Chromium's CDP API.
      test.skip(
        browserName !== "chromium",
        "This emulation requires Chromium.",
      );
      const session = await context.newCDPSession(page);
      await session.send("Emulation.setEmulatedMedia", {
        features: [{ name: "prefers-reduced-transparency", value: "reduce" }],
      });
      expect(
        await page.evaluate(
          () => matchMedia("(prefers-reduced-transparency: reduce)").matches,
        ),
      ).toBe(true);
    } else if (preference === "increased contrast") {
      await page.emulateMedia({ contrast: "more" });
      expect(
        await page.evaluate(
          () => matchMedia("(prefers-contrast: more)").matches,
        ),
      ).toBe(true);
    } else {
      await page.emulateMedia({ forcedColors: "active" });
      test.skip(
        !(await page.evaluate(
          () => matchMedia("(forced-colors: active)").matches,
        )),
        "This browser does not emulate forced colors.",
      );
    }

    await page.goto("/#/analysis");
    await expectOpaqueSurface(page.locator(".mobile-header"));
    await expectOpaqueSurface(page.locator(".mobile-navigation"), "::before");
    const trigger = page.getByRole("button", {
      name: "Analysis coverage explained",
    });
    await trigger.click();
    const sheet = page.getByRole("dialog", {
      name: "Analysis coverage explained",
    });
    await expectOpaqueSurface(sheet);
    await sheet
      .getByRole("button", { name: "Close Analysis coverage explained" })
      .click();
    await expect(trigger).toBeFocused();
    await page.setViewportSize({ width: 1024, height: 768 });
    await expectOpaqueSurface(page.locator(".sidebar"));
  });
}
