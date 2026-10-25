import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, copyFileSync, symlinkSync, cpSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import { fixture, temporary, typecheck } from "./helpers.mjs";

const repository = dirname(dirname(fileURLToPath(import.meta.url)));

// Install the holon-ui layout with either the CLI-compiled fixture or the built empty slot,
// next to the repository's installed holon-core.
function install(directory, generated) {
  cpSync(generated, join(directory, "generated"), { recursive: true });
  for (const name of ["runtime.mjs", "runtime.d.ts", "package.json"]) copyFileSync(join(repository, name), join(directory, name));
  symlinkSync(realpathSync(join(repository, "node_modules/holon-core")), join(dirname(directory), "holon-core"));
}

test("ordinary NodeNext and Bundler compilation enforces browser bindings, page tools, and tool contracts", async t => {
  const root = temporary(t);
  const directory = join(root, "node_modules/holon-ui");
  install(directory, fixture("checkout"));
  symlinkSync(realpathSync(join(repository, "node_modules/zod")), join(root, "node_modules/zod"));
  writeFileSync(join(root, "package.json"), '{"type":"module"}');
  const source = `import {createApps, exposeTools, registerPageTools, ToolCallError, type Resources, type Inputs, type Outputs, type InputTypes, type OutputTypes} from "holon-ui";
import type {HostBinding} from "holon-ui/runtime";
import {z} from "zod";
await registerPageTools({
  move: {description: "Move", inputSchema: z.object({x: z.number()}), execute: ({x}) => x.toFixed()},
  // @ts-expect-error
  wrong: {description: "Wrong", inputSchema: z.object({x: z.number()}), execute: ({y}) => y},
}, {view: {registerTool: () => ({remove() {}})}, signal: new AbortController().signal});
const browser = createApps({orders:{endpoint:new URL("https://orders.example/mcp"),installationUID:"installation-one"},"with-hyphen":{endpoint:new URL("https://other.example/mcp")}});
(await browser.orders.tools.get_order({orderId:"browser"})).total.toFixed();
const host: HostBinding["host"] = {callServerTool: async (params: {name: string; arguments?: Record<string, unknown>}, options?: {signal?: AbortSignal}) => ({content: [], params, options}), readServerResource: async (params: {uri: string}) => ({contents: [], params})};
const own = createApps({checkout:{host}});
(await own.checkout.tools.get_order({orderId:"host"})).total.toFixed();
const ownSummary: Resources["checkout"]["orders://summary"] = await own.checkout.resources["orders://summary"].read();
ownSummary.total.toFixed();
(await own.checkout.listTools()).tools[0]?.description?.toUpperCase();
if (await exposeTools(own.checkout, {signal: new AbortController().signal, execute: async (name, args) => name + JSON.stringify(args)})) await exposeTools(browser.orders);
// @ts-expect-error
createApps({orders:{}});
// @ts-expect-error
own.checkout.tools.get_order({orderId:1});
// @ts-expect-error
own.orders;
const single = createApps({orders:{endpoint:new URL("https://orders.example/mcp")}});
(await single.orders.tools.get_order({orderId:"single"})).total.toFixed();
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
try { await own.checkout.tools.get_order(input); } catch (error) {
  if (error instanceof ToolCallError) error.code.toUpperCase();
}
`;
  writeFileSync(join(root, "check.ts"), source);
  typecheck(join(root, "check.ts"));
  const isolated = join(root, "other-app");
  install(join(isolated, "node_modules/holon-ui"), join(repository, "generated"));
  writeFileSync(join(isolated, "check.ts"), `import {createApps} from "holon-ui";\ncreateApps({});\n// @ts-expect-error\ncreateApps({orders: {endpoint: "https://orders.example/mcp"}});`);
  typecheck(join(isolated, "check.ts"), [ts.ModuleResolutionKind.NodeNext]);
  const { createApps } = await import(pathToFileURL(join(directory, "generated/index.js")));
  const apps = createApps({ orders: { endpoint: "https://orders.example/mcp" } });
  assert.deepEqual(Object.keys(apps), ["orders"]);
  assert.equal(await apps.orders.tools, apps.orders.tools);
  assert.throws(() => createApps({ missing: { endpoint: "https://orders.example/mcp" } }), /Unknown app binding: missing/);
});
