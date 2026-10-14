import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Fresh, isolated browser contexts use fictitious demo records only.
// Run against an already-built preview; never point this at a personal profile.
const base = new URL(process.env.FENG_AUDIT_URL || "http://127.0.0.1:4173/");
const output = resolve(
  process.env.FENG_AUDIT_OUTPUT || "test-results-accessibility",
);
const setups = [
  ["mobile-dark", 390, "dark", "100%"],
  ["mobile-light", 390, "light", "100%"],
  ["small-dark", 320, "dark", "100%"],
  ["small-light", 320, "light", "100%"],
  ["large-text-dark", 390, "dark", "200%"],
  ["large-text-light", 390, "light", "200%"],
  ["desktop-dark", 1280, "dark", "100%"],
];
const routes = [
  ["home", "/"],
  ["transactions", "/transactions?allDates=1"],
  ["analyse", "/analysis"],
  ["category", "/categories/groceries"],
  ["reports", "/analysis?view=reports"],
  ["trips", "/analysis?view=trips"],
  ["subscriptions", "/subscriptions"],
  ["budgets", "/planning?tab=budgets"],
  ["pots", "/planning?tab=pots"],
  ["calendar", "/planning?tab=calendar"],
  ["debt", "/planning?tab=debt"],
  ["forecast", "/planning?tab=forecast"],
  ["monthly-review", "/review?month=2026-09"],
  ["accounts", "/accounts"],
  ["settings", "/settings"],
  ["currency", "/settings?section=currency"],
  ["security", "/settings?section=security"],
  ["backup", "/settings?section=backup"],
  ["danger", "/settings?section=danger"],
  ["about", "/settings?section=about"],
  ["categories", "/settings?section=categories"],
  ["rules", "/settings?section=rules"],
  ["import", "/import"],
];
const routeUrl = (path) => {
  const url = new URL(base);
  url.hash = path;
  return url.href;
};
const results = [];
const browser = await chromium.launch();
try {
  for (const [setup, width, theme, size] of setups) {
    const context = await browser.newContext({
      viewport: { width, height: 844 },
    });
    try {
      const page = await context.newPage();
      await page.clock.setFixedTime(new Date("2026-10-14T12:00:00Z"));
      await page.goto(routeUrl("/"));
      await page
        .getByRole("button", { name: "Explore with demo data", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "Home", exact: true }),
      ).toBeVisible();
      await page.goto(routeUrl("/settings?section=currency"));
      await page
        .getByRole("switch", {
          name: "Download daily rates (ECB)",
          exact: true,
        })
        .uncheck();
      await page.goto(routeUrl("/settings?section=appearance"));
      await page
        .getByRole("button", {
          name: theme === "light" ? "Light" : "Dark",
          exact: true,
        })
        .click();
      for (const [screen, path] of routes) {
        await page.goto(routeUrl(path));
        await expect(page.locator("main h1").first()).toBeVisible();
        await page.evaluate((font) => {
          document.documentElement.style.fontSize = font;
        }, size);
        await page.waitForFunction(
          () =>
            !document
              .querySelector("main")
              ?.textContent?.includes("Loading your finances"),
        );
        // Allow the ResizeObserver/chart animation to settle after a text-size change.
        await page.waitForTimeout(100);
        const audit = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze();
        const geometry = await page.evaluate(() => ({
          viewport: innerWidth,
          width: document.documentElement.scrollWidth,
        }));
        const violations = audit.violations.map((violation) => ({
          id: violation.id,
          impact: violation.impact,
          nodes: violation.nodes.map((node) => ({
            target: node.target,
            summary: node.failureSummary,
          })),
        }));
        const result = { setup, screen, theme, size, ...geometry, violations };
        results.push(result);
        if (violations.length || geometry.width > width + 1)
          console.log(JSON.stringify(result));
      }
      console.log(`${setup}: ${routes.length} screen states audited`);
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
await mkdir(output, { recursive: true });
await writeFile(
  resolve(output, "results.json"),
  JSON.stringify(results, null, 2),
);
const summary = {
  states: results.length,
  violations: results.reduce(
    (count, result) => count + result.violations.length,
    0,
  ),
  overflows: results.filter((result) => result.width > result.viewport + 1)
    .length,
};
console.log(JSON.stringify(summary));
if (summary.violations || summary.overflows) process.exitCode = 1;
