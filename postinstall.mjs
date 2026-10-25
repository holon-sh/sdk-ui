// Regeneration is best effort: installing this package must never require the CLI.
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

if (process.env.HOLON_SKIP_POSTINSTALL !== "1" && process.env.HOLON_POSTINSTALL_RUNNING !== "1") {
  try {
    const app = resolve(process.env.INIT_CWD || process.cwd());
    if (existsSync(join(app, "server.json"))) {
      spawnSync("holon", ["types", "generate", "--no-install", "--quiet"], {
        cwd: app,
        env: { ...process.env, HOLON_POSTINSTALL_RUNNING: "1" },
        stdio: "ignore",
        timeout: 120_000,
      });
    }
  } catch {
    // The user can run `holon types generate` after installation.
  }
}
