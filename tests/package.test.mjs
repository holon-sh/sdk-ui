import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, copyFileSync, symlinkSync, cpSync, mkdirSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { App } from "@modelcontextprotocol/ext-apps";
import { fixture, temporary, typecheck } from "./helpers.mjs";

const repository = dirname(dirname(fileURLToPath(import.meta.url)));

// Lay out a project with the CLI-compiled clients in generated/holon-ui and this repository's holon-ui
// installed beside the repository's holon-sh.
function install(root) {
  cpSync(fixture("checkout"), join(root, "generated/holon-ui"), { recursive: true });
  const directory = join(root, "node_modules/holon-ui");
  mkdirSync(directory, { recursive: true });
  for (const name of ["runtime.mjs", "runtime.d.ts", "package.json"]) copyFileSync(join(repository, name), join(directory, name));
  symlinkSync(realpathSync(join(repository, "node_modules/holon-sh")), join(root, "node_modules/holon-sh"));
  symlinkSync(realpathSync(join(repository, "node_modules/@modelcontextprotocol")), join(root, "node_modules/@modelcontextprotocol"));
}

test("ordinary NodeNext and Bundler compilation enforces browser bindings, page tools, and tool contracts", async t => {
  const root = temporary(t);
  install(root);
  symlinkSync(realpathSync(join(repository, "node_modules/zod")), join(root, "node_modules/zod"));
  writeFileSync(join(root, "package.json"), '{"type":"module"}');
  const source = `import {App, createApps, exposeTools, registerPageTools, ToolCallError, type Resources, type Inputs, type Outputs, type InputTypes, type OutputTypes} from "./generated/holon-ui/index.js";
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
try { await view.tools.get_order(input); } catch (error) {
  if (error instanceof ToolCallError) error.result.resultType.toUpperCase();
}
`;
  writeFileSync(join(root, "check.ts"), source);
  typecheck(join(root, "check.ts"));
  const { createApps, App: View } = await import(pathToFileURL(join(root, "generated/holon-ui/index.js")));
  const view = new View({ name: "checkout-view", version: "1" });
  assert.ok(view instanceof App);
  assert.equal(typeof view.tools.get_order, "function");
  const apps = createApps({ orders: { endpoint: "https://orders.example/mcp" } });
  assert.deepEqual(Object.keys(apps), ["orders"]);
  assert.equal(await apps.orders.tools, apps.orders.tools);
  assert.throws(() => createApps({ missing: { endpoint: "https://orders.example/mcp" } }), /Unknown app binding: missing/);
});
