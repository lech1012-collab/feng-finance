import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectCaptureEvidence } from "./feng-polish-audit-evidence.mjs";
import { readFile } from "node:fs/promises";

test("inventory counts and unique state IDs agree with the screenshots required by the gate", async () => {
  const inventory = JSON.parse(
    await readFile(
      new URL("./feng-polish-screen-inventory.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(inventory.count, inventory.states.length);
  assert.equal(
    new Set(inventory.states.map((state) => state.id)).size,
    inventory.count,
  );
});

async function fixture(run) {
  const directory = await mkdtemp(join(tmpdir(), "feng-audit-evidence-"));
  try {
    await writeFile(join(directory, "screen.png"), "synthetic test bytes");
    const row = {
      setup: "iphone390-dark",
      id: "home-empty",
      phase: "after",
      metrics: {
        entryScript: "/assets/index-same-build.js",
        stylesheets: ["/assets/index-same-build.css"],
        sceneReady: true,
      },
      audit: { axe: { passes: 25 } },
      image: "screen.png",
      fullImage: "screen.png",
    };
    await run(directory, row);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
test("accepts identified real capture files with an executed accessibility audit", async () =>
  fixture(async (directory, row) => {
    assert.equal(
      (await inspectCaptureEvidence([row], directory, "after"))
        .completeEvidence,
      true,
    );
  }));
test("rejects mixed application builds even when all numeric issue counts are zero", async () =>
  fixture(async (directory, row) => {
    const other = {
      ...row,
      id: "transactions-empty",
      metrics: { entryScript: "/assets/index-other-build.js" },
    };
    const result = await inspectCaptureEvidence(
      [row, other],
      directory,
      "after",
    );
    assert.equal(result.singleImmutableBuild, false);
    assert.equal(result.completeEvidence, false);
  }));
test("rejects an after screenshot without a verified ready scene", async () =>
  fixture(async (directory, row) => {
    const result = await inspectCaptureEvidence(
      [{ ...row, metrics: { entryScript: row.metrics.entryScript } }],
      directory,
      "after",
    );
    assert.equal(result.unreadyCaptureStates.length, 1);
    assert.equal(result.completeEvidence, false);
  }));
test("rejects mixed or unidentified stylesheets even when JavaScript entry points match", async () =>
  fixture(async (directory, row) => {
    const changed = {
      ...row,
      id: "settings",
      metrics: {
        ...row.metrics,
        stylesheets: ["/assets/index-other-build.css"],
      },
    };
    const mixed = await inspectCaptureEvidence(
      [row, changed],
      directory,
      "after",
    );
    assert.equal(mixed.singleImmutableBuild, false);
    assert.equal(mixed.completeEvidence, false);
    const missing = await inspectCaptureEvidence(
      [
        {
          ...row,
          metrics: { entryScript: row.metrics.entryScript, sceneReady: true },
        },
      ],
      directory,
      "after",
    );
    assert.equal(missing.unidentifiedStylesheetStates.length, 1);
    assert.equal(missing.completeEvidence, false);
  }));
test("rejects a legacy capture without an identified entry script", async () =>
  fixture(async (directory, row) => {
    const result = await inspectCaptureEvidence(
      [{ ...row, metrics: {} }],
      directory,
      "after",
    );
    assert.equal(result.unidentifiedBuildStates.length, 1);
    assert.equal(result.completeEvidence, false);
  }));
test("rejects missing and empty screenshots instead of counting their JSON records as evidence", async () =>
  fixture(async (directory, row) => {
    await writeFile(join(directory, "empty.png"), "");
    const result = await inspectCaptureEvidence(
      [{ ...row, image: "missing.png", fullImage: "empty.png" }],
      directory,
      "after",
    );
    assert.equal(result.missingScreenshots.length, 2);
    assert.equal(result.completeEvidence, false);
  }));
test("rejects a skipped axe run and an incorrectly labelled before capture", async () =>
  fixture(async (directory, row) => {
    const result = await inspectCaptureEvidence(
      [{ ...row, phase: "before", audit: { axe: { passes: 0 } } }],
      directory,
      "after",
    );
    assert.equal(result.missingAccessibilityStates.length, 1);
    assert.equal(result.mismatchedPhaseStates.length, 1);
    assert.equal(result.completeEvidence, false);
  }));
