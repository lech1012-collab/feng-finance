import { stat } from "node:fs/promises";
import { join } from "node:path";

/** Fail closed when a numeric zero is unsupported by a real capture. */
export async function inspectCaptureEvidence(rows, directory, phase) {
  const entryScripts = [
    ...new Set(rows.map((row) => row.metrics?.entryScript).filter(Boolean)),
  ];
  const identify = (row) => ({ setup: row.setup, state: row.id });
  const unidentifiedBuildStates = rows
    .filter((row) => !row.metrics?.entryScript)
    .map(identify);
  const missingAccessibilityStates = rows
    .filter((row) => !(row.audit?.axe?.passes > 0))
    .map(identify);
  const unreadyCaptureStates = rows
    .filter(
      (row) =>
        row.metrics?.sceneReady === false ||
        (phase === "after" && row.metrics?.sceneReady !== true),
    )
    .map(identify);
  const mismatchedPhaseStates = rows
    .filter((row) => row.phase !== phase)
    .map(identify);
  const missingScreenshots = (
    await Promise.all(
      rows.flatMap((row) =>
        [...new Set([row.image, row.fullImage])].map(async (file) => {
          try {
            if (!file) throw new Error("Missing image path");
            const details = await stat(join(directory, file));
            if (!details.isFile() || !details.size)
              throw new Error("Empty or invalid image");
            return undefined;
          } catch {
            return { ...identify(row), file: file || "not supplied" };
          }
        }),
      ),
    )
  ).filter(Boolean);
  const singleImmutableBuild =
    entryScripts.length === 1 && unidentifiedBuildStates.length === 0;
  return {
    entryScripts,
    unidentifiedBuildStates,
    singleImmutableBuild,
    missingAccessibilityStates,
    unreadyCaptureStates,
    mismatchedPhaseStates,
    missingScreenshots,
    completeEvidence:
      rows.length > 0 &&
      singleImmutableBuild &&
      !missingAccessibilityStates.length &&
      !unreadyCaptureStates.length &&
      !mismatchedPhaseStates.length &&
      !missingScreenshots.length,
  };
}
