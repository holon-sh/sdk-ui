import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
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

test("the packed package installs with registry dependencies and its placeholder types resolve", async t => {
  const root = temporary(t);
  const info = pack(".", root);
  const paths = info.files.map(file => file.path).sort();
  for (const path of ["generated/index.js", "runtime.mjs", "app.js", "react.js", "state.js", "build.mjs", "src/browser.tsx", "src/host.ts"]) assert.ok(paths.includes(path), path);
  assert.ok(paths.every(path => !path.includes("node_modules/")));
  const consumer = join(root, "consumer");
  mkdirSync(consumer);
  const dependencies = { "holon-ui": `file:${join(root, info.filename)}` };
  writeFileSync(join(consumer, "package.json"), JSON.stringify({ type: "module", private: true, dependencies }));
  const installed = spawnSync("npm", ["install", "--no-audit", "--no-fund", "--prefer-offline"], { cwd: consumer, encoding: "utf8" });
  assert.equal(installed.status, 0, installed.stderr);
  const directory = join(consumer, "node_modules/holon-ui");
  const metadata = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
  assert.deepEqual(metadata.holon, { slot: "generated", contractVersion: 1 });
  assert.ok(metadata.dependencies["holon-sh"]);
  assert.deepEqual(JSON.parse(readFileSync(join(directory, "generated/holon-generated.json"), "utf8")), { marker: "holon-generated-apps-v1", placeholder: true });
  const placeholder = await import(pathToFileURL(join(directory, "generated/index.js")));
  assert.deepEqual(Object.keys(placeholder.createApps({})), []);
  assert.throws(() => placeholder.createApps({ unknown: { endpoint: "https://example.com/mcp" } }), /Unknown app binding/);
  const source = join(consumer, "consumer.ts");
  writeFileSync(source, `import { createApps, registerPageTools, type Apps } from "holon-ui";
import type { EndpointBinding } from "holon-ui/runtime";
const empty: Apps = createApps({});
const orders: EndpointBinding = { endpoint: "https://orders.example/mcp" };
await registerPageTools({});
// @ts-expect-error the placeholder has no bindings
createApps({orders});
`);
  typecheck(source);
});

test("the runtime and generated clients are browser modules", () => {
  for (const file of [join(repository, "runtime.mjs"), join(fixture("checkout"), "index.js"), join(repository, "generated/index.js")]) {
    assert.doesNotMatch(readFileSync(file, "utf8"), /\bprocess\.|from "node:/, file);
  }
});
