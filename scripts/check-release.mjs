import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/** Only the current bundled entry counts; older changelog versions are permitted. */
export function validateReleaseMetadata(
  packageData,
  lockData,
  modelText,
  releaseText,
  tag,
) {
  const modelVersion = /export const APP_VERSION\s*=\s*["']([^"']+)["']/.exec(
    modelText,
  )?.[1];
  const currentEntry =
    /export const CURRENT_RELEASE(?:\s*:[^=]+)?\s*=\s*\{([^]*?)\n\};/.exec(
      releaseText,
    )?.[1];
  const currentVersion =
    currentEntry &&
    /version:\s*(APP_VERSION|["']([^"']+)["'])/.exec(currentEntry);
  if (
    !/^\d+\.\d+\.\d+$/.test(packageData.version ?? "") ||
    modelVersion !== packageData.version ||
    lockData.version !== packageData.version ||
    lockData.packages?.[""]?.version !== packageData.version ||
    !currentVersion ||
    (currentVersion[2] && currentVersion[2] !== packageData.version)
  ) {
    throw new Error(
      "Package, lockfile, application and current What's new versions must match.",
    );
  }
  const date =
    currentEntry &&
    /date:\s*["'](\d{4}-\d{2}-\d{2})["']/.exec(currentEntry)?.[1];
  if (
    !date ||
    Number.isNaN(new Date(`${date}T00:00:00Z`).getTime()) ||
    new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date
  ) {
    throw new Error("The current What's new entry needs a valid release date.");
  }
  if (tag && tag !== `v${packageData.version}`) {
    throw new Error("The release Git tag must match the application version.");
  }
  return packageData.version;
}

export function checkRelease() {
  const tagIndex = process.argv.indexOf("--tag");
  const tag = tagIndex >= 0 ? process.argv[tagIndex + 1] : undefined;
  if (tagIndex >= 0 && !tag) throw new Error("A Git tag must follow --tag.");
  const version = validateReleaseMetadata(
    JSON.parse(readFileSync("package.json", "utf8")),
    JSON.parse(readFileSync("package-lock.json", "utf8")),
    readFileSync("src/domain/models.ts", "utf8"),
    readFileSync("src/beta/release.ts", "utf8"),
    tag,
  );
  if (process.argv.includes("--require-tag")) {
    const tags = execFileSync("git", ["tag", "--points-at", "HEAD"], {
      encoding: "utf8",
    })
      .trim()
      .split("\n");
    if (!tags.includes(`v${version}`))
      throw new Error(
        "A matching release Git tag is required on the release commit.",
      );
  }
  process.stdout.write(
    `Release metadata matches Feng ${version}${tag ? ` (${tag})` : ""}.\n`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    checkRelease();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Release metadata failed."}\n`,
    );
    process.exitCode = 1;
  }
}
