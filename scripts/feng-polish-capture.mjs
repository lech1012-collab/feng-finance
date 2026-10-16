/** Reproducible Feng UX states. Only synthetic fixtures/demo IndexedDB in fresh contexts. */
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync, readFileSync, renameSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { sceneFingerprint, waitForReadyScene } from "./feng-polish-scene.mjs";
const require = createRequire(new URL("../package.json", import.meta.url));
const {
  chromium,
  webkit,
  devices,
  expect: baseExpect,
} = require("@playwright/test");
const expect = baseExpect.configure({ timeout: 30000 });
export const setups = [
  {
    id: "iphone390-dark",
    width: 390,
    height: 844,
    theme: "dark",
    mobile: true,
    textScale: 1,
  },
  {
    id: "iphone375-dark",
    width: 375,
    height: 667,
    theme: "dark",
    mobile: true,
    textScale: 1,
  },
  {
    id: "small320-dark",
    width: 320,
    height: 568,
    theme: "dark",
    mobile: true,
    textScale: 1,
  },
  {
    id: "iphone390-text200",
    width: 390,
    height: 844,
    theme: "dark",
    mobile: true,
    textScale: 2,
  },
  {
    id: "iphone390-light",
    width: 390,
    height: 844,
    theme: "light",
    mobile: true,
    textScale: 1,
  },
  {
    id: "desktop1440-dark",
    width: 1440,
    height: 900,
    theme: "dark",
    mobile: false,
    textScale: 1,
  },
  {
    id: "desktop1024-dark",
    width: 1024,
    height: 768,
    theme: "dark",
    mobile: false,
    textScale: 1,
  },
];
const BASE = (
  process.env.FENG_AUDIT_URL ??
  process.argv[2] ??
  "http://127.0.0.1:4173/"
).replace(/\/$/, "");
const OUTPUT =
  process.env.FENG_AUDIT_OUTPUT ??
  resolve("audit", process.env.FENG_AUDIT_PHASE ?? "before");
const TODAY = process.env.FENG_AUDIT_TODAY ?? "2026-10-14T12:00:00Z",
  MONTH = "2026-09";
const fixture = (name) =>
  fileURLToPath(new URL("../tests/fixtures/" + name + ".pdf", import.meta.url));
const runStartedAt = new Date().toISOString();
const results = [],
  errors = [],
  network = [];
const hook = process.env.FENG_AUDIT_MODULE
  ? (await import(pathToFileURL(process.env.FENG_AUDIT_MODULE))).auditState
  : null;
