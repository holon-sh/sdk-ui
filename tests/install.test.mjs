import assert from "node:assert/strict";
import { test } from "node:test";
import { cpSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fixture, temporary } from "./helpers.mjs";

const repository = dirname(dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(readFileSync(join(repository, "package.json"), "utf8"));

test("the packed package installs, runs, and type-checks generated clients", async t => {
  const root = temporary(t);
  const packed = spawnSync("npm", ["pack", ".", "--ignore-scripts", "--json", "--pack-destination", root], { cwd: repository, encoding: "utf8" });
  assert.equal(packed.status, 0, packed.stderr);
  const [info] = JSON.parse(packed.stdout);
  const consumer = join(root, "consumer");
  mkdirSync(consumer);
  const dependencies = { "holon-ui": `file:${join(root, info.filename)}` };
  const devDependencies = { "@types/node": manifest.devDependencies["@types/node"], zod: manifest.devDependencies.zod };
  writeFileSync(join(consumer, "package.json"), JSON.stringify({ type: "module", private: true, imports: { "#holon-ui": "./generated/holon-ui/index.mjs" }, dependencies, devDependencies }));
  const installed = spawnSync("npm", ["install", "--no-audit", "--no-fund", "--prefer-offline"], { cwd: consumer, encoding: "utf8" });
  assert.equal(installed.status, 0, installed.stderr);
  // holon writes the clients into the project and maps #holon-ui to them; nothing is copied into node_modules.
  cpSync(fixture("checkout"), join(consumer, "generated/holon-ui"), { recursive: true });
  const { createApps } = await import(pathToFileURL(join(consumer, "generated/holon-ui/index.mjs")));
  assert.deepEqual(Object.keys(createApps({ orders: { endpoint: "https://orders.example/mcp" } })), ["orders"]);
  assert.throws(() => createApps({ missing: { endpoint: "https://orders.example/mcp" } }), /Unknown app binding: missing/);
  const source = join(consumer, "consumer.ts");
  writeFileSync(source, `import {App, createApps, exposeTools, registerPageTools, ToolCallError, type Apps, type Resources, type Inputs, type Outputs, type InputTypes, type OutputTypes} from "#holon-ui";
import type { EndpointBinding } from "holon-ui/runtime";
import {App as HostApp} from "@modelcontextprotocol/ext-apps";
import {z} from "zod";
const view = new App({name: "checkout-view", version: "1.0.0"}, {}, {autoResize: false});
const host: HostApp = view;
view.ontoolresult = ({structuredContent}) => structuredContent;
await view.connect();
(await view.tools.get_order({orderId:"own"})).total.toFixed();
const ownSummary: Resources["checkout"]["orders://summary"] = await view.resources["orders://summary"].read();
ownSummary.total.toFixed();
const full = await view.callTool({name: "get_order", arguments: {orderId: "own"}});
if (full.resultType === "complete" && !full.isError) full.structuredContent.total.toFixed();
// @ts-expect-error
view.tools.get_order({orderId:1});
// @ts-expect-error
view.tools.lookup;
await registerPageTools({
  move: {description: "Move", inputSchema: z.object({x: z.number()}), execute: ({x}) => x.toFixed()},
  // @ts-expect-error
  wrong: {description: "Wrong", inputSchema: z.object({x: z.number()}), execute: ({y}) => y},
}, {view: {registerTool: () => ({remove() {}})}, signal: new AbortController().signal});
const browser = createApps({orders:{endpoint:new URL("https://orders.example/mcp"),installationUID:"installation-one"},"with-hyphen":{endpoint:new URL("https://other.example/mcp")}});
(await browser.orders.tools.get_order({orderId:"browser"})).total.toFixed();
const own = createApps({checkout:{endpoint:new URL("https://checkout.example/mcp")}});
(await own.checkout.listTools()).tools[0]?.description?.toUpperCase();
if (await exposeTools(own.checkout, {signal: new AbortController().signal, execute: async (name, args) => name + JSON.stringify(args)})) await exposeTools(browser.orders);
// @ts-expect-error
createApps({orders:{}});
// @ts-expect-error
createApps({checkout:{host: view}});
// @ts-expect-error
own.orders;
const endpoint: EndpointBinding = {endpoint: "https://orders.example/mcp"};
const single = createApps({orders: endpoint});
const selected: Pick<Apps, "orders"> = single;
// @ts-expect-error
single["with-hyphen"];
// @ts-expect-error
createApps({missing:{endpoint:new URL("https://orders.example/mcp")}});
// @ts-expect-error
single.orders.tools.then;
const orderId: InputTypes["orders"]["get_order"]["OrderId"] = "ord";
const total: OutputTypes["orders"]["get_order"]["Total"] = 1;
// @ts-expect-error
const wrongId: InputTypes["orders"]["get_order"]["OrderId"] = total;
const input: Inputs["checkout"]["get_order"] = {orderId};
const output: Outputs["checkout"]["get_order"] = {total};
try { await view.tools.get_order(input); } catch (error) {
  if (error instanceof ToolCallError) error.result.resultType.toUpperCase();
}
`);
  const compilerManifest = import.meta.resolve("typescript/package.json");
  const tsc = fileURLToPath(new URL(JSON.parse(readFileSync(new URL(compilerManifest), "utf8")).bin.tsc, compilerManifest));
  // Check declarations with Bundler resolution; retain NodeNext's library-skipping consumer check.
  for (const options of [["--module", "esnext", "--moduleResolution", "bundler"], ["--module", "nodenext", "--skipLibCheck"]]) {
    const checked = spawnSync(process.execPath, [tsc, "--noEmit", "--strict", "--target", "es2023", "--types", "node", ...options, source], { cwd: consumer, encoding: "utf8" });
    assert.equal(checked.status, 0, checked.stdout + checked.stderr);
  }
});
