#!/usr/bin/env node
/** Document each retained low finding; never change the measured audit or its gate. */
import { readFile, writeFile, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";

const root = resolve(process.argv[2] || "audit");
const reviewed = [];
const unjustified = [];
function reason(issue, state) {
  const { rule, selector, measured } = issue;
  if (
    rule === "vertical-line-short" &&
    / > aside\.sidebar$/u.test(selector) &&
    Math.abs(measured.height - state.audit.viewport.height) <= 1
  )
    return [
      "The fixed desktop sidebar frame ends at the viewport edge. It separates navigation from the scrolling document, rather than separating rows in a content list.",
      "src/ux-review.css",
    ];
  if (
    rule === "divider-at-edge" &&
    /ol\.ui-stepper > li:nth-of-type\([1-4]\) > span\.ui-stepper-mark/u.test(
      selector,
    ) &&
    measured.childIndex === 0 &&
    measured.visibleChildren === 2
  )
    return [
      "This four-pixel mark is a named import-progress indicator above its step label. It is deliberately the first part of the step, rather than a card divider.",
      "src/components/UIPrimitives.tsx",
    ];
  if (
    rule === "divider-at-edge" &&
    / > thead > tr$/u.test(selector) &&
    measured.edge === "last bottom border"
  )
    return [
      "The bottom border separates this table's column headings from its first data row. Being the final child of THEAD does not make it a trailing card separator.",
      "src/final-polish.css",
    ];
  if (rule === "divider-at-edge" && measured.edge === "first top border") {
    const row = selector.match(
      /(?:payment-timeline|category-trend-list) > li:nth-of-type\((\d+)\)$/u,
    );
    if (row && Number(row[1]) > 1)
      return [
        `This is the separator before actual list row ${row[1]}. Earlier rows are above the captured viewport; the border remains between real adjacent rows in the full-page screenshot.`,
        "src/final-polish.css",
      ];
    if (
      /section\.card\.category-trend.* > details:nth-of-type\(1\)$/u.test(
        selector,
      )
    )
      return [
        "This full-width separator introduces the source-values disclosure after the category chart and explanatory content. That preceding content is above the captured viewport.",
        "src/pages/Category.tsx",
      ];
    if (/^#planning-panel-debt > section\.card > details$/u.test(selector))
      return [
        "This separator introduces the monthly payment schedule after the debt-result summary and table. It remains between content groups in the full-page screenshot.",
        "src/components/PlanningExtensions.tsx",
      ];
    if (/ > details\.generic-review-list:nth-of-type\(1\)$/u.test(selector))
      return [
        "This separator introduces source transaction review after the statement proof and warnings. Those preceding blocks are above the captured viewport; removing the line would merge distinct review groups.",
        "src/components/GenericImportReview.tsx",
      ];
  }
  return undefined;
}
for (const setup of await readdir(join(root, "after"), {
  withFileTypes: true,
})) {
  if (!setup.isDirectory()) continue;
  for (const file of await readdir(join(root, "after", setup.name))) {
    if (!file.endsWith(".json")) continue;
    const state = JSON.parse(
      await readFile(join(root, "after", setup.name, file), "utf8"),
    );
    if (!state.audit) continue;
    for (const issue of state.audit.issues.filter(
      (item) => item.severity === "low",
    )) {
      const disposition = reason(issue, state);
      const item = {
        id: createHash("sha256")
          .update(
            JSON.stringify([state.setup, state.id, issue.rule, issue.selector]),
          )
          .digest("hex"),
        setup: state.setup,
        state: state.id,
        rule: issue.rule,
        selector: issue.selector,
        measured: issue.measured,
        image: "after/" + state.image,
        fullImage: "after/" + state.fullImage,
        reason: disposition?.[0],
        source: disposition?.[1],
      };
      (disposition ? reviewed : unjustified).push(item);
    }
  }
}
let visual;
try {
  visual = JSON.parse(
    await readFile(join(root, "visual-contact-sheets/review.json"), "utf8"),
  );
} catch {
  visual = {};
}
const result = {
  generatedAt: new Date().toISOString(),
  method:
    "Per-occurrence reasons for known structural lines, supported by the full-page image and source. Unknown patterns remain unresolved. Numerical audit issues are retained unchanged.",
  complete: visual.complete === true && unjustified.length === 0,
  count: reviewed.length,
  visualReviewComplete: visual.complete === true,
  reviewed,
  unjustified,
};
await writeFile(
  join(root, "low-justifications.json"),
  JSON.stringify(result, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    retained: reviewed.length,
    unjustified: unjustified.length,
    complete: result.complete,
  }),
);
if (unjustified.length) process.exitCode = 1;
