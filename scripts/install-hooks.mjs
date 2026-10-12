import { execFileSync } from "node:child_process";

// CI also runs the tracked-file guard. A local hook blocks accidental uploads sooner.
if (!process.env.CI) {
  try {
    execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
      stdio: "ignore",
    });
    const current = (() => {
      try {
        return execFileSync(
          "git",
          ["config", "--local", "--get", "core.hooksPath"],
          { encoding: "utf8" },
        ).trim();
      } catch {
        return "";
      }
    })();
    if (!current || current === ".githooks") {
      execFileSync("git", ["config", "--local", "core.hooksPath", ".githooks"]);
      process.stdout.write("Local repository hygiene hook installed.\n");
    } else {
      process.stdout.write(
        "Existing Git hook configuration retained; CI still checks repository hygiene.\n",
      );
    }
  } catch {
    process.stdout.write(
      "No writable Git checkout detected; CI checks repository hygiene.\n",
    );
  }
}
