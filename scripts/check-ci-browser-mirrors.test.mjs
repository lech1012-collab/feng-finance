import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readFileSync,
  writeFileSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

test("browser setup updates GitHub's separate APT mirror list as well as both source formats", () => {
  const root = mkdtempSync(join(tmpdir(), "feng-ci-mirrors-"));
  try {
    const apt = join(root, "apt");
    mkdirSync(join(apt, "sources.list.d"), { recursive: true });
    const url = "http://azure.archive.ubuntu.com/ubuntu";
    const inputs = {
      "sources.list": `deb ${url} noble main\n`,
      "sources.list.d/ubuntu.sources": `Types: deb\nURIs: mirror+file:/etc/apt/apt-mirrors.txt\nSuites: noble\nComponents: main\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n`,
      "apt-mirrors.txt": `${url}\n`,
      "apt-mirrors-security.txt": `${url}\n`,
    };
    for (const [name, content] of Object.entries(inputs))
      writeFileSync(join(apt, name), content);
    const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
    const block = workflow.match(/for source_file in [\s\S]*?^\s+done/m)?.[0];
    assert.ok(block, "Browser installation must configure the archive sources");
    execFileSync("bash", [
      "-eu",
      "-c",
      `sudo() { "$@"; }\n${block.replaceAll("/etc/apt", apt)}`,
    ]);
    for (const [name, original] of Object.entries(inputs)) {
      assert.equal(
        readFileSync(join(apt, name), "utf8"),
        original.replaceAll(url, "https://archive.ubuntu.com/ubuntu"),
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
