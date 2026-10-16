import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  collectGeometry,
  auditState,
  renderAuditReport,
  collectElementInventory,
  chartLabelOverlap,
  chartLabelContrast,
} from "./feng-polish-audit-engine.mjs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { waitForReadyScene } from "./feng-polish-scene.mjs";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
let browser;
test.before(async () => {
  browser = await chromium.launch({ headless: true });
});
test.after(async () => {
  await browser?.close();
});
async function inspect(body, css = "", width = 390) {
  const page = await browser.newPage({ viewport: { width, height: 844 } });
  await page.setContent(
    '<!doctype html><html lang="en-GB"><head><style>*{box-sizing:border-box}body{margin:0;font:16px/1.5 Arial,sans-serif}main{padding:16px}.card{padding:16px;border:1px solid #777;border-radius:16px}button{min-width:44px;min-height:44px;font-size:16px}' +
      css +
      "</style></head><body><main>" +
      body +
      "</main></body></html>",
  );
  const result = await page.evaluate(collectGeometry, {
    mobile: width < 768,
    setupId: "seed",
    stateId: "seed",
  });
  await page.close();
  return result;
}
const has = (r, rule) => r.issues.some((i) => i.rule === rule);
test("SVG axis contrast uses fill instead of the inherited HTML text colour", async () => {
  const page = await browser.newPage();
  try {
    for (const [background, fill, fails] of [
      ["#191f2c", "#666666", true],
      ["#191f2c", "#abb6ca", false],
      ["#ffffff", "#666666", false],
    ]) {
      await page.setContent(
        `<main style="background:${background};color:white"><svg width="300" height="150"><g class="recharts-xAxis-tick-labels"><text x="10" y="30" font-size="12" fill="${fill}"><tspan>September</tspan></text></g></svg></main>`,
      );
      const elements = await page.evaluate(collectElementInventory);
      const label = elements.find((e) => e.tag === "tspan");
      assert.ok(label.fill);
      assert.equal(chartLabelContrast(elements).length > 0, fails);
    }
  } finally {
    await page.close();
  }
});
test("SVG label collisions use the rendered font, including both horizontal and vertical axes", async () => {
  const page = await browser.newPage();
  try {
    for (const axis of ["x", "y"])
      for (const crowded of [true, false]) {
        const x = axis === "x" ? (crowded ? 40 : 100) : 10;
        const y = axis === "y" ? (crowded ? 35 : 80) : 30;
        await page.setContent(
          `<svg width="300" height="150"><g class="recharts-${axis}Axis-tick-labels"><text x="10" y="30" font-size="24"><tspan>May</tspan></text><text x="${x}" y="${y}" font-size="24"><tspan>Jun</tspan></text></g></svg>`,
        );
        const elements = await page.evaluate(collectElementInventory);
        const issues = chartLabelOverlap(elements);
        assert.equal(
          issues.length > 0,
          crowded,
          `${axis} axis crowded=${crowded}`,
        );
      }
  } finally {
    await page.close();
  }
});
test("Scene readiness waits through a transient IndexedDB-style loading frame", async () => {
  const page = await browser.newPage();
  try {
    await page.setContent(
      '<main><h1>Home</h1><p>Old figures</p></main><script>setTimeout(()=>document.querySelector("main").innerHTML="<p role=status>Loading your finances…</p>",40);setTimeout(()=>document.querySelector("main").innerHTML="<h1>Home</h1><p>£123.45</p>",140)</script>',
    );
    const scene = await waitForReadyScene(page);
    assert.ok(scene.includes("£123.45"));
    assert.ok(!scene.includes("Loading your finances"));
  } finally {
    await page.close();
  }
});
test("A loading-only screen cannot become screenshot evidence", async () => {
  const page = await browser.newPage();
  try {
    await page.setContent(
      '<main><p role="status">Loading your finances…</p></main>',
    );
    await assert.rejects(waitForReadyScene(page, 300), /did not become ready/);
  } finally {
    await page.close();
  }
});
test("A visible first-launch modal is ready while the private page is inert", async () => {
  const page = await browser.newPage();
  try {
    await page.setContent(
      '<main inert><p role="status">Loading your finances…</p></main><dialog open><h2>Welcome to Feng</h2><p>On your device</p></dialog>',
    );
    assert.ok((await waitForReadyScene(page)).includes("Welcome to Feng"));
  } finally {
    await page.close();
  }
});
test("Report opens one setup, links the retained raw measurements and fails missing after evidence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "feng-report-"));
  const page = await browser.newPage();
  try {
    const output = join(directory, "report.html");
    await renderAuditReport({
      before: [
        {
          id: "home",
          setup: "iphone390-dark",
          title: "Home <source>",
          audit: { measurements: { retainedInJson: true } },
        },
        { id: "home", setup: "desktop1440-dark" },
      ],
      output,
      metadata: { expectedStatesPerSetup: 1 },
    });
    const html = await readFile(output, "utf8");
    await page.setContent(html);
    assert.equal(await page.locator("#setup").inputValue(), "iphone390-dark");
    assert.equal(await page.locator(".state").count(), 1);
    assert.equal(
      await page.locator(".state h2").textContent(),
      "Home <source>",
    );
    assert.equal(
      await page
        .getByRole("link", { name: /All raw text, target/ })
        .getAttribute("href"),
      "before/iphone390-dark/home.json",
    );
    assert.equal(await page.locator("#summary .status-fail").count(), 2);
    assert.ok(!html.includes('"retainedInJson":true'));
  } finally {
    await page.close();
    await rm(directory, { recursive: true, force: true });
  }
});
test("Range detects an actual amount breaking mid-number", async () => {
  const r = await inspect(
    '<strong class="amount">−£1,234.56</strong><span class="broken">Nationwide</span>',
    ".amount,.broken{display:block;width:28px;overflow-wrap:anywhere}",
  );
  assert.ok(has(r, "amount-wrap"));
  assert.ok(has(r, "word-split"));
  assert.ok(has(r, "unsafe-word-break"));
});
test("Range measures date substring rather than a multi-line paragraph height", async () => {
  const r = await inspect(
    '<p style="width:200px">Your backup is dated <time style="white-space:nowrap">13 Oct 2026</time>. These additional words can wrap without wrapping the date itself.</p>',
  );
  assert.ok(!has(r, "date-wrap"));
});
test("Range detects wrapped date and squeezed label", async () => {
  const r = await inspect(
    '<span id="date">13 Oct 2026</span><button id="squeeze">Monthly spending comparison</button>',
    "#date{display:block;width:35px}#squeeze{display:block;width:70px;padding:2px}",
  );
  assert.ok(has(r, "date-wrap"));
  assert.ok(has(r, "text-squeezed"));
});
test("An entire statement date range stays on one line", async () => {
  const r = await inspect(
    '<time style="display:block;width:110px">1 to <span style="white-space:nowrap">30 Sep 2026</span></time>',
  );
  assert.ok(has(r, "date-wrap"));
});
test("Min-content and ancestor clipping detect sibling squeeze", async () => {
  const r = await inspect(
    '<div class="flex"><strong id="label">Nationwide</strong><span class="amount">£12,345.67</span></div>',
    ".flex{display:flex;width:150px;gap:8px}.flex strong{min-width:0;width:30px;overflow:hidden;white-space:nowrap}.amount{flex:none;white-space:nowrap}",
  );
  assert.ok(has(r, "sibling-squeeze"));
  assert.ok(has(r, "text-clipped"));
});
test("Dividers expose short, edge and double lines", async () => {
  const r = await inspect(
    '<section class="card"><hr><p>First row</p><hr class="short"><hr class="short"></section>',
    "hr{border:0;border-top:1px solid #777;margin:0}.short{width:50%}",
  );
  assert.ok(has(r, "divider-short"));
  assert.ok(has(r, "divider-at-edge"));
  assert.ok(has(r, "divider-double"));
});
test("Lists expose amount alignment without flagging KPI columns", async () => {
  const r = await inspect(
    '<ul><li><span>One</span><span class="amount">£12.00</span></li><li><span>Two</span><span class="amount">£1,234.00</span></li></ul>',
    "ul{list-style:none;padding:0}li{display:flex;gap:8px}.amount{white-space:nowrap}",
  );
  assert.ok(has(r, "amount-alignment"));
});
test("Tables compare money within its own column and still detect a misaligned cell", async () => {
  const body =
    '<table><tbody><tr><th>April</th><td><span class="amount">£1,234.00</span></td><td><span class="amount">−£234.00</span></td></tr><tr><th>May</th><td><span class="amount">£12.00</span></td><td><span class="amount">−£2.00</span></td></tr></tbody></table>';
  const css =
    "table{width:100%;table-layout:fixed}td{text-align:right}.amount{display:inline-block;white-space:nowrap}";
  const aligned = await inspect(body, css);
  assert.ok(!has(aligned, "amount-alignment"));
  const misaligned = await inspect(
    body,
    css + "tr:last-child td:first-of-type{padding-right:12px}",
  );
  assert.ok(has(misaligned, "amount-alignment"));
  assert.ok(
    misaligned.issues
      .filter((issue) => issue.rule === "amount-alignment")
      .every((issue) => issue.text === "£12.00"),
  );
});
test("Controls expose unsafe destructive spacing and below-scale gaps", async () => {
  const r = await inspect(
    '<div class="actions"><button>Save</button><button>Delete pot</button></div>',
    ".actions{display:flex;gap:3px}",
  );
  assert.ok(has(r, "destructive-gap"));
  assert.ok(has(r, "spacing-token"));
});
test("UK date entry has room for its complete value at the rendered font size", async () => {
  const body =
    '<input class="uk-date-text" aria-label="Date" value="30/09/2026">';
  const crowded = await inspect(
    body,
    "input{font:32px Arial;width:120px;height:48px;padding:8px}",
  );
  assert.ok(has(crowded, "date-input-fit"));
  const readable = await inspect(
    body,
    "input{font:32px Arial;width:300px;height:48px;padding:8px}",
  );
  assert.ok(!has(readable, "date-input-fit"));
});
test("A nested header action must leave space before the following input", async () => {
  const body =
    '<section><div class="header"><h2>Search</h2><button>Hide conditions</button></div><input aria-label="Query"></section>';
  const css =
    ".header{display:flex;flex-wrap:wrap;width:252px}.header h2{width:100%;margin:0}input{display:block;width:252px;height:48px}";
  const crowded = await inspect(body, css);
  assert.ok(has(crowded, "target-gap"));
  const separated = await inspect(body, css + ".header{margin-bottom:8px}");
  assert.ok(!has(separated, "target-gap"));
});
test("Native file input, visible skip link and unlabelled checkbox are detected", async () => {
  const r = await inspect(
    '<a class="skip-link" href="#main">Skip to content</a><input type="file"><input type="checkbox">',
  );
  assert.ok(has(r, "file-input-leaked"));
  assert.ok(has(r, "skip-link-leaked"));
  assert.ok(has(r, "checkbox-unlabelled"));
});
test("A label-sized hit area does not hide a switch track shrunk by checkbox styles", async () => {
  for (const checked of [false, true]) {
    const body = `<label style="display:flex;align-items:center;min-height:48px;gap:16px"><input type="checkbox" role="switch" ${checked ? "checked" : ""}>Protect this backup</label>`;
    const broken = await inspect(
      body,
      "input{appearance:none;width:20px;height:20px}",
    );
    assert.ok(has(broken, "switch-geometry"));
    assert.ok(!has(broken, "target-size"));
    const valid = await inspect(
      body,
      "input{appearance:none;width:51px;height:31px}",
    );
    assert.ok(!has(valid, "switch-geometry"));
  }
});
test("Hit area measures associated label, not only small checkbox visual", async () => {
  const r = await inspect(
    '<label style="display:flex;align-items:center;min-height:44px;gap:8px"><input type="checkbox">I accept the replacement</label>',
    "input[type=checkbox]{width:18px;height:18px}",
  );
  assert.ok(!has(r, "target-size"));
  assert.ok(!has(r, "checkbox-unlabelled"));
});
test("Mobile card margins and font/target floors are enforced", async () => {
  const r = await inspect(
    '<section class="card"><button style="min-height:20px;min-width:20px;padding:0">X</button><p style="font-size:11px">Tiny</p><input style="font-size:13px"></section>',
    "main{padding:13px}",
  );
  assert.ok(has(r, "mobile-card-margin"));
  assert.ok(has(r, "target-size"));
  assert.ok(has(r, "text-font"));
  assert.ok(has(r, "input-font"));
});
test("Healthy rows preserve words, aligned money and intended 16px margins", async () => {
  const r = await inspect(
    '<section class="card"><ul><li><span>Nationwide</span><span class="amount">−£1,259.12</span></li><li><span>Thames Water</span><span class="amount">−£40.00</span></li></ul></section>',
    "ul{list-style:none;padding:0;margin:0}li{display:flex;justify-content:space-between;gap:16px;min-height:64px}.amount{white-space:nowrap;font-variant-numeric:tabular-nums}",
  );
  assert.ok(!has(r, "word-split"));
  assert.ok(!has(r, "amount-wrap"));
  assert.ok(!has(r, "amount-alignment"));
  assert.ok(!has(r, "mobile-card-margin"));
});

