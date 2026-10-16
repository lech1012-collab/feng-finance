#!/usr/bin/env node
// Feng Finance UI audit, extended from the original script supplied by the
// product owner's UX designer on 14 October 2026. Its seven-engine matrix,
// per-element CSV, issues CSV, summary JSON and clickable report are retained.
// The complete state driver extends its original main-tab capture inventory.
// Existing @playwright/test and @axe-core/playwright dependencies are reused.
//
// Usage:
// node scripts/feng-ui-audit.mjs http://localhost:4173 --phase after --output audit/after
// node scripts/feng-ui-audit.mjs --report-only --before audit/before --after audit/after
import { readdir, readFile, mkdir, writeFile, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderAuditReport, AUDIT_RULES } from "./feng-polish-audit-engine.mjs";
import { inspectCaptureEvidence } from "./feng-polish-audit-evidence.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const option = (key, fallback) => {
  const index = args.indexOf(key);
  return index >= 0 ? args[index + 1] : fallback;
};
const url =
  args.find((a) => /^https?:\/\//u.test(a)) ||
  process.env.FENG_AUDIT_URL ||
  "http://127.0.0.1:4173/";
const phase = option("--phase", "after");
if (!["before", "after"].includes(phase))
  throw new Error("--phase must be before or after");
const output = resolve(
  option("--output", process.env.FENG_AUDIT_OUTPUT || "audit/" + phase),
);
const before = resolve(option("--before", "audit/before"));
const after = resolve(option("--after", "audit/after"));
const csv = (rows) => {
  if (!rows.length) return "";
  const keys = [...new Set(rows.flatMap(Object.keys))];
  const cell = (value) =>
    '"' +
    String(
      value && typeof value === "object"
        ? JSON.stringify(value)
        : (value ?? ""),
    ).replace(/"/gu, '""') +
    '"';
  return (
    [
      keys.map(cell).join(","),
      ...rows.map((row) => keys.map((key) => cell(row[key])).join(",")),
    ].join("\n") + "\n"
  );
};
const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));
/** State files are authoritative because filtered runs can overlap manifests. */
async function readCaptured(directory) {
  const results = [],
    errors = [],
    network = [],
    runs = [];
  let files = [];
  try {
    files = await readdir(directory, { withFileTypes: true });
  } catch {
    return { results, errors, network, complete: false, missing: true };
  }
  for (const entry of files) {
    if (entry.isDirectory())
      for (const name of await readdir(join(directory, entry.name))) {
        if (!name.endsWith(".json")) continue;
        const row = await readJson(join(directory, entry.name, name));
        if (row.id && row.setup) results.push(row);
      }
    else if (
      entry.name.startsWith("capture-manifest-") &&
      entry.name.endsWith(".json")
    ) {
      const manifest = await readJson(join(directory, entry.name));
      const info = await stat(join(directory, entry.name));
      runs.push({
        manifest,
        file: entry.name,
        time: Date.parse(manifest.run?.finishedAt || "") || info.mtimeMs,
      });
      network.push(...(manifest.network || []));
    }
  }
  results.sort(
    (a, b) => a.setup.localeCompare(b.setup) || a.id.localeCompare(b.id),
  );
  // Keep the latest actual outcome for each setup/group. A successful replay
  // supersedes an older failure only for the exact group it reran; unresolved
  // groups and unscoped errors remain failures. Historical outcomes are retained.
  const outcomes = new Map(),
    resolvedErrors = [];
  const groupNames = [
    "first",
    "partial",
    "base",
    "transactions",
    "planning",
    "recurrence",
    "imports",
    "backup",
    "fxbackup",
    "safety",
    "trends",
    "rules",
    "values",
  ];
  for (const { manifest, file, time } of runs.sort((a, b) => a.time - b.time)) {
    const scope = manifest.run;
    if (scope?.setups && scope?.groups) {
      for (const setup of scope.setups) {
        for (const group of scope.groups) {
          const key = setup + "/" + group,
            prior = outcomes.get(key);
          const current = (manifest.errors || []).filter(
            (error) =>
              error.setup === setup && (error.group === group || !error.group),
          );
          if (prior?.errors.length)
            resolvedErrors.push(
              ...prior.errors.map((error) => ({
                error,
                priorManifest: prior.file,
                replayedBy: file,
                outcome: current.length
                  ? "still failing"
                  : "passed exact group",
              })),
            );
          outcomes.set(key, { file, time, errors: current });
        }
        if (groupNames.every((group) => scope.groups.includes(group))) {
          const key = setup + "/*",
            prior = outcomes.get(key),
            current = (manifest.errors || []).filter(
              (error) => error.setup === setup && !error.group,
            );
          if (prior?.errors.length)
            resolvedErrors.push(
              ...prior.errors.map((error) => ({
                error,
                priorManifest: prior.file,
                replayedBy: file,
                outcome: current.length ? "still failing" : "passed full setup",
              })),
            );
          outcomes.set(key, { file, time, errors: current });
        }
      }
    } else
      for (const error of manifest.errors || []) {
        const key = (error.setup || "unknown") + "/" + (error.group || "*"),
          prior = outcomes.get(key);
        outcomes.set(key, {
          file,
          time,
          errors: [...(prior?.errors || []), error],
        });
      }
  }
  const seenErrors = new Set();
  for (const outcome of outcomes.values())
    for (const error of outcome.errors) {
      const key = JSON.stringify(error);
      if (!seenErrors.has(key)) {
        errors.push(error);
        seenErrors.add(key);
      }
    }
  return {
    results,
    errors,
    network,
    resolvedErrors,
    complete: !errors.length && results.length > 0,
  };
}
async function writeArtifacts(directory, captured, artifactPhase = phase) {
  const elements = [],
    issues = [],
    exceptions = [];
  const missing = captured.results.filter((r) => !r.audit);
  const inventory = await readJson(
    join(here, "feng-polish-screen-inventory.json"),
  );
  const missingStates = inventory.setups.flatMap((setup) =>
    inventory.states
      .filter(
        (state) =>
          !captured.results.some(
            (row) => row.setup === setup.id && row.id === state.id,
          ),
      )
      .map((state) => ({ setup: setup.id, state: state.id })),
  );
  for (const row of captured.results) {
    for (const element of row.audit?.elements || [])
      elements.push({
        view: row.setup,
        step: row.id,
        engine: row.engine,
        ...element,
      });
    for (const issue of row.audit?.issues || [])
      issues.push({
        view: row.setup,
        step: row.id,
        engine: row.engine,
        ...issue,
      });
    for (const exception of row.audit?.exceptions || [])
      exceptions.push({ view: row.setup, step: row.id, ...exception });
  }
  const bySev = issues.reduce(
    (a, i) => ((a[i.severity] = (a[i.severity] || 0) + 1), a),
    {},
  );
  const byRule = issues.reduce(
    (a, i) => ((a[i.rule] = (a[i.rule] || 0) + 1), a),
    {},
  );
  const setups = [...new Set(captured.results.map((r) => r.setup))];
  const evidence = await inspectCaptureEvidence(
    captured.results,
    directory,
    artifactPhase,
  );
  const perSetup = Object.fromEntries(
    setups.map((setup) => {
      const rows = captured.results.filter((r) => r.setup === setup),
        counts = { high: 0, medium: 0, low: 0 };
      for (const row of rows)
        for (const severity of Object.keys(counts))
          counts[severity] += row.audit?.counts?.[severity] || 0;
      return [
        setup,
        {
          states: rows.length,
          engine: rows[0].engine,
          issues: counts,
          auditedStates: rows.filter((r) => r.audit).length,
          complete:
            evidence.completeEvidence &&
            rows.length === inventory.states.length &&
            rows.every((r) => r.audit) &&
            !missingStates.some((s) => s.setup === setup) &&
            !captured.errors.some(
              (error) => error.setup === setup || !error.setup,
            ),
        },
      ];
    }),
  );
  const summary = {
    schema: 1,
    url,
    date: new Date().toISOString(),
    phase: artifactPhase,
    views: setups,
    screenshots: captured.results.length,
    elements: elements.length,
    issuesBySeverity: bySev,
    issuesByRule: byRule,
    perSetup,
    unauditedStates: missing.map((r) => ({ setup: r.setup, state: r.id })),
    missingStates,
    expectedStatesPerSetup: inventory.states.length,
    ...evidence,
    errors: captured.errors,
    resolvedErrors: captured.resolvedErrors,
    network: captured.network,
    complete:
      captured.complete &&
      evidence.completeEvidence &&
      !missing.length &&
      !missingStates.length,
    gate:
      captured.complete &&
      !missing.length &&
      !missingStates.length &&
      evidence.completeEvidence &&
      setups.length === 7 &&
      !bySev.high &&
      !bySev.medium
        ? "PASS"
        : "FAIL",
    rules: AUDIT_RULES,
  };
  await mkdir(directory, { recursive: true });
  await Promise.all([
    writeFile(join(directory, "elements.csv"), csv(elements)),
    writeFile(join(directory, "issues.csv"), csv(issues)),
    writeFile(join(directory, "exceptions.csv"), csv(exceptions)),
    writeFile(
      join(directory, "summary.json"),
      JSON.stringify(summary, null, 2),
    ),
    writeFile(
      join(directory, "results.json"),
      JSON.stringify(captured, null, 2),
    ),
  ]);
  return summary;
}