let browser;
let current, activeGroup;
function writeJson(file, value) {
  const temporary = file + ".tmp";
  writeFileSync(temporary, JSON.stringify(value, null, 2));
  renameSync(temporary, file);
}
async function database(page, names) {
  return page.evaluate(
    (names) =>
      new Promise((resolve, reject) => {
        const r = indexedDB.open("feng-finance");
        r.onerror = () => reject(r.error);
        r.onsuccess = () => {
          const db = r.result,
            tx = db.transaction(names, "readonly"),
            out = {};
          for (const n of names) {
            const q = tx.objectStore(n).getAll();
            q.onsuccess = () => (out[n] = q.result);
          }
          tx.oncomplete = () => {
            db.close();
            resolve(out);
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    names,
  );
}
async function put(page, rows) {
  await page.evaluate(
    (rows) =>
      new Promise((resolve, reject) => {
        const r = indexedDB.open("feng-finance");
        r.onerror = () => reject(r.error);
        r.onsuccess = () => {
          const db = r.result,
            tx = db.transaction(Object.keys(rows), "readwrite");
          for (const [n, values] of Object.entries(rows))
            for (const value of values) tx.objectStore(n).put(value);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    rows,
  );
}
async function go(page, route) {
  await page.goto(BASE + "/#" + route);
  await expect(page.locator("main h1").first()).toBeVisible();
  await page.waitForTimeout(180);
  await applyScale(page);
}
async function applyScale(page) {
  if (page.setup.textScale === 2)
    await page.evaluate(
      () => (document.documentElement.style.fontSize = "200%"),
    );
}
async function open(setup, { demo = true, ack = true } = {}) {
  const context = await browser.newContext({
    baseURL: BASE,
    ...(setup.mobile ? devices["iPhone 13"] : {}),
    viewport: { width: setup.width, height: setup.height },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
    colorScheme: setup.theme,
    serviceWorkers: "allow",
    locale: "en-GB",
  });
  // Safety: no real rate downloads, forms or email calls during audit.
  await context.route("**/*", async (route) => {
    const req = route.request(),
      u = new URL(req.url());
    if (
      ["http:", "https:"].includes(u.protocol) &&
      u.origin !== new URL(BASE).origin
    ) {
      network.push({
        setup: setup.id,
        blocked: true,
        host: u.host,
        method: req.method(),
      });
      await route.abort();
    } else await route.continue();
  });
  context.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin !== new URL(BASE).origin || request.method() !== "GET")
      network.push({
        setup: setup.id,
        url: request.url(),
        method: request.method(),
        hasBody: !!request.postData(),
        serviceWorker: !!request.serviceWorker?.(),
      });
  });
  const page = await context.newPage();
  page.setup = setup;
  current = page;
  page.on("pageerror", (e) =>
    errors.push({
      setup: setup.id,
      group: activeGroup,
      message: e.message,
      route: page.url(),
    }),
  );
  await page.clock.setFixedTime(new Date(TODAY));
  await page.addInitScript(
    ({ theme, scale }) => {
      const originalFetch = window.fetch.bind(window);
      window.__fengAuditExternalFetches = [];
      window.fetch = (input, init) => {
        const url = new URL(
          typeof input === "string"
            ? input
            : input instanceof Request
              ? input.url
              : input.toString(),
          location.href,
        );
        if (url.origin !== location.origin) {
          window.__fengAuditExternalFetches.push({
            host: url.host,
            method: init?.method ?? "GET",
            hasBody: !!init?.body,
          });
          return Promise.reject(
            new TypeError("Audit uses only bundled local rates"),
          );
        }
        return originalFetch(input, init);
      };
      localStorage.setItem("feng-theme", theme);
      if (scale === 2)
        document.addEventListener(
          "DOMContentLoaded",
          () => (document.documentElement.style.fontSize = "200%"),
        );
    },
    { theme: setup.theme, scale: setup.textScale },
  );
  await page.goto(BASE + "/#/");
  await page.evaluate(async () => {
    if ("serviceWorker" in navigator)
      await Promise.race([
        navigator.serviceWorker.ready,
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("Offline app installation timed out")),
            60000,
          ),
        ),
      ]);
  });
  await expect(
    page.getByRole("dialog", { name: "Welcome to Feng" }),
  ).toBeVisible();
  await applyScale(page);
  if (setup.theme === "light") {
    await put(page, { settings: [{ key: "theme", value: "light" }] });
    await page.reload();
    await expect(
      page.getByRole("dialog", { name: "Welcome to Feng" }),
    ).toBeVisible();
    await applyScale(page);
  }
  await put(page, {
    settings: [
      { key: "fx:download", value: "false" },
      // Ordinary review fixtures have already declined installation help.
      // First-launch fixtures keep the actual notice and installation journey.
      ...(ack ? [{ key: "installBannerNeverShow", value: "true" }] : []),
    ],
  });
  if (ack) {
    if (demo)
      await page
        .getByRole("button", { name: "Explore with demo data" })
        .click();
    else {
      const chooser = page.waitForEvent("filechooser");
      await page.getByRole("button", { name: "Import my statements" }).click();
      await (await chooser).setFiles([]);
    }
    await expect(
      page.getByRole("heading", { name: "Home", exact: true }),
    ).toBeVisible();
    if (demo) {
      const picker = page.locator("input[type=month]").first();
      if ((await picker.inputValue()) !== MONTH) await picker.fill(MONTH);
    }
    await put(page, {
      settings: [
        { key: "fx:download", value: "false" },
        { key: "fx:firstDownloadNoticeSeen", value: "true" },
      ],
    });
    await put(page, { settings: [{ key: "theme", value: setup.theme }] });
  }
  return { context, page };
}
async function snap(page, id, title, { focus, full = true, scroll = 0 } = {}) {
  if (
    process.env.FENG_AUDIT_STATES &&
    !process.env.FENG_AUDIT_STATES.split(",").includes(id)
  )
    return;
  if (focus) await focus.scrollIntoViewIfNeeded();
  else await page.evaluate((y) => scrollTo(0, y), scroll);
  await page.evaluate(
    () =>
      document.activeElement instanceof HTMLElement &&
      document.activeElement.blur(),
  );
  await page.evaluate(() => document.fonts.ready);
  const dir = OUTPUT + "/" + page.setup.id;
  mkdirSync(dir, { recursive: true });
  const filename = id + ".png";
  let ready = false;
  for (let attempt = 0; attempt < 3 && !ready; attempt++) {
    const before = await waitForReadyScene(page);
    await page.screenshot({
      path: dir + "/" + filename,
      animations: "disabled",
    });
    if (full)
      await page.screenshot({
        path: dir + "/" + id + "-full.png",
        fullPage: true,
        animations: "disabled",
      });
    ready = before === (await sceneFingerprint(page));
  }
  if (!ready) throw new Error("UI changed during screenshot capture: " + id);
  const attempted = await page.evaluate(
    () => window.__fengAuditExternalFetches ?? [],
  );
  if (attempted.length) {
    network.push(
      ...attempted.map((row) => ({
        setup: page.setup.id,
        state: id,
        blocked: true,
        ...row,
      })),
    );
    await page.evaluate(() => (window.__fengAuditExternalFetches = []));
  }
  const metrics = await page.evaluate(() => ({
    sceneReady: true,
    entryScript: document
      .querySelector('script[type="module"][src]')
      ?.getAttribute("src"),
    stylesheets: [...document.querySelectorAll('link[rel="stylesheet"][href]')]
      .map((link) => link.getAttribute("href"))
      .sort(),
    route: location.hash,
    viewport: { width: innerWidth, height: innerHeight },
    documentWidth: document.documentElement.scrollWidth,
    documentHeight: document.documentElement.scrollHeight,
    dialog: document
      .querySelector("dialog[open]")
      ?.getAttribute("aria-labelledby"),
    headings: [...document.querySelectorAll("h1,h2,h3")]
      .filter((e) => e.checkVisibility?.())
      .map((e) => e.textContent.trim()),
  }));
  const audit = hook
    ? await hook(page, page.setup, { id, title, route: metrics.route })
    : null;
  if (
    process.env.FENG_AUDIT_DEBUG_OVERFLOW === "1" &&
    metrics.documentWidth > metrics.viewport.width + 1
  ) {
    metrics.overflowDiagnostics = await page.evaluate(() =>
      [...document.querySelectorAll("body *")]
        .map((e) => {
          const r = e.getBoundingClientRect(),
            s = getComputedStyle(e);
          const text = document.createRange();
          text.selectNodeContents(e);
          const ink = text.getBoundingClientRect();
          return {
            tag: e.tagName,
            id: e.id,
            class: e.getAttribute("class"),
            text: e.textContent?.trim().slice(0, 100),
            width: r.width,
            left: r.left,
            right: r.right,
            scrollWidth: e.scrollWidth,
            clientWidth: e.clientWidth,
            textRight: ink.right,
            display: s.display,
            overflow: s.overflowX,
            inert: !!e.closest("[inert]"),
            dialog: e.closest("dialog")?.className,
          };
        })
        .filter(
          (e) =>
            e.width > 0 &&
            (e.right > innerWidth + 1 ||
              e.textRight > innerWidth + 1 ||
              e.scrollWidth + e.left > innerWidth + 1),
        )
        .sort((a, b) => b.scrollWidth - a.scrollWidth)
        .slice(0, 60),
    );
    console.log("OVERFLOW", id, JSON.stringify(metrics.overflowDiagnostics));
  }
  const result = {
    capturedAt: new Date().toISOString(),
    id,
    title,
    group: activeGroup,
    setup: page.setup.id,
    engine: page.setup.mobile ? "webkit" : "chromium",
    image: page.setup.id + "/" + filename,
    fullImage: page.setup.id + "/" + id + "-full.png",
    metrics,
    audit,
    source: "Actual rendered production app, fictitious records only",
    phase: process.env.FENG_AUDIT_PHASE ?? "before",
    applicability:
      id === "home-safari-storage-warning" && !page.setup.mobile
        ? "Safari-only warning not applicable on desktop; desktop post-import state captured"
        : "All setups",
  };
  results.push(result);
  writeJson(dir + "/" + id + ".json", result);
  console.log(
    JSON.stringify({
      state: id,
      setup: page.setup.id,
      issues: audit?.issues?.length ?? null,
    }),
  );
}
async function closeSheet(page) {
  await page.keyboard.press("Escape");
  await page.waitForTimeout(100);
}
async function select(page, names) {
  await go(page, "/import");
  await page
    .getByLabel("Select statements", { exact: true })
    .setInputFiles(names.map(fixture));
  await expect(page.locator(".import-statement-card")).toHaveCount(
    names.length,
    { timeout: 120000 },
  );
  await expect(page.locator(".import-review-list")).toBeVisible({
    timeout: 120000,
  });
  await page.waitForTimeout(250);
}
async function card(page, name) {
  const c = page.locator(".import-statement-card").filter({
    has: page.locator(".import-source-name").filter({ hasText: name + ".pdf" }),
  });
  await expect(c).toHaveCount(1);
  if (!(await c.evaluate((e) => e.open)))
    await c.locator(":scope > summary").click();
  return c;
}
async function baseStates(setup) {
  const { context, page } = await open(setup);
  try {
    const routes = [
      ["home-partial", "/", "Home with full demo and qualified values"],
      ["transactions-list", "/transactions?allDates=1", "Transactions list"],
      ["analyse-overview", "/analysis", "Analyse overview"],
      [
        "analyse-category",
        "/categories/groceries?month=" + MONTH,
        "Groceries category",
      ],
      [
        "analyse-property",
        "/categories/property?month=" + MONTH,
        "Property category",
      ],
      ["analyse-property-report", "/property", "Property report"],
      ["analyse-reports", "/analysis?view=reports", "Reports result"],
      ["analyse-trips", "/analysis?view=trips", "Tags and trips analysis"],
      ["subscriptions", "/subscriptions", "Subscriptions and bills"],
      ["planning-budgets", "/planning?tab=budgets", "Monthly budgets"],
      ["planning-pots", "/planning?tab=pots", "Pots and goals"],
      ["planning-calendar", "/planning?tab=calendar", "Payments calendar"],
      ["planning-debt", "/planning?tab=debt", "Debt payoff summary"],
      ["planning-forecast", "/planning?tab=forecast", "Forecast summary"],
      ["settings-home", "/settings", "Grouped Settings"],
      ["accounts", "/accounts", "Bank/card accounts and manual assets"],
      ["import-pick", "/import", "Import picker fallback"],
    ];
    for (const [id, route, title] of routes) {
      await go(page, route);
      await snap(page, id, title);
      if (id === "subscriptions") {
        const evidence = page
          .locator("details")
          .filter({
            has: page.locator("summary", { hasText: "source evidence" }),
          })
          .first();
        await evidence.locator(":scope > summary").click();
        await snap(
          page,
          "subscription-evidence",
          "Recurring charges and price-change evidence",
          { focus: evidence },
        );
      }
    }
    for (const section of [
      "appearance",
      "currency",
      "period",
      "categories",
      "rules",
      "tags",
      "reminders",
      "reports",
      "transfers",
      "security",
      "backup",
      "storage",
      "export",
      "changes",
      "demo",
      "imports",
      "diagnostics",
      "statements",
      "about",
      "danger",
    ]) {
      await go(page, "/settings?section=" + section);
      await snap(page, "settings-" + section, "Settings: " + section);
    }
    await go(page, "/settings?section=tags");
    const addTag = page.getByRole("button", { name: "Add tag", exact: true });
    if (await addTag.count()) await addTag.click();
    await snap(page, "tag-editor", "Tag name and preset colours", {
      focus: page.getByLabel("Tag name", { exact: true }),
    });
    if (await page.locator("dialog[open]").count()) await closeSheet(page);
    await go(page, "/settings?section=about");
    await page.getByRole("button", { name: "What's new", exact: true }).click();
    await snap(page, "whats-new", "Version-specific changes");
    await closeSheet(page);
    await go(page, "/settings?section=currency");
    const manual = page.getByRole("button", {
      name: "Enter a manual rate",
      exact: true,
    });
    if (await manual.count()) await manual.click();
    else await page.getByText("Enter a manual rate", { exact: true }).click();
    await snap(page, "manual-rate", "Manual exchange-rate entry");
    await closeSheet(page);
    await go(page, "/settings?section=about");
    await page
      .getByRole("button", { name: "Send feedback", exact: true })
      .click();
    await snap(
      page,
      "feedback",
      "Feedback technical context and explicit send",
    );
    await closeSheet(page);
    for (const [summary, id] of [
      ["Install help", "install-help"],
      ["Privacy", "privacy"],
    ]) {
      const d = page
        .locator("details")
        .filter({ has: page.locator("summary", { hasText: summary }) })
        .first();
      await d.locator("summary").click();
      await snap(page, id, summary, { focus: d });
      await d.locator("summary").click();
    }
    await go(page, "/settings?section=reports");
    await page
      .getByLabel("Enable property tax summary", { exact: true })
      .click();
    await expect(
      page.getByLabel("Enable property tax summary", { exact: true }),
    ).toBeChecked();
    await expect
      .poll(async () => {
        const rows = await database(page, ["settings"]);
        return rows.settings.find(
          (setting) => setting.key === "property-tax-report",
        )?.value;
      })
      .toBe("true");
    await go(page, "/analysis?view=reports");
    const taxCard = page
      .locator("section.card")
      .filter({
        has: page.getByRole("heading", {
          name: "Property income for Self Assessment",
          exact: true,
        }),
      })
      .last();
    await expect(taxCard).toBeVisible();
    await snap(page, "self-assessment", "Self Assessment property summary", {
      focus: taxCard,
    });
    const allowable = page.getByRole("button", {
      name: "Choose allowable expenses",
      exact: true,
    });
    if (await allowable.count()) await allowable.click();
    await snap(page, "self-assessment-expenses", "Allowable expense choices", {
      focus: (await page.locator("dialog[open]").count())
        ? page.locator("dialog[open]")
        : taxCard,
    });
    if (await page.locator("dialog[open]").count()) await closeSheet(page);
    await go(page, "/review?month=" + MONTH);
    for (let step = 1; step <= 4; step++) {
      if (step > 1)
        await page
          .getByRole("button", { name: new RegExp("^" + step + "\\. ") })
          .click();
      await snap(page, "monthly-review-" + step, "Monthly review step " + step);
    }
    await go(page, "/transactions?allDates=1");
    const transfers = page.getByRole("button", {
      name: "Confirm pair",
      exact: true,
    });
    // This synthetic profile deliberately includes a pending transfer. Do not
    // silently omit the required complete-Home state before its query settles.
    await expect(transfers.first()).toBeVisible();
    {
      await transfers.first().click();
      const manual = await database(page, ["valuations"]);
      await put(page, {
        valuations: manual.valuations.map((row) => ({
          ...row,
          date: "2026-09-30",
        })),
      });
      await go(page, "/");
      await snap(
        page,
        "home-complete",
        "Home with verified account balances and current manual valuations",
      );
    }
    await go(page, "/settings?section=currency");
    await page.locator("#reporting-currency").selectOption("USD");
    await go(page, "/");
    await snap(
      page,
      "home-missing-rates",
      "Unknown converted figures show rates needed",
    );
    await go(page, "/planning?tab=forecast");
    await snap(
      page,
      "forecast-missing-rates",
      "Forecast with missing exchange rates",
    );
  } catch (error) {
    const dir = OUTPUT + "/" + setup.id;
    mkdirSync(dir, { recursive: true });
    await page
      .screenshot({
        path: dir + "/failure-" + activeGroup + ".png",
        fullPage: true,
      })
      .catch(() => {});
    throw error;
  } finally {
    await context.close();
  }
}
async function firstLaunchStates(setup) {
  const { context, page } = await open(setup, { demo: false, ack: false });
  try {
    await snap(page, "first-launch", "First-launch beta notice");
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Import my statements" }).click();
    await (await chooser).setFiles([]);
    await expect(
      page.getByRole("heading", { name: "Home", exact: true }),
    ).toBeVisible();
    await snap(page, "home-empty", "Home after cancelling first picker");
    await go(page, "/transactions?allDates=1");
    await snap(
      page,
      "transactions-empty",
      "Transactions with no imported records",
    );
    await go(page, "/subscriptions");
    await snap(page, "subscriptions-empty", "No recurring evidence yet");
    await go(page, "/planning?tab=pots");
    await snap(page, "pots-empty", "No goals or pots yet");
    await go(page, "/settings?section=backup");
    await snap(page, "backup-empty", "No saved backup yet");
  } catch (error) {
    const dir = OUTPUT + "/" + setup.id;
    mkdirSync(dir, { recursive: true });
    await page
      .screenshot({
        path: dir + "/failure-" + activeGroup + ".png",
        fullPage: true,
      })
      .catch(() => {});
    throw error;
  } finally {
    await context.close();
  }
}
async function seedSortingQueue(page) {
  await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const r = indexedDB.open("feng-finance");
        r.onerror = () => reject(r.error);
        r.onsuccess = () => {
          const db = r.result,
            tx = db.transaction(
              ["accounts", "statements", "transactions"],
              "readwrite",
            ),
            stamp = "2026-10-14T12:00:00Z";
          tx.objectStore("accounts").put({
            id: "ux-sort-account",
            institution: "Barclays",
            displayName: "Fictitious everyday account",
            accountType: "current",
            currency: "GBP",
            tracking: "statement",
            maskedAccountIdentifier: "•••• 9876",
            createdAt: stamp,
            updatedAt: stamp,
          });
          const rows = [
            ["ux-sort-waitrose", "2026-09-05", -820, "WAITROSE STORE 1234"],
            ["ux-sort-pret", "2026-09-04", -685, "PRET A MANGER"],
            ["ux-sort-clean", "2026-09-03", -7500, "FICTITIOUS HOUSE CLEANING"],
          ];
          tx.objectStore("statements").put({
            id: "ux-sort-statement",
            accountId: "ux-sort-account",
            institution: "Barclays",
            statementPeriodStart: "2026-09-01",
            statementPeriodEnd: "2026-09-30",
            periodSource: "printed",
            openingBalance: 100000,
            closingBalance: 90995,
            currency: "GBP",
            sourceFilename: "Fictitious UX sorting example",
            sourceFileHash: "fictitious-ux-sorting",
            importedAt: stamp,
            parserVersion: "synthetic",
            extractionMethod: "embedded-text",
            validationStatus: "reconciled",
            validationDifference: 0,
            transactionCount: 3,
            warnings: [],
          });
          for (const [id, date, amount, merchant] of rows)
            tx.objectStore("transactions").put({
              id,
              accountId: "ux-sort-account",
              statementId: "ux-sort-statement",
              date,
              amount,
              merchant,
              description: merchant,
              currency: "GBP",
              type: "expense",
              kind: "normal",
              tags: [],
              source: "pdf",
              sourcePage: 1,
              extractionConfidence: 1,
              transactionFingerprint: id,
              occurrence: 0,
              isTransfer: false,
              isReviewed: false,
              createdAt: stamp,
              updatedAt: stamp,
            });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
  await page.reload();
}

async function transactionStates(setup) {
  const { context, page } = await open(setup);
  try {
    await seedSortingQueue(page);
    await go(page, "/transactions?allDates=1");
    await page
      .getByRole("button", { name: /^Filters/ })
      .first()
      .click();
    await snap(page, "transaction-filters", "Transaction filters sheet");
    const custom = page.getByRole("button", {
      name: "Date range",
      exact: true,
    });
    if (await custom.count()) await custom.click();
    await snap(page, "transaction-filters-date", "Explicit date-range filters");
    const builder = page.getByRole("button", {
      name: "Build a filter",
      exact: true,
    });
    if (await builder.count()) {
      await builder.click();
      await snap(
        page,
        "transaction-query-builder",
        "Advanced condition builder",
      );
    }
    await closeSheet(page);
    await page
      .locator("#transaction-search")
      .fill("nothing matches this fictitious search");
    await snap(
      page,
      "transaction-search-empty",
      "Search has no results and can be cleared",
    );
    await page
      .getByRole("button", { name: "Clear search", exact: true })
      .first()
      .click();
    await go(page, "/transactions?uncategorized=1&allDates=1");
    await snap(page, "transactions-uncategorised", "Uncategorised-only queue");
    const queueRow = page
      .getByRole("link", { name: /^Waitrose,.*Needs category/ })
      .first();
    const queueTransactionId = decodeURIComponent(
      (await queueRow.getAttribute("href")).split("?")[0].split("/").at(-1),
    );
    if (!setup.mobile) {
      await queueRow.scrollIntoViewIfNeeded();
      await queueRow.hover();
      const box = await queueRow.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(
        box.x + box.width / 2 + 60,
        box.y + box.height / 2 + 8,
        { steps: 8 },
      );
      await snap(
        page,
        "sorting-direct-manipulation",
        "Desktop object drag and category destinations",
      );
      await page.keyboard.press("Escape");
      await page.mouse.up();
    }
    await queueRow.click();
    await expect(
      page.getByRole("dialog", { name: "Where does this belong?" }),
    ).toBeVisible();
    if (setup.mobile)
      await snap(
        page,
        "sorting-direct-manipulation",
        "Mobile tap alternative to desktop dragging",
      );
    await snap(
      page,
      "sorting-sheet",
      "Sorting sheet with suggested categories",
    );
    // Use the documented keyboard alternative after the pointer/drag state
    // has been captured. It also lets the baseline's clipped small-screen
    // board complete the same data change without forcing a hidden click.
    await expect(
      page
        .locator(
          'dialog[open] .suggested-categories [data-category-target="groceries"]',
        )
        .first(),
    ).toBeVisible();
    await waitForReadyScene(page);
    await page.getByRole("dialog").focus();
    await page.keyboard.press("1");
    await expect
      .poll(async () => {
        const rows = await database(page, ["transactions"]);
        return rows.transactions.find(
          (transaction) => transaction.id === queueTransactionId,
        )?.categoryId;
      })
      .toBe("groceries");
    // The historical build has an in-flow receipt without a status role.
    // Require the actual toast for the new UI; preserve the old layout as evidence.
    if ((process.env.FENG_AUDIT_PHASE ?? "before") === "after")
      await expect(
        page
          .getByRole("status")
          .filter({ hasText: /category|Groceries|saved|learned/i })
          .first(),
      ).toBeVisible();
    await snap(
      page,
      "sorting-undo-toast",
      "Learning receipt and next transaction",
    );
    await closeSheet(page);
    const data = await database(page, ["transactions"]);
    const expense = data.transactions.find(
      (t) =>
        t.categoryId === "groceries" && t.date.startsWith(MONTH) && !t.parentId,
    );
    await go(page, "/transactions/" + expense.id);
    await snap(
      page,
      "transaction-detail",
      "Transaction detail and source trace",
    );
    const addTransactionTag = page.getByRole("button", {
      name: "Add tag",
      exact: true,
    });
    if (await addTransactionTag.count()) await addTransactionTag.click();
    else await page.locator("summary", { hasText: /^Add tag$/u }).click();
    await snap(page, "transaction-tags", "Transaction tag choices and search", {
      focus: page.locator(".tag-picker").first(),
    });
    await closeSheet(page);
    await go(page, "/transactions/" + expense.id);
    await page.getByRole("button", { name: "Split", exact: true }).click();
    const split = page.getByRole("dialog", {
      name: "Split transaction",
      exact: true,
    });
    await expect(split).toBeVisible();
    await split
      .getByRole("combobox", { name: "Category", exact: true })
      .nth(1)
      .selectOption("shopping");
    await split.getByLabel("Split amount 1", { exact: true }).fill("5.00");
    await split.getByLabel("Split amount 2", { exact: true }).fill("3.19");
    const saveSplit = split.getByRole("button", {
      name: "Save split",
      exact: true,
    });
    await expect(saveSplit).toBeDisabled();
    await snap(
      page,
      "split-remaining",
      "Split editor with remaining allocation",
    );
    await split
      .getByLabel("Split amount 2", { exact: true })
      .fill(((Math.abs(expense.amount) - 500) / 100).toFixed(2));
    await expect(saveSplit).toBeEnabled();
    await snap(
      page,
      "split-balanced",
      "Split editor balanced to the source amount",
    );
    await closeSheet(page);
    const refund = data.transactions.find(
      (t) => t.amount > 0 && t.kind === "refund",
    );
    await go(page, "/transactions/" + refund.id);
    await snap(page, "refund-detail", "Refund source and counted month");
    await page.getByRole("button", { name: "Refund of…", exact: true }).click();
    await snap(
      page,
      "refund-picker",
      "Refund same-merchant recent-purchase picker",
    );
    await closeSheet(page);
    await go(page, "/transactions?allDates=1");
    await page
      .getByRole("button", { name: "Add manual transaction", exact: true })
      .click();
    await snap(page, "manual-transaction", "Manual transaction bottom sheet");
    await closeSheet(page);
    await go(page, "/settings?section=rules");
    await page
      .getByRole("button", { name: "Create rule", exact: true })
      .click();
    await snap(page, "rule-editor", "Rule editor with live matching preview");
    await closeSheet(page);
    await go(page, "/settings?section=categories");
    await page
      .getByRole("button", { name: "Add category", exact: true })
      .click();
    await snap(page, "category-new", "Add category sheet");
    await closeSheet(page);
    await page.getByRole("button", { name: /^Groceries/ }).click();
    await snap(page, "category-edit", "Edit category sheet");
    await closeSheet(page);
    await go(page, "/accounts");
    await page
      .getByRole("button", { name: "Add bank account", exact: true })
      .click();
    await snap(page, "account-new", "Add bank account sheet");
    await closeSheet(page);
    await page
      .getByRole("button", { name: "Add account", exact: true })
      .click();
    await snap(page, "asset-new", "Manual asset or liability sheet");
    await closeSheet(page);
  } catch (error) {
    const dir = OUTPUT + "/" + setup.id;
    mkdirSync(dir, { recursive: true });
    await page
      .screenshot({
        path: dir + "/failure-" + activeGroup + ".png",
        fullPage: true,
      })
      .catch(() => {});
    throw error;
  } finally {
    await context.close();
  }
}
async function planningStates(setup) {
  const { context, page } = await open(setup);
  try {
    await go(page, "/planning?tab=budgets");
    await put(page, {
      budgets: [
        {
          id: "audit-groceries-budget",
          categoryId: "groceries",
          month: MONTH,
          currency: "GBP",
          amountMinor: 60000,
          rollover: "none",
        },
      ],
    });
    // Native IndexedDB fixture writes do not emit Dexie's live-query notice.
    await page.reload();
    await expect(page.locator(".budget-card")).toHaveCount(1);
    await snap(
      page,
      "budget-status",
      "Populated past-period budget status before editing",
    );
    await page.getByRole("button", { name: "Set budget", exact: true }).click();
    await snap(page, "budget-editor", "Budget edit sheet");
    await closeSheet(page);
    await go(page, "/planning?tab=pots");
    await page.getByRole("button", { name: "New pot", exact: true }).click();
    await snap(page, "pot-editor", "Goal or irregular-cost pot sheet");
    await closeSheet(page);
    await page.getByText("Pot options", { exact: true }).first().click();
    await snap(
      page,
      "pot-options",
      "Pot contribution and separated destructive options",
    );
    await closeSheet(page);
    await go(page, "/planning?tab=calendar");
    await page
      .getByRole("button", { name: "New recurring payment", exact: true })
      .click();
    await snap(page, "series-editor", "Recurring payment series edit sheet");
    await closeSheet(page);
    await go(page, "/planning?tab=debt");
    await page
      .getByRole("button", { name: "Edit repayment terms", exact: true })
      .first()
      .click();
    await snap(
      page,
      "debt-terms-editor",
      "APR and actual minimum payment terms",
    );
    await closeSheet(page);
    await page
      .getByRole("button", { name: "Edit repayment plan", exact: true })
      .click();
    await snap(page, "debt-plan-editor", "Repayment strategy and amount sheet");
    await page
      .getByRole("dialog", { name: "Repayment plan", exact: true })
      .getByLabel("Monthly amount available", { exact: true })
      .fill("300.00");
    await page
      .getByRole("dialog", { name: "Repayment plan", exact: true })
      .getByRole("button", { name: "Done", exact: true })
      .click();
    await snap(
      page,
      "debt-calculated",
      "Debt payoff uses card minimums and excludes unpaid mortgage terms",
    );
    await go(page, "/planning?tab=forecast");
    await snap(
      page,
      "what-if",
      "What-if adjustments separate from actual figures",
      { focus: page.getByRole("heading", { name: "What if?", exact: true }) },
    );
    const scenarioEditor = page.getByRole("button", {
      name: /^(Edit scenario|New scenario|Add scenario)$/,
    });
    if (await scenarioEditor.count()) await scenarioEditor.first().click();
    await snap(
      page,
      "what-if-editor",
      "Scenario editor: temporary adjustments",
      {
        focus: (await page.locator("dialog[open]").count())
          ? page.locator("dialog[open]").first()
          : page.getByRole("heading", { name: "What if?", exact: true }),
      },
    );
    await closeSheet(page);
    await go(page, "/analysis?view=reports");
    await page
      .getByRole("button", { name: "Edit report", exact: true })
      .click();
    await snap(page, "report-editor", "Reports scope and condition edit sheet");
    await closeSheet(page);
  } catch (error) {
    const dir = OUTPUT + "/" + setup.id;
    mkdirSync(dir, { recursive: true });
    await page
      .screenshot({
        path: dir + "/failure-" + activeGroup + ".png",
        fullPage: true,
      })
      .catch(() => {});
    throw error;
  } finally {
    await context.close();
  }
}
async function importStates(setup) {
  const { context, page } = await open(setup, { demo: false });
  try {
    await go(page, "/import");
    const file = page.getByLabel("Select statements", { exact: true });
    // Delay only local file reads in this isolated synthetic profile. This keeps
    // the real processing screen observable without changing the PDF bytes or
    // racing into Review while the accessibility audit is still measuring it.
    await page.evaluate(() => {
      const original = Blob.prototype.arrayBuffer;
      let release;
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      Blob.prototype.arrayBuffer = async function () {
        await gate;
        return original.call(this);
      };
      window.__fengAuditReleaseFileRead = () => {
        Blob.prototype.arrayBuffer = original;
        release();
      };
    });
    const choosing = file.setInputFiles(fixture("known-bank-barclays-current"));
    await expect(
      page
        .getByRole("list", { name: "Import progress" })
        .locator('[aria-current="step"]'),
    ).toHaveText(/Check/);
    await snap(page, "import-check", "Processing one selected PDF");
    await page.evaluate(() => window.__fengAuditReleaseFileRead());
    await choosing;
    await expect(page.locator(".import-statement-card")).toHaveCount(1, {
      timeout: 120000,
    });
    await expect(page.locator(".import-review-list")).toBeVisible();
    await snap(page, "import-review-one", "Native bank one-statement review");
    const bc = await card(page, "known-bank-barclays-current");
    await snap(
      page,
      "import-review-one-expanded",
      "Native statement figures and exact reconciliation",
      { focus: bc },
    );
    await select(page, [
      "known-bank-barclays-current",
      "known-bank-barclaycard",
      "known-bank-amex",
      "known-bank-revolut",
    ]);
    await snap(
      page,
      "import-review-four",
      "Four native bank statements in one review",
    );
    for (const [f, id] of [
      ["known-bank-barclaycard", "import-barclaycard-expanded"],
      ["known-bank-amex", "import-amex-expanded"],
      ["known-bank-revolut", "import-revolut-expanded"],
    ]) {
      const c = await card(page, f);
      await snap(page, id, "Native bank reconciliation: " + f, { focus: c });
      await c.locator(":scope > summary").click();
    }
    await page
      .getByRole("button", { name: "Confirm import", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Home", exact: true }),
    ).toBeVisible();
    await snap(page, "home-after-import", "Import completion with next action");
    const notice = page.locator(".beta-data-notice");
    if (await notice.isVisible())
      await snap(
        page,
        "home-safari-storage-warning",
        "Safari-tab storage warning",
      );
    else
      await snap(
        page,
        "home-safari-storage-warning",
        "Post-import storage warning state",
        { focus: page.locator("main") },
      );
    await select(page, ["known-bank-barclays-current"]);
    await snap(
      page,
      "import-duplicate",
      "Exact duplicate statement is skipped",
    );
    await select(page, ["known-bank-hsbc"]);
    const hsbc = await card(page, "known-bank-hsbc");
    await snap(page, "import-generic", "Unfamiliar bank generic reader", {
      focus: hsbc,
    });
    const details = hsbc.getByRole("region", {
      name: "Statement reading and checks",
    });
    const mappingDetails = details
      .locator("details.generic-parser-details")
      .first();
    if (!(await mappingDetails.evaluate((e) => e.open)))
      await mappingDetails.locator(":scope > summary").click();
    const map = details
      .getByRole("button", { name: /Map columns|Check mapping/ })
      .first();
    await map.click();
    await snap(
      page,
      "import-map-columns",
      "Column role mapping exception workflow",
    );
    await closeSheet(page);
    await select(page, ["known-bank-barclays-malformed"]);
    const bad = await card(page, "known-bank-barclays-malformed");
    await snap(
      page,
      "import-t11-mismatch",
      "Synthetic T11 amount mismatch blocks confirmation",
      { focus: bad },
    );
    const reading = bad.locator("details.generic-parser-details");
    if (!(await reading.evaluate((e) => e.open)))
      await reading.locator("summary").click();
    await bad
      .getByRole("button", { name: "Review PDF layout", exact: true })
      .click();
    const proof = bad.getByRole("region", {
      name: "Statement reading and checks",
    });
    await snap(
      page,
      "import-needs-review",
      "Needs review list with extracted rows and source proof",
      { focus: proof },
    );
    const wrong = proof.locator(".generic-review-row").filter({
      has: page.locator("summary strong", { hasText: "FICTIONAL GROCER" }),
    });
    await wrong
      .getByRole("button", { name: "Correct row", exact: true })
      .click();
    await snap(
      page,
      "import-correct-row",
      "Problem row correction with source crop",
    );
    const cancel = wrong.getByRole("button", { name: "Cancel", exact: true });
    if (await cancel.count()) await cancel.click();
    const anyway = proof.getByRole("button", {
      name: "Import anyway…",
      exact: true,
    });
    if ((await anyway.isVisible()) && (await anyway.isEnabled())) {
      await anyway.click();
      await snap(
        page,
        "import-unverified-confirmation",
        "Explicit unverified import warning",
      );
      await closeSheet(page);
    }
    await go(page, "/import");
    await page.getByLabel("Select statements", { exact: true }).setInputFiles({
      name: "fictitious-invalid.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.7\nInvalid synthetic document"),
    });
    await expect(page.locator(".import-statement-card")).toHaveCount(1, {
      timeout: 60000,
    });
    await snap(page, "import-invalid", "Damaged or unsupported PDF error");
  } catch (error) {
    const dir = OUTPUT + "/" + setup.id;
    mkdirSync(dir, { recursive: true });
    await page
      .screenshot({
        path: dir + "/failure-" + activeGroup + ".png",
        fullPage: true,
      })
      .catch(() => {});
    throw error;
  } finally {
    await context.close();
  }
}
async function backupStates(setup) {
  const { context, page } = await open(setup);
  try {
    await go(page, "/settings?section=backup");
    await page
      .getByRole("button", { name: "Save backup", exact: true })
      .click();
    await snap(
      page,
      "backup-protected-editor",
      "Default password-protected backup sheet",
    );
    const d = page.getByRole("dialog", { name: "Save backup", exact: true });
    await d
      .getByLabel("Backup password", { exact: true })
      .fill("Fictitious-review-password");
    await d
      .getByLabel("Confirm backup password", { exact: true })
      .fill("Fictitious-review-password");
    await snap(
      page,
      "backup-protected-ready",
      "Protected backup ready for export",
    );
    const dl = page.waitForEvent("download", { timeout: 90000 });
    await d.getByRole("button", { name: "Save backup", exact: true }).click();
    const download = await dl;
    if (process.env.FENG_AUDIT_DEBUG_BACKUP)
      await download.saveAs(process.env.FENG_AUDIT_DEBUG_BACKUP);
    const encrypted = await download.path();
    await snap(page, "backup-saved-toast", "Backup download receipt");
    await page
      .getByLabel("Choose Feng backup", { exact: true })
      .setInputFiles(encrypted);
    await expect(
      page.getByRole("dialog", { name: "Unlock backup", exact: true }),
    ).toBeVisible();
    await snap(page, "restore-unlock", "Encrypted backup password gate");
    await page
      .getByLabel("Backup password", { exact: true })
      .fill("wrong password");
    await page
      .getByRole("button", { name: "Unlock and preview", exact: true })
      .click();
    await expect(page.getByRole("alert")).toBeVisible();
    await snap(
      page,
      "restore-wrong-password",
      "Wrong password cannot change financial data",
    );
    await page
      .getByLabel("Backup password", { exact: true })
      .fill("Fictitious-review-password");
    await page
      .getByRole("button", { name: "Unlock and preview", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Restore backup", exact: true }),
    ).toBeVisible();
    await snap(
      page,
      "restore-preview",
      "Restore contents preview before acknowledgement",
    );
    await page
      .getByLabel(
        "I understand that this replaces all existing data on this device.",
        { exact: true },
      )
      .check();
    await snap(
      page,
      "restore-acknowledged",
      "Explicit replacement acknowledgement",
    );
    await closeSheet(page);
    await page
      .getByRole("button", { name: "Save backup", exact: true })
      .click();
    await page
      .getByRole("switch", {
        name: "Protect with a password (recommended)",
        exact: true,
      })
      .uncheck();
    await snap(
      page,
      "backup-readable-warning",
      "Optional readable backup warning",
    );
    await closeSheet(page);
    await page.getByLabel("Choose Feng backup", { exact: true }).setInputFiles({
      name: "fictitious-invalid.json",
      mimeType: "application/json",
      buffer: Buffer.from('{"version":999}'),
    });
    await expect(page.getByRole("alert")).toBeVisible();
    await snap(
      page,
      "restore-invalid-file",
      "Invalid backup rejected without replacing data",
    );
    await go(page, "/settings?section=danger");
    await snap(
      page,
      "danger-disabled",
      "Both delete options disabled without acknowledgement",
    );
    await page
      .getByLabel(
        "I understand my imported transaction history will be deleted.",
        { exact: true },
      )
      .check();
    await snap(
      page,
      "danger-records-acknowledged",
      "Record-only deletion acknowledgement",
    );
    await page
      .getByLabel("Type ERASE to confirm permanent deletion", { exact: true })
      .fill("ERASE");
    await snap(
      page,
      "danger-erase-acknowledged",
      "Full-erasure exact phrase gate",
    );
    await go(page, "/settings?section=security");
    const setupLock = page.getByRole("button", {
      name: "Set up app lock",
      exact: true,
    });
    if (await setupLock.count()) await setupLock.click();
    await snap(page, "app-lock-setup", "Configure six-digit PIN protection");
    await page
      .getByLabel("Choose a 6-digit app PIN", { exact: true })
      .fill("628391");
    await page.getByLabel("Confirm PIN", { exact: true }).fill("628391");
    await page
      .getByRole("button", { name: "Enable app lock", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Lock now", exact: true }),
    ).toBeVisible();
    await snap(page, "app-lock-enabled", "PIN protection configured");
    await page.getByRole("button", { name: "Lock now", exact: true }).click();
    await expect(
      page.getByLabel("6-digit app PIN", { exact: true }),
    ).toBeVisible();
    await snap(page, "app-lock", "Locked workspace with six masked digits");
    await page.getByLabel("6-digit app PIN", { exact: true }).fill("000000");
    await page.getByRole("button", { name: "Unlock", exact: true }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await snap(page, "app-lock-error", "Incorrect PIN stays locked");
    await page.getByText("Forgot PIN?", { exact: true }).click();
    await snap(
      page,
      "app-lock-recovery",
      "Forgot PIN explanation without recovery promises",
    );
  } catch (error) {
    const dir = OUTPUT + "/" + setup.id;
    mkdirSync(dir, { recursive: true });
    await page
      .screenshot({
        path: dir + "/failure-" + activeGroup + ".png",
        fullPage: true,
      })
      .catch(() => {});
    throw error;
  } finally {
    await context.close();
  }
}
async function safetyStates(setup) {
  const { context, page } = await open(setup, { demo: false });
  try {
    const ts = require("typescript"),
      source = readFileSync(
        new URL("../tests/e2e/storage-migration.spec.ts", import.meta.url),
        "utf8",
      );
    const schemas = source.slice(
      source.indexOf("const schema1"),
      source.indexOf("async function rawRecords"),
    );
    const seedSource = source.slice(
      source.indexOf("async function seedOldSchema"),
      source.indexOf("for (const version of [1, 2, 3]"),
    );
    const seed = Function(
      ts.transpileModule(schemas + seedSource, {
        compilerOptions: { target: ts.ScriptTarget.ES2022 },
      }).outputText + ";return seedOldSchema;",
    )();
    await page.goto(BASE + "/manifest.webmanifest");
    await page.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const r = indexedDB.deleteDatabase("feng-finance");
          r.onsuccess = () => resolve();
          r.onerror = () => reject(r.error);
          r.onblocked = () => reject(new Error("Synthetic reset blocked"));
        }),
    );
    await seed(page, 2);
    await go(page, "/settings?section=backup");
    await page.getByLabel("6-digit app PIN", { exact: true }).fill("628391");
    await page.getByRole("button", { name: "Unlock", exact: true }).click();
    const intro = page.getByRole("dialog", { name: "Welcome to Feng" });
    await expect(intro).toBeVisible();
    if (await intro.isVisible()) {
      const chooser = page.waitForEvent("filechooser");
      await intro.getByRole("button", { name: "Import my statements" }).click();
      await (await chooser).setFiles([]);
      await expect(intro).toHaveCount(0);
    }
    await expect(
      page.getByRole("button", { name: "Restore previous data", exact: true }),
    ).toBeVisible();
    await snap(
      page,
      "safety-copy",
      "Actual schema migration previous-data safety copy",
    );
    await page
      .getByRole("button", { name: "Restore previous data", exact: true })
      .click();
    await snap(
      page,
      "safety-restore-confirmation",
      "Safety copy replacement warning and preserved security",
    );
  } catch (error) {
    const dir = OUTPUT + "/" + setup.id;
    mkdirSync(dir, { recursive: true });
    await page
      .screenshot({
        path: dir + "/failure-" + activeGroup + ".png",
        fullPage: true,
      })
      .catch(() => {});
    throw error;
  } finally {
    await context.close();
  }
}
async function partialStates(setup) {
  const { context, page } = await open(setup, { demo: false });
  try {
    await select(page, ["known-bank-amex"]);
    await page
      .getByRole("button", { name: "Confirm import", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Home", exact: true }),
    ).toBeVisible();
    await snap(
      page,
      "home-card-only",
      "Only card statement imported: income and cash unknown",
    );
    await put(page, {
      accounts: [
        {
          id: "ux-missing-current",
          institution: "Barclays",
          displayName: "Everyday account",
          accountType: "current",
          currency: "GBP",
          tracking: "statement",
          includeInNetWorth: true,
          maskedAccountIdentifier: "•••• 4321",
          createdAt: TODAY,
          updatedAt: TODAY,
        },
      ],
    });
    await go(page, "/");
    await snap(
      page,
      "home-known-missing-account",
      "Partial Home with a known missing statement account",
    );
  } catch (error) {
    const dir = OUTPUT + "/" + setup.id;
    mkdirSync(dir, { recursive: true });
    await page
      .screenshot({
        path: dir + "/failure-" + activeGroup + ".png",
        fullPage: true,
      })
      .catch(() => {});
    throw error;
  } finally {
    await context.close();
  }
}
async function downloadedRateBackupStates(setup) {
  const { context, page } = await open(setup);
  try {
    await put(page, {
      fxRates: [
        {
          id: "ecb:2026-09-30:EUR:KRW",
          date: "2026-09-30",
          base: "EUR",
          quote: "KRW",
          rate: "1650.5",
          source: "ecb",
        },
      ],
    });
    await go(page, "/settings?section=backup");
    await page
      .getByRole("button", { name: "Save backup", exact: true })
      .click();
    await page
      .getByRole("switch", {
        name: "Protect with a password (recommended)",
        exact: true,
      })
      .uncheck();
    const pending = page.waitForEvent("download", { timeout: 90000 });
    await page
      .getByRole("dialog", { name: "Save backup", exact: true })
      .getByRole("button", { name: "Save backup", exact: true })
      .click();
    const backup = await pending;
    await page
      .getByLabel("Choose Feng backup", { exact: true })
      .setInputFiles(await backup.path());
    if ((process.env.FENG_AUDIT_PHASE ?? "before") === "before")
      await expect(page.getByRole("alert")).toContainText(
        "not a supported Feng Finance backup",
      );
    else
      await expect(
        page.getByRole("dialog", { name: "Restore backup", exact: true }),
      ).toBeVisible();
    await snap(
      page,
      "backup-with-downloaded-rates",
      "Backup containing a valid ECB quote outside supported ledger currencies",
    );
  } catch (error) {
    const dir = OUTPUT + "/" + setup.id;
    mkdirSync(dir, { recursive: true });
    await page
      .screenshot({
        path: dir + "/failure-" + activeGroup + ".png",
        fullPage: true,
      })
      .catch(() => {});
    throw error;
  } finally {
    await context.close();
  }
}
async function recurrenceStates(setup) {
  const { context, page } = await open(setup);
  try {
    await go(page, "/planning?tab=calendar");
    const review = page.getByRole("button", {
      name: "Review possible match",
      exact: true,
    });
    if ((process.env.FENG_AUDIT_PHASE ?? "before") === "after") {
      await review.click();
    } else {
      await page.getByText(/^Recurring series \(/).click();
    }
    await snap(
      page,
      "series-match-review",
      "Explicit recurring bill identity review; baseline silently combines similar names",
    );
    if ((process.env.FENG_AUDIT_PHASE ?? "before") === "after") {
      await page
        .getByRole("button", { name: "Same bill", exact: true })
        .click();
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      await expect(review).toBeVisible();
    }
    await snap(
      page,
      "series-match-undo",
      "Recurring bill match Undo; baseline has no confirmation to reverse",
    );
    await go(page, "/review?month=" + MONTH);
    await page.getByRole("button", { name: /^3\. / }).click();
    if ((process.env.FENG_AUDIT_PHASE ?? "before") === "after") {
      await page
        .getByRole("button", { name: /Contribute.*Suggested/ })
        .first()
        .click();
      await snap(
        page,
        "monthly-review-contribution",
        "Monthly review contribution form in a sheet",
      );
    } else {
      await snap(
        page,
        "monthly-review-contribution",
        "Monthly review contribution; baseline inline form",
        { focus: page.getByLabel(/contribution \(GBP\)/).first() },
      );
    }
  } finally {
    await context.close();
  }
}
async function trendStates(setup) {
  const { context, page } = await open(setup);
  try {
    await go(page, "/analysis");
    const details = page
      .locator("details.card")
      .filter({ has: page.locator('summary:text-is("Category trends")') });
    await details.locator(":scope > summary").click();
    await snap(
      page,
      "analyse-category-trends",
      "Category trend comparison and monthly source values",
      { focus: details },
    );
  } finally {
    await context.close();
  }
}
async function ruleExampleStates(setup) {
  const { context, page } = await open(setup);
  try {
    const records = await database(page, ["accounts", "transactions"]);
    // Fictitious saved-history examples, consistent with the demo rows. Actual
    // applying/Undo behaviour is independently tested through the real editor.
    const examples = [
      ["grocer", "Fictitious grocer", "WAITROSE", "groceries", false],
      ["streaming", "Fictitious streaming", "NETFLIX", "subscriptions", true],
    ].map(([key, name, pattern, categoryId, auto]) => {
      const matches = records.transactions.filter((t) =>
        t.description.toUpperCase().includes(pattern),
      );
      const last = matches
        .map((t) => t.date)
        .sort()
        .at(-1);
      return {
        id: `ux-rule-${key}`,
        name,
        match: "contains",
        pattern,
        direction: "negative",
        categoryId,
        priority: auto ? 100 : 400,
        builtIn: false,
        enabled: true,
        auto,
        createdFrom: auto ? "auto" : "user",
        conditionMatch: "all",
        conditions: [
          { field: "description", operator: "contains", value: pattern },
        ],
        actions: [{ type: "category", categoryId }],
        stats: { hits: matches.length, lastHit: last },
        lastUsedAt: last,
      };
    });
    await put(page, { rules: examples });
    await go(page, "/settings?section=rules");
    await expect(
      page.getByText("Fictitious grocer", { exact: true }),
    ).toBeVisible();
    await snap(
      page,
      "settings-rules-populated",
      "Explicit and remembered rules, match, category, hits and last use",
    );
  } finally {
    await context.close();
  }
}
async function valueStates(setup) {
  const { context, page } = await open(setup);
  try {
    for (const [route, id] of [
      ["/analysis", "analyse-cash-values"],
      ["/property", "property-cash-values"],
    ]) {
      await go(page, route);
      await expect(
        page.getByRole("heading", {
          name: route === "/property" ? "Property" : "Analyse",
          exact: true,
        }),
      ).toBeVisible();
      const details = page.locator("details.chart-data").first();
      await details.locator(":scope > summary").click();
      await snap(page, id, "Expanded cash-flow source values", {
        focus: details,
      });
    }
    await go(page, "/categories/groceries?month=" + MONTH);
    const categoryValues = page.locator("details").filter({
      has: page.locator('summary:text-is("View values")'),
    });
    await categoryValues.locator(":scope > summary").click();
    await snap(
      page,
      "category-values",
      "Expanded category monthly source values",
      { focus: categoryValues },
    );
    await go(page, "/analysis");
    const trends = page.locator("details.card").filter({
      has: page.locator('summary:text-is("Category trends")'),
    });
    await trends.locator(":scope > summary").click();
    const monthly = trends.locator("details").filter({
      has: page.locator('summary:text-is("Monthly values")'),
    });
    if ((process.env.FENG_AUDIT_PHASE ?? "before") === "after") {
      await expect(monthly).toHaveCount(1);
      await monthly.locator(":scope > summary").click();
    }
    await snap(
      page,
      "category-trend-monthly-values",
      "Expanded category trend source matrix",
      { focus: (await monthly.count()) ? monthly : trends },
    );
    await go(page, "/analysis?view=reports");
    // The baseline labelled this container without the group role. Capture its
    // real controls too, so the before evidence does not omit that defect.
    const display = page.locator('[aria-label="Report display"]');
    for (const mode of ["Bar", "Line"]) {
      await display.getByRole("button", { name: mode, exact: true }).click();
      if (
        mode === "Line" &&
        (process.env.FENG_AUDIT_PHASE ?? "before") === "after"
      ) {
        const axis = page.locator(
          ".v2-report-chart .recharts-xAxis-tick-labels",
        );
        await expect(axis).not.toContainText("Uncategorized");
        await expect(axis).toContainText("Uncategorised");
      }
      await snap(
        page,
        "report-" + mode.toLowerCase(),
        "Report result: " + mode.toLowerCase(),
      );
    }
  } finally {
    await context.close();
  }
}
const groups = {
  first: firstLaunchStates,
  partial: partialStates,
  base: baseStates,
  transactions: transactionStates,
  planning: planningStates,
  recurrence: recurrenceStates,
  imports: importStates,
  backup: backupStates,
  fxbackup: downloadedRateBackupStates,
  safety: safetyStates,
  trends: trendStates,
  rules: ruleExampleStates,
  values: valueStates,
};
try {
  for (const setup of setups.filter(
    (s) =>
      !process.env.FENG_AUDIT_SETUPS ||
      process.env.FENG_AUDIT_SETUPS.split(",").includes(s.id),
  )) {
    browser = await (setup.mobile ? webkit : chromium).launch({
      headless: true,
    });
    try {
      for (const [name, fn] of Object.entries(groups).filter(
        ([n]) =>
          !process.env.FENG_AUDIT_GROUPS ||
          process.env.FENG_AUDIT_GROUPS.split(",").includes(n),
      )) {
        activeGroup = name;
        console.log(
          "GROUP",
          setup.id,
          setup.mobile ? "webkit" : "chromium",
          name,
        );
        try {
          await fn(setup);
        } catch (error) {
          errors.push({ setup: setup.id, group: name, message: error.stack });
          console.error("GROUP FAILED", setup.id, name, error);
          if (current && !current.isClosed()) {
            const dir = OUTPUT + "/" + setup.id;
            mkdirSync(dir, { recursive: true });
            await current
              .screenshot({
                path: dir + "/failure-" + name + ".png",
                fullPage: true,
              })
              .catch(() => {});
            // A failure during open() happens before the group's try/finally.
            // Release its isolated context before continuing to the next group.
            await current
              .context()
              .close()
              .catch(() => {});
          }
        }
      }
    } finally {
      await browser.close();
      browser = undefined;
    }
  }
} finally {
  mkdirSync(OUTPUT, { recursive: true });
  writeJson(
    OUTPUT +
      "/capture-manifest-" +
      (process.env.FENG_AUDIT_SETUPS ?? "all").replaceAll(",", "-") +
      "-" +
      (process.env.FENG_AUDIT_GROUPS ?? "all") +
      (process.env.FENG_AUDIT_STATES ? "-selected" : "") +
      ".json",
    {
      base: BASE,
      today: TODAY,
      run: {
        startedAt: runStartedAt,
        finishedAt: new Date().toISOString(),
        setups: setups
          .filter(
            (s) =>
              !process.env.FENG_AUDIT_SETUPS ||
              process.env.FENG_AUDIT_SETUPS.split(",").includes(s.id),
          )
          .map((s) => s.id),
        groups: Object.keys(groups).filter(
          (name) =>
            !process.env.FENG_AUDIT_GROUPS ||
            process.env.FENG_AUDIT_GROUPS.split(",").includes(name),
        ),
        states: process.env.FENG_AUDIT_STATES?.split(","),
      },
      results,
      errors,
      network,
      complete: errors.length === 0,
    },
  );
  if (browser) await browser.close();
  if (errors.length) process.exitCode = 1;
}