test("Original copy checks detect ISO, numeric dates and em dashes", async () => {
  const r = await inspect(
    "<p>Updated 2026-10-14</p><span>10/14/2026</span><p>One\u2014two</p>",
  );
  assert.ok(has(r, "copy-iso-date"));
  assert.ok(has(r, "copy-numeric-date"));
  assert.ok(has(r, "copy-em-dash"));
});
test("Background-only divider and final row border are measured", async () => {
  const r = await inspect(
    '<section class="card"><p>Heading</p><div class="separator"></div><a class="list-row" href="#">Final row</a></section>',
    ".separator{height:2px;width:50%;background:#777}.list-row{display:block;height:52px;border-bottom:1px solid #777}",
  );
  assert.ok(has(r, "divider-short"));
  assert.ok(has(r, "divider-at-edge"));
});
test("A vertical separator is tested against the row height, not horizontal width", async () => {
  const r = await inspect(
    '<div style="display:flex;height:64px"><span>Label</span><div role="separator" aria-orientation="vertical" style="height:24px;width:2px;background:#777"></div><span>Value</span></div>',
  );
  assert.ok(has(r, "vertical-line-short"));
  assert.ok(!has(r, "divider-short"));
});
test("Border-only vertical separators run the full neighbouring row height", async () => {
  const r = await inspect(
    '<div style="display:flex;align-items:center"><span style="height:64px">Label</span><span style="border-left:1px solid #777;height:24px;padding-left:8px">Value</span></div>',
  );
  assert.ok(has(r, "vertical-line-short"));
  assert.ok(!has(r, "divider-short"));
});
test("Author button styles cannot silently reveal a hidden condition-removal control", async () => {
  const broken = await inspect(
    "<button hidden>Remove condition</button>",
    "button{display:inline-flex}",
  );
  assert.ok(has(broken, "hidden-content-leaked"));
  const fixed = await inspect(
    "<button hidden>Remove condition</button>",
    "button{display:inline-flex}[hidden]{display:none!important}",
  );
  assert.ok(!has(fixed, "hidden-content-leaked"));
});
test("A toast inside the same modal must clear its actual sorting footer", async () => {
  for (const bottom of [12, 64, 86]) {
    const r = await inspect(
      `<dialog open style="position:fixed;inset:12px auto auto 16px;width:358px;height:500px;padding:14px;border:1px solid #777"><footer class="category-board-footer" style="position:absolute;bottom:14px;left:14px;right:14px;height:60px"><button>Skip</button></footer><div class="ux-toast" style="position:absolute;left:14px;right:14px;bottom:${bottom}px;height:56px">Saved <button>Undo</button></div></dialog>`,
    );
    assert.equal(has(r, "toast-footer-clearance"), bottom < 86);
  }
});
test("A keyboard scroll region is not a standalone action beside a toast; its footer still needs clearance", async () => {
  for (const bottom of [12, 86]) {
    const r = await inspect(
      `<dialog open style="position:fixed;inset:12px auto auto 16px;width:358px;height:500px;padding:14px;border:1px solid #777"><div role="region" tabindex="0" aria-label="Form content" style="position:absolute;inset:14px 14px 74px;overflow:auto"><input aria-label="Description" style="height:48px;width:100%"></div><footer class="category-board-footer" style="position:absolute;bottom:14px;left:14px;right:14px;height:60px"><button>Save</button></footer><div class="ux-toast" style="position:absolute;left:14px;right:14px;bottom:${bottom}px;height:56px">Saved <button>Undo</button></div></dialog>`,
    );
    assert.ok(
      !r.issues.some(
        (issue) => issue.rule === "target-gap" && issue.text === "Form content",
      ),
    );
    assert.ok(
      r.exceptions.some(
        (entry) =>
          entry.rule === "target-gap" &&
          entry.reason?.includes("keyboard-focusable region"),
      ),
    );
    assert.equal(has(r, "toast-footer-clearance"), bottom < 86);
  }
});
test("Independent hit areas that overlap are reported", async () => {
  const r = await inspect(
    '<button>First</button><button style="margin-left:-20px">Second</button>',
  );
  assert.ok(has(r, "control-overlap"));
});
test("Transparent hover controls are checked when they actually become visible", async () => {
  const hidden = await inspect(
    '<div style="opacity:0"><button style="font-size:11px;min-height:20px;min-width:20px">Hidden hover action</button></div>',
  );
  assert.ok(!has(hidden, "text-font"));
  assert.ok(!has(hidden, "target-size"));
  const shown = await inspect(
    '<div style="opacity:1"><button style="font-size:11px;min-height:20px;min-width:20px">Visible hover action</button></div>',
  );
  assert.ok(has(shown, "text-font"));
  assert.ok(has(shown, "target-size"));
});
test("Fixed footer coverage is detected and the original scroll position restored", async () => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  try {
    await page.setContent(
      '<!doctype html><html lang="en-GB"><head><title>Seeded footer test</title><style>body{margin:0;font:16px Arial;background:white;color:black}main{padding:16px}.spacer{height:1000px}button{height:48px}footer{position:fixed;bottom:0;left:0;right:0;height:80px;background:white}</style></head><body><main><div class="spacer"></div><button>Final save</button></main><footer>Fixed footer</footer></body></html>',
    );
    const r = await auditState(
      page,
      { id: "seed-footer", width: 390 },
      { id: "seed" },
    );
    assert.ok(has(r, "bottom-content-covered"));
    assert.equal(await page.evaluate(() => scrollY), 0);
    assert.ok(r.elements.some((e) => e.name === "Final save"));
  } finally {
    await context.close();
  }
});
test("Nested summaries inside a closed disclosure are not visible controls", async () => {
  const r = await inspect(
    "<details><summary>Outer disclosure</summary><details><summary>Hidden inner disclosure</summary><button>Hidden action</button></details></details>",
    "details{display:block}summary{min-height:44px}",
  );
  assert.ok(!r.issues.some((i) => /Hidden inner|Hidden action/.test(i.text)));
});
test("Password reveal reserves space and does not excuse an unsafe overlap", async () => {
  const body =
    '<label for="password">Password</label><div class="password-field"><input id="password" type="password"><button aria-label="Show password">Show</button></div>';
  const css =
    ".password-field{position:relative;width:300px}.password-field input{width:100%;height:48px}.password-field button{position:absolute;right:0;top:0;width:64px;height:48px}";
  const safe = await inspect(
    body,
    css + ".password-field input{padding-right:72px}",
  );
  assert.ok(!has(safe, "target-gap"));
  assert.ok(safe.exceptions.some((e) => e.rule === "target-gap"));
  const unsafe = await inspect(
    body,
    css + ".password-field input{padding-right:4px}",
  );
  assert.ok(has(unsafe, "target-gap") || has(unsafe, "control-overlap"));
});
test("The explicit two-line title allowance never excuses narrow three-line text", async () => {
  const healthy = await inspect(
    "<h1>Welcome to Feng</h1>",
    "h1{width:160px;font-size:28px;line-height:1.4}",
  );
  assert.ok(!has(healthy, "text-squeezed"));
  assert.ok(healthy.exceptions.some((e) => e.rule === "text-squeezed"));
  const narrow = await inspect(
    "<h1>Welcome to Feng</h1>",
    "h1{width:90px;font-size:28px;line-height:1.4}",
  );
  assert.ok(has(narrow, "text-squeezed"));
});