if (!args.includes("--report-only")) {
  const driver = join(here, "feng-polish-capture.mjs");
  const status = await new Promise((res, rej) => {
    const child = spawn(process.execPath, [driver], {
      stdio: "inherit",
      env: {
        ...process.env,
        FENG_AUDIT_URL: url,
        FENG_AUDIT_OUTPUT: output,
        FENG_AUDIT_PHASE: phase,
        FENG_AUDIT_MODULE: join(here, "feng-polish-audit-engine.mjs"),
      },
    });
    child.on("error", rej);
    child.on("exit", (code) => res(code ?? 1));
  });
  const captured = await readCaptured(output);
  const summary = await writeArtifacts(output, captured);
  const parent = dirname(output),
    other = join(parent, phase === "before" ? "after" : "before");
  const current = join(output, "results.json");
  const otherRows = await readCaptured(other);
  const otherSummary = otherRows.results.length
    ? await writeArtifacts(
        other,
        otherRows,
        phase === "before" ? "after" : "before",
      )
    : null;
  const afterSummary = phase === "after" ? summary : otherSummary;
  await renderAuditReport({
    before:
      phase === "before"
        ? current
        : otherRows.results.length
          ? join(other, "results.json")
          : [],
    after:
      phase === "after"
        ? current
        : otherRows.results.length
          ? join(other, "results.json")
          : [],
    output: join(parent, "report.html"),
    metadata: {
      url,
      phase,
      automatedLayoutGate: afterSummary?.gate || "FAIL",
      singleImmutableBuild: afterSummary?.singleImmutableBuild || false,
      expectedStatesPerSetup: summary.expectedStatesPerSetup,
      afterCaptureCompleteBySetup: Object.fromEntries(
        Object.entries(afterSummary?.perSetup || {}).map(([setup, details]) => [
          setup,
          details.complete,
        ]),
      ),
      releaseGateSource:
        "Feng-Release-Readiness-Review.md, section 7 (Release gate)",
      source:
        "Extended UX-designer feng-ui-audit.mjs; WebKit mobile / Chromium desktop; fictitious demo only",
    },
  });
  console.log(
    "[audit]",
    JSON.stringify({
      output,
      states: summary.screenshots,
      counts: summary.issuesBySeverity,
      gate: summary.gate,
    }),
  );
  if (status || summary.gate !== "PASS") process.exitCode = 1;
} else {
  const b = await readCaptured(before),
    a = await readCaptured(after);
  const bSummary = b.results.length
    ? await writeArtifacts(before, b, "before")
    : null;
  const aSummary = a.results.length
    ? await writeArtifacts(after, a, "after")
    : null;
  const report = resolve(
    option("--report", join(dirname(after), "report.html")),
  );
  await renderAuditReport({
    before: b.results.length ? join(before, "results.json") : [],
    after: a.results.length ? join(after, "results.json") : [],
    output: report,
    metadata: {
      url,
      expectedStatesPerSetup:
        aSummary?.expectedStatesPerSetup ||
        bSummary?.expectedStatesPerSetup ||
        0,
      afterCaptureCompleteBySetup: Object.fromEntries(
        Object.entries(aSummary?.perSetup || {}).map(([setup, details]) => [
          setup,
          details.complete,
        ]),
      ),
      releaseGateSource:
        "Feng-Release-Readiness-Review.md, section 7 (Release gate)",
      source: "Extended UX-designer feng-ui-audit.mjs",
      date: new Date().toISOString(),
      beforeComplete: bSummary?.complete || false,
      afterComplete: aSummary?.complete || false,
      automatedLayoutGate: aSummary?.gate || "FAIL",
      singleImmutableBuild: aSummary?.singleImmutableBuild || false,
    },
  });
  console.log("[audit] report", report);
  if (aSummary?.gate !== "PASS") process.exitCode = 1;
}
