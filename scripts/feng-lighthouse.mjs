#!/usr/bin/env node
/** Optional release tooling, separate from runtime dependencies. Uses fictitious demo data. */
import { chromium } from "@playwright/test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const moduleName = process.env.FENG_LIGHTHOUSE_MODULE || "lighthouse";
const { default: lighthouse } = await import(
  moduleName.startsWith("/") ? pathToFileURL(moduleName).href : moduleName
);
const base = (process.argv[2] || "http://127.0.0.1:4173").replace(/\/$/, "");
const output = resolve(process.argv[3] || "audit/lighthouse");
const profile = await mkdtemp(join(tmpdir(), "feng-lighthouse-demo-"));
await mkdir(output, { recursive: true });
const port = Number(process.env.FENG_LIGHTHOUSE_PORT || 9223);
const context = await chromium.launchPersistentContext(profile, {
  headless: true,
  args: [
    `--remote-debugging-port=${port}`,
    "--remote-debugging-address=127.0.0.1",
  ],
  viewport: { width: 390, height: 844 },
  locale: "en-GB",
  colorScheme: "light",
});
const scores = [];
try {
  const page = context.pages()[0];
  await page.goto(base + "/#/");
  await page
    .getByRole("button", { name: "Explore with demo data", exact: true })
    .waitFor();
  await page.evaluate(
    () =>
      new Promise((resolveSetting, reject) => {
        const open = indexedDB.open("feng-finance");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction("settings", "readwrite");
          tx.objectStore("settings").put({
            key: "fx:download",
            value: "false",
          });
          tx.oncomplete = () => {
            db.close();
            resolveSetting();
          };
          tx.onerror = () => {
            db.close();
            reject(tx.error);
          };
        };
      }),
  );
  await page
    .getByRole("button", { name: "Explore with demo data", exact: true })
    .click();
  await page.getByRole("heading", { name: "Home", exact: true }).waitFor();
  for (const theme of ["light", "dark"]) {
    await page.goto(base + "/#/settings?section=appearance");
    await page
      .getByRole("button", {
        name: theme === "light" ? "Light" : "Dark",
        exact: true,
      })
      .click();
    await page
      .getByRole("status")
      .filter({ hasText: "Appearance saved." })
      .waitFor();
    await page.waitForFunction(
      (expected) => document.documentElement.dataset.theme === expected,
      theme,
    );
    for (const [name, route] of [
      ["home", "/"],
      ["transactions", "/transactions"],
      ["settings", "/settings"],
    ]) {
      const result = await lighthouse(base + "/#" + route, {
        port,
        output: ["html", "json"],
        logLevel: "error",
        onlyCategories: ["accessibility", "best-practices"],
        disableStorageReset: true,
        screenEmulation: {
          mobile: true,
          width: 390,
          height: 844,
          deviceScaleFactor: 1,
          disabled: false,
        },
      });
      if (!result?.lhr || result.lhr.runtimeError)
        throw new Error(
          JSON.stringify(result?.lhr?.runtimeError || "No Lighthouse result"),
        );
      const id = `${name}-${theme}`;
      await writeFile(join(output, id + ".html"), result.report[0]);
      await writeFile(join(output, id + ".json"), result.report[1]);
      const row = {
        page: name,
        theme,
        accessibility: Math.round(
          result.lhr.categories.accessibility.score * 100,
        ),
        bestPractices: Math.round(
          result.lhr.categories["best-practices"].score * 100,
        ),
        url: result.lhr.finalDisplayedUrl,
        entryScript: await page
          .locator('script[type="module"][src]')
          .first()
          .getAttribute("src"),
        stylesheets: await page
          .locator('link[rel="stylesheet"][href]')
          .evaluateAll((links) =>
            links.map((link) => link.getAttribute("href")).sort(),
          ),
      };
      scores.push(row);
      console.log(JSON.stringify(row));
    }
  }
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true });
  await writeFile(
    join(output, "summary.json"),
    JSON.stringify(
      { generatedAt: new Date().toISOString(), demoOnly: true, scores },
      null,
      2,
    ),
  );
}
if (
  scores.length !== 6 ||
  scores.some((r) => r.accessibility < 95 || r.bestPractices < 95)
)
  process.exitCode = 1;
