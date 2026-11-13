import assert from "node:assert/strict";
import { test } from "node:test";
import { copyFileSync, cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fixture, temporary } from "./helpers.mjs";

const repository = dirname(dirname(fileURLToPath(import.meta.url)));

test("the packed package installs, runs, and type-checks generated clients", async t => {
  const root = temporary(t);
  const packed = execFileSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", root], {
    cwd: repository,
    encoding: "utf8",
  });
  const [tarball] = JSON.parse(packed);
  const consumer = join(root, "consumer");
  mkdirSync(consumer);
  const { devDependencies } = JSON.parse(readFileSync(join(repository, "package.json"), "utf8"));
  writeFileSync(join(consumer, "package.json"), JSON.stringify({
    type: "module",
    private: true,
    imports: { "#holon-ui": "./generated/holon-ui/index.mjs" },
    dependencies: { "holon-ui": `file:${join(root, tarball.filename)}` },
    devDependencies: {
      "@types/node": devDependencies["@types/node"],
      typescript: devDependencies.typescript,
      zod: devDependencies.zod,
    },
  }));
  execFileSync("npm", ["install", "--no-audit", "--no-fund", "--prefer-offline"], {
    cwd: consumer,
    stdio: "inherit",
  });
  cpSync(fixture("checkout"), join(consumer, "generated/holon-ui"), { recursive: true });
  copyFileSync(fixture("consumer.ts"), join(consumer, "consumer.ts"));

  const { createApps } = await import(pathToFileURL(join(consumer, "generated/holon-ui/index.mjs")));
  const orders = { endpoint: "https://orders.example/mcp" };
  assert.deepEqual(Object.keys(createApps({ orders })), ["orders"]);
  assert.throws(() => createApps({ missing: orders }), /Unknown app binding: missing/);

  const tsc = [
    "exec", "--offline", "--", "tsc", "--noEmit", "--strict",
    "--target", "es2023", "--types", "node", "consumer.ts",
  ];
  // Declarations are checked once, under NodeNext, which is the stricter about their imports.
  execFileSync("npm", [...tsc, "--module", "esnext", "--moduleResolution", "bundler", "--skipLibCheck"], {
    cwd: consumer,
    stdio: "inherit",
  });
  execFileSync("npm", [...tsc, "--module", "nodenext"], {
    cwd: consumer,
    stdio: "inherit",
  });
});
