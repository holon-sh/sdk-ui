import assert from "node:assert/strict";
import { test } from "node:test";
import { cpSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fixture, temporary, typecheck } from "./helpers.mjs";

const repository = dirname(dirname(fileURLToPath(import.meta.url)));

function pack(directory, destination) {
  const packed = spawnSync("npm", ["pack", directory, "--ignore-scripts", "--json", "--pack-destination", destination], { cwd: repository, encoding: "utf8" });
  assert.equal(packed.status, 0, packed.stderr);
  return JSON.parse(packed.stdout)[0];
}

test("the packed package installs with registry dependencies and runs the project's generated clients", async t => {
  const root = temporary(t);
  const info = pack(".", root);
  const paths = info.files.map(file => file.path).sort();
  assert.deepEqual(paths, ["LICENSE", "README.md", "package.json", "runtime.d.ts", "runtime.mjs"]);
  const consumer = join(root, "consumer");
  mkdirSync(consumer);
  const dependencies = { "holon-ui": `file:${join(root, info.filename)}` };
  writeFileSync(join(consumer, "package.json"), JSON.stringify({ type: "module", private: true, dependencies }));
  const installed = spawnSync("npm", ["install", "--no-audit", "--no-fund", "--prefer-offline"], { cwd: consumer, encoding: "utf8" });
  assert.equal(installed.status, 0, installed.stderr);
  const metadata = JSON.parse(readFileSync(join(consumer, "node_modules/holon-ui/package.json"), "utf8"));
  assert.deepEqual(metadata.holon, { contractVersion: 2 });
  assert.deepEqual(Object.keys(metadata.dependencies), ["holon-sh"]);
  // holon writes the clients into the project; nothing is copied into node_modules.
  cpSync(fixture("checkout"), join(consumer, "generated/holon-ui"), { recursive: true });
  const { createApps } = await import(pathToFileURL(join(consumer, "generated/holon-ui/index.js")));
  assert.deepEqual(Object.keys(createApps({ orders: { endpoint: "https://orders.example/mcp" } })), ["orders"]);
  const source = join(consumer, "consumer.ts");
  writeFileSync(source, `import { createApps, registerPageTools, type Apps } from "./generated/holon-ui/index.js";
import type { EndpointBinding } from "holon-ui/runtime";
const orders: EndpointBinding = { endpoint: "https://orders.example/mcp" };
const apps: Pick<Apps, "orders"> = createApps({ orders });
await registerPageTools({});
// @ts-expect-error not a dependency
createApps({ missing: orders });
`);
  typecheck(source);
});

test("the runtime and generated clients are browser modules", () => {
  for (const file of [join(repository, "runtime.mjs"), join(fixture("checkout"), "index.js")]) {
    assert.doesNotMatch(readFileSync(file, "utf8"), /\bprocess\.|from "node:/, file);
  }
});
