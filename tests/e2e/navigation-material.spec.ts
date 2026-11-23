import { expect, test, type Locator } from "./fixtures";
import { loadDemoUi } from "./flows";

async function expectNavigationTargets(navigation: Locator, names: string[]) {
  const links = navigation.getByRole("link");
  await expect(links).toHaveCount(names.length);
  for (const name of names)
    await expect(
      navigation.getByRole("link", { name, exact: true }),
    ).toBeVisible();

  const issues = await links.evaluateAll((links) => {
    const problems: string[] = [];
    const boxes = links.map((link) => link.getBoundingClientRect());
    links.forEach((link, index) => {
      const box = boxes[index];
      const name = link.textContent?.trim();
      if (box.width < 44 || box.height < 44)
        problems.push(`${name} is smaller than a touch target`);
      const hit = document.elementFromPoint(
        box.x + box.width / 2,
        box.y + box.height / 2,
      );
      if (!link.contains(hit)) problems.push(`${name} is covered`);
      if (
        boxes
          .slice(0, index)
          .some(
            (other) =>
              other.right > box.left + 1 &&
              other.left < box.right - 1 &&
              other.bottom > box.top + 1 &&
              other.top < box.bottom - 1,
          )
      )
        problems.push(`${name} overlaps another target`);

      // Every visible link title must fit inside its own hit target.
      const range = document.createRange();
      const walker = document.createTreeWalker(link, NodeFilter.SHOW_TEXT);
      let labelVisible = false;
      while (walker.nextNode()) {
        range.selectNodeContents(walker.currentNode);
        for (const rect of range.getClientRects()) {
          if (rect.width && rect.height) labelVisible = true;
          if (
            rect.width &&
            (rect.left < box.left - 1 ||
              rect.right > box.right + 1 ||
              rect.top < box.top - 1 ||
              rect.bottom > box.bottom + 1)
          ) {
            problems.push(`${name} has a label outside its target`);
          }
        }
      }
      if (!labelVisible) problems.push(`${name} has no visible label`);
    });
    return problems;
  });
  expect(issues).toEqual([]);
}

const phoneLabels = ["Import", "Activity", "Home", "Analyse", "Planning"];
for (const layout of [
  {
    name: "320px phone with 200% text",
    width: 320,
    fontSize: "200%",
    labels: phoneLabels,
    next: "Analyse",
  },
  {
    name: "390px phone with 200% text",
    width: 390,
    fontSize: "200%",
    labels: phoneLabels,
    next: "Analyse",
  },
  {
    name: "390px phone",
    width: 390,
    fontSize: "100%",
    labels: phoneLabels,
    next: "Analyse",
  },
  {
    name: "desktop",
    width: 1280,
    fontSize: "100%",
    labels: ["Home", "Transactions", "Analyse", "Planning", "Settings"],
    next: "Transactions",
  },
]) {
  test(`navigation and final settings action stay reachable on ${layout.name}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: layout.width, height: 844 });
    await page.goto("/#/settings");
    const sections = page.getByRole("navigation", {
      name: "Settings sections",
    });
    const lastAction = sections.getByRole("link").last();
    await expect(lastAction).toBeVisible();
    await page.evaluate((size) => {
      document.documentElement.style.fontSize = size;
      window.scrollTo({
        top: document.documentElement.scrollHeight,
        behavior: "instant",
      });
    }, layout.fontSize);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth + 1,
        ),
      )
      .toBe(true);
    await expect
      .poll(() =>
        lastAction.evaluate((link) => {
          const box = link.getBoundingClientRect();
          const hit = document.elementFromPoint(
            box.x + box.width / 2,
            box.bottom - 1,
          );
          return link.contains(hit);
        }),
      )
      .toBe(true);

    const navigation = page.getByRole("navigation", {
      name: "Main navigation",
    });
    await expectNavigationTargets(navigation, layout.labels);
    await navigation.getByRole("link", { name: "Home", exact: true }).focus();
    await page.keyboard.press("Tab");
    const next = navigation.getByRole("link", {
      name: layout.next,
      exact: true,
    });
    await expect(next).toBeFocused();
    expect(
      await next.evaluate((link) => {
        const style = getComputedStyle(link);
        return (
          link.matches(":focus-visible") &&
          style.outlineStyle !== "none" &&
          parseFloat(style.outlineWidth) > 0
        );
      }),
    ).toBe(true);
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("heading", { name: layout.next, exact: true, level: 1 }),
    ).toBeVisible();
    await expect(next).toHaveAttribute("aria-current", "page");
    const destination = page.getByRole("main", {
      name: layout.next,
      exact: true,
    });
    await expect(destination).toBeFocused();
    await page.keyboard.press("Tab");
    expect(
      await destination.evaluate((main) =>
        main.contains(document.activeElement),
      ),
    ).toBe(true);
  });
}

test("Activity keeps all five category filters reachable without widening the phone", async ({
  page,
}) => {
  await loadDemoUi(page);
  await page.goto("/#/transactions?allDates=1");
  const filters = page.getByRole("group", {
    name: "Transaction category filters",
  });
  await expect(filters.getByRole("button")).toHaveCount(5);
  const salary = filters.getByRole("button", { name: "Salary", exact: true });

  for (const [width, textScale] of [
    [390, 100],
    [320, 200],
  ]) {
    await page.setViewportSize({ width, height: 844 });
    await page.evaluate((scale) => {
      document.documentElement.style.fontSize = scale + "%";
    }, textScale);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBe(width);
    await salary.scrollIntoViewIfNeeded();
    await expect(salary).toBeInViewport();
    expect(await page.evaluate(() => window.scrollX)).toBe(0);
  }
  await salary.click();
  await expect(salary).toHaveAttribute("aria-pressed", "true");
});
