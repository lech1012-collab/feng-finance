import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const syntheticFolder = "tests/fixtures/synthetic/";

/** Inputs are tracked/staged relative repository paths, never file contents. */
export function blockedRepositoryPaths(paths) {
  return paths.filter((path) => {
    const normalized = path.replaceAll("\\", "/");
    if (/\.(?:pdf|csv)$/i.test(normalized))
      return !normalized.startsWith(syntheticFolder);
    return (
      /(?:^|\/)private-fixtures(?:\/|$)/i.test(normalized) ||
      (/(?:^|\/)\.env(?:\..+)?$/i.test(normalized) &&
        !normalized.endsWith(".env.example")) ||
      /(?:^|\/)(?:id_rsa|id_ed25519)$/i.test(normalized) ||
      /\.(?:feng|pem|key)$/i.test(normalized) ||
      /(?:^|\/)feng-finance-backup-.*\.json$/i.test(normalized) ||
      /(?:^|\/)Feng [^/]*\.json$/i.test(normalized)
    );
  });
}

export function checkRepositoryHygiene(staged = false) {
  const args = staged
    ? ["diff", "--cached", "--name-only", "--diff-filter=ACMRT", "-z"]
    : ["ls-files", "-z"];
  const paths = execFileSync("git", args, { encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
  const blocked = blockedRepositoryPaths(paths);
  if (blocked.length) {
    throw new Error(
      `Repository hygiene blocked ${blocked.length} file(s). PDFs and CSVs may only be committed under tests/fixtures/synthetic/ and must be synthetic. Private fixtures, backups and secrets must stay outside version control.`,
    );
  }
  return paths.length;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const checked = checkRepositoryHygiene(process.argv.includes("--staged"));
    process.stdout.write(
      `Repository hygiene passed (${checked} paths checked).\n`,
    );
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Repository hygiene failed."}\n`,
    );
    process.exitCode = 1;
  }
}
