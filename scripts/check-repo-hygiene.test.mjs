import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { blockedRepositoryPaths } from "./check-repo-hygiene.mjs";

test("rejects statements and CSV exports outside the synthetic fixture folder", () => {
  const paths = [
    "statement.PDF",
    "private/transactions.csv",
    "src/layout.pdf",
    "tests/fixtures/synthetic/barclays.pdf",
    "tests/fixtures/synthetic/synthetic.csv",
    "scripts/fixtures.mjs",
  ];
  assert.deepEqual(blockedRepositoryPaths(paths), paths.slice(0, 3));
});
test("blocks accidentally staged local secrets and portable financial backups", () => {
  const paths = [
    ".env",
    ".env.production",
    "credentials/id_ed25519",
    "tls/private.key",
    "backup.feng",
    "feng-finance-backup-2026-10-11.json",
    "private-fixtures/cells.txt",
  ];
  assert.deepEqual(blockedRepositoryPaths(paths), paths);
  assert.deepEqual(
    blockedRepositoryPaths([
      ".env.example",
      "README.md",
      "src/tests/synthetic.ts",
    ]),
    [],
  );
});
test("directory names that merely resemble fixture paths do not bypass the policy", () => {
  assert.equal(
    blockedRepositoryPaths(["tests/fixtures-personal/statement.pdf"]).length,
    1,
  );
});

test("the command inspects staged additions and allows removing an existing private file", () => {
  const directory = mkdtempSync(join(tmpdir(), "feng-hygiene-test-"));
  const script = fileURLToPath(
    new URL("./check-repo-hygiene.mjs", import.meta.url),
  );
  const git = (...args) =>
    execFileSync("git", args, { cwd: directory, stdio: "ignore" });
  const guard = (...args) =>
    spawnSync(process.execPath, [script, ...args], {
      cwd: directory,
      encoding: "utf8",
    });
  try {
    git("init");
    git("config", "user.email", "synthetic@example.test");
    git("config", "user.name", "Synthetic fixture test");
    mkdirSync(join(directory, "tests/fixtures/synthetic"), { recursive: true });
    writeFileSync(
      join(directory, "tests/fixtures/synthetic/synthetic.pdf"),
      "fictitious fixture",
    );
    git("add", ".");
    assert.equal(
      guard("--staged").status,
      0,
      JSON.stringify(guard("--staged")),
    );
    git("commit", "-m", "Synthetic fixture");
    writeFileSync(
      join(directory, "DO-NOT-EXPOSE-PRIVATE-NAME.csv"),
      "never inspect or print the contents",
    );
    git("add", ".");
    const blocked = guard("--staged");
    assert.equal(blocked.status, 1);
    assert.match(blocked.stderr, /Repository hygiene blocked/);
    assert.doesNotMatch(blocked.stderr, /DO-NOT-EXPOSE|never inspect/);
    git("commit", "-m", "Simulate historical private path");
    assert.equal(guard().status, 1);
    git("rm", "DO-NOT-EXPOSE-PRIVATE-NAME.csv");
    assert.equal(
      guard("--staged").status,
      0,
      JSON.stringify(guard("--staged")),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
