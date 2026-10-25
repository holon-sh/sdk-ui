import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
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

test("the packed package installs beside holon-core and its placeholder types resolve", async t => {
  const root = temporary(t);
  const info = pack(".", root);
  const paths = info.files.map(file => file.path).sort();
  assert.deepEqual(paths, ["LICENSE", "README.md", "generated/holon-generated.json", "generated/index.d.ts", "generated/index.js", "package.json", "postinstall.mjs", "runtime.d.ts", "runtime.mjs"]);
  // holon-core is packed from the installed copy until it is on npm; its own dependencies come from the npm cache or registry.
  const core = pack("./node_modules/holon-core", root);
  const consumer = join(root, "consumer");
  mkdirSync(consumer);
  const dependencies = { "holon-core": `file:${join(root, core.filename)}`, "holon-ui": `file:${join(root, info.filename)}` };
  writeFileSync(join(consumer, "package.json"), JSON.stringify({ type: "module", private: true, dependencies }));
  const installed = spawnSync("npm", ["install", "--no-audit", "--no-fund", "--prefer-offline"], { cwd: consumer, encoding: "utf8", env: { ...process.env, HOLON_SKIP_POSTINSTALL: "1" } });
  assert.equal(installed.status, 0, installed.stderr);
  const directory = join(consumer, "node_modules/holon-ui");
  const metadata = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
  assert.deepEqual(metadata.holon, { slot: "generated", contractVersion: 1 });
  assert.deepEqual(Object.keys(metadata.dependencies), ["holon-core"]);
  assert.deepEqual(JSON.parse(readFileSync(join(directory, "generated/holon-generated.json"), "utf8")), { marker: "holon-generated-apps-v1", placeholder: true });
  const placeholder = await import(pathToFileURL(join(directory, "generated/index.js")));
  assert.deepEqual(Object.keys(placeholder.createApps({})), []);
  assert.throws(() => placeholder.createApps({ unknown: { endpoint: "https://example.com/mcp" } }), /Unknown app binding/);
  const source = join(consumer, "consumer.ts");
  writeFileSync(source, `import { createApps, registerPageTools, type Apps } from "holon-ui";
import type { HostBinding } from "holon-ui/runtime";
const empty: Apps = createApps({});
const host: HostBinding = { host: { callServerTool: async () => ({}), readServerResource: async () => ({}) } };
await registerPageTools({});
// @ts-expect-error the placeholder has no bindings
createApps({orders: host});
`);
  typecheck(source);
});

test("the runtime and generated clients are browser modules", () => {
  for (const file of [join(repository, "runtime.mjs"), join(fixture("checkout"), "index.js"), join(repository, "generated/index.js")]) {
    assert.doesNotMatch(readFileSync(file, "utf8"), /\bprocess\.|from "node:/, file);
  }
});

test("postinstall generates types for a server directory and never makes package installation fail", t => {
  const root = temporary(t);
  const nested = join(root, "app/nested");
  const bin = join(root, "bin");
  mkdirSync(nested, { recursive: true });
  mkdirSync(bin);
  const descriptor = join(nested, "server.json");
  const log = join(root, "invocation.json");
  writeFileSync(join(bin, "holon"), `#!${process.execPath}\nimport {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(log)},JSON.stringify({args:process.argv.slice(2), cwd:process.cwd(), guard:process.env.HOLON_POSTINSTALL_RUNNING})); process.exit(9);\n`, { mode: 0o755 });
  writeFileSync(join(bin, "package.json"), '{"type":"module"}');
  const run = env => spawnSync(process.execPath, [join(repository, "postinstall.mjs")], { cwd: nested, env: { ...process.env, INIT_CWD: nested, PATH: bin, HOLON_SKIP_POSTINSTALL: "", HOLON_POSTINSTALL_RUNNING: "", ...env }, encoding: "utf8" });
  // Without a server.json in INIT_CWD, nothing runs (ancestors are not searched).
  writeFileSync(join(root, "server.json"), "{}");
  assert.equal(run({}).status, 0);
  assert.equal(existsSync(log), false);
  writeFileSync(descriptor, "{}");
  assert.equal(run({}).status, 0);
  assert.deepEqual(JSON.parse(readFileSync(log, "utf8")), { args: ["types", "generate", "--no-install", "--quiet"], cwd: nested, guard: "1" });
  rmSync(log);
  for (const env of [{ HOLON_SKIP_POSTINSTALL: "1" }, { HOLON_POSTINSTALL_RUNNING: "1" }, { PATH: "" }]) {
    assert.equal(run(env).status, 0);
    assert.equal(existsSync(log), false);
  }
});
