import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryTransport, inputRequired, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { App } from "@modelcontextprotocol/ext-apps";
import { AppBridge } from "@modelcontextprotocol/ext-apps/app-bridge";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { bindApps, appClass, exposeTools, registerPageTools } from "holon-ui/runtime";
import { serve } from "./helpers.mjs";

test("endpoint bindings call tools directly and expose them to WebMCP", { timeout: 10000 }, async t => {
  const input = z.strictObject({ id: z.string() });
  const output = z.object({ total: z.number() });
  const { endpoint } = await serve(t, () => {
    const server = new McpServer({ name: "chat", version: "1" });
    server.registerTool("get_order", { description: "Read one order", inputSchema: input, annotations: { readOnlyHint: true } }, async ({ id }) =>
      ({ content: [{ type: "text", text: id }], structuredContent: { total: id.length } }));
    return server;
  });
  t.after(() => { delete globalThis.document; });
  const contract = { tools: [{ name: "get_order", inputSchema: z.toJSONSchema(input, { io: "input" }), outputSchema: z.toJSONSchema(output) }] };
  const direct = bindApps({ name: "chat-web", version: "1" }, { chat: contract }, { chat: { endpoint } });
  t.after(() => direct.chat.close());
  assert.deepEqual(await direct.chat.tools.get_order({ id: "abc" }), { total: 3 });
  assert.equal(await exposeTools(direct.chat), false);
  const registered = [];
  globalThis.document = { modelContext: { registerTool: async (tool, options) => { registered.push({ tool, options }); } } };
  const signal = new AbortController().signal;
  assert.equal(await exposeTools(direct.chat, { signal }), true);
  assert.deepEqual(registered.map(({ tool, options }) => [tool.name, tool.description, tool.annotations.readOnlyHint, options.signal]), [["get_order", "Read one order", true, signal]]);
  const executed = await registered[0].tool.execute({ id: "abcd" });
  assert.equal(executed.resultType, "complete");
  assert.deepEqual(executed.structuredContent, { total: 4 });
  const custom = [];
  await exposeTools(direct.chat, { execute: async (name, args) => { custom.push([name, args]); return "custom"; } });
  assert.equal(await registered[1].tool.execute({ id: "z" }), "custom");
  assert.deepEqual(custom, [["get_order", { id: "z" }]]);
});

test("exposeTools registers only the tools visible to the model", { timeout: 10000 }, async t => {
  const { endpoint } = await serve(t, () => {
    const server = new McpServer({ name: "orders", version: "1" });
    server.registerTool("unspecified", {}, async () => ({ content: [] }));
    for (const [name, visibility] of [["both", ["model", "app"]], ["view_only", ["app"]], ["nobody", []]]) {
      registerAppTool(server, name, { _meta: { ui: { visibility } } }, async () => ({ content: [] }));
    }
    return server;
  });
  const registered = [];
  globalThis.document = { modelContext: { registerTool: async tool => { registered.push(tool.name); } } };
  t.after(() => { delete globalThis.document; });
  const apps = bindApps({ name: "checkout", version: "1", requires: {} }, { orders: { tools: [] } }, { orders: { endpoint } });
  t.after(() => apps.orders.close());
  await exposeTools(apps.orders);
  assert.deepEqual(registered, ["unspecified", "both"]);
});

test("exposeTools tells the agent about a question it cannot answer", { timeout: 10000 }, async t => {
  const { endpoint } = await serve(t, () => {
    const server = new McpServer({ name: "orders", version: "1" });
    server.registerTool("ship", {}, async () => inputRequired({ inputRequests: {
      size: inputRequired.elicit({ message: "Which size should I ship?", requestedSchema: z.object({ size: z.string() }) }),
    } }));
    return server;
  });
  const registered = [];
  globalThis.document = { modelContext: { registerTool: async tool => { registered.push(tool); } } };
  t.after(() => { delete globalThis.document; });
  const apps = bindApps({ name: "checkout", version: "1", requires: {} }, { orders: null }, { orders: { endpoint } });
  t.after(() => apps.orders.close());
  await exposeTools(apps.orders);
  await assert.rejects(registered[0].execute({}), { name: "ToolCallError", message: "page.ship: additional input required: Which size should I ship?" });
});

test("exposeTools keeps file arguments and returned files away from the agent", async t => {
  const file = { type: "object", "x-mcp-file": {}, properties: { id: { type: "string" } }, required: ["id"] };
  const tools = [
    { name: "upload", inputSchema: { type: "object", properties: { file } } },
    { name: "linked", inputSchema: { type: "object", properties: { file: { $ref: "#/$defs/file" } }, $defs: { file } } },
    { name: "source", inputSchema: { type: "object", properties: { source: { anyOf: [{ type: "string" }, { type: "array", items: file }] } } } },
  ];
  const registered = [];
  globalThis.document = { modelContext: { registerTool: async tool => { registered.push(tool); } } };
  t.after(() => { delete globalThis.document; });
  const app = { listTools: async () => ({ tools }), callTool: async () => ({ resultType: "complete", content: [], downloads: [{ blob: async () => new Blob() }] }) };
  await exposeTools(app);
  assert.deepEqual(registered.map(({ name, inputSchema }) => [name, inputSchema]), [["source", { type: "object", properties: { source: { anyOf: [{ type: "string" }] } } }]]);
  assert.deepEqual(await registered[0].execute({ source: "notes.txt" }), { resultType: "complete", content: [] });
});

test("the App class calls the app's own tools and resources through a real MCP Apps host", async t => {
  const input = z.strictObject({ id: z.string() });
  const summary = z.toJSONSchema(z.object({ total: z.number() }));
  const contract = { tools: [{ name: "get_order", inputSchema: z.toJSONSchema(input, { io: "input" }), outputSchema: summary }], resources: [{ uri: "orders://summary", outputSchema: summary }] };
  const View = appClass({ name: "example.com/checkout", version: "1", requires: {} }, { checkout: contract }, "checkout");
  const view = new View({ name: "checkout-view", version: "1" }, {}, { autoResize: false });
  assert.ok(view instanceof App);
  const bridge = new AppBridge(null, { name: "host", version: "1" }, {});
  const served = [];
  bridge.oncalltool = async ({ name, arguments: args }) => { served.push([name, args]); return args.id === "bad" ? { content: [], structuredContent: { total: "no" } } : { content: [], structuredContent: { total: args.id.length } }; };
  bridge.onreadresource = async ({ uri }) => ({ contents: [{ uri, mimeType: "application/json", text: JSON.stringify({ total: 1 }) }] });
  const [viewTransport, hostTransport] = InMemoryTransport.createLinkedPair();
  await bridge.connect(hostTransport);
  const results = [];
  view.ontoolresult = result => results.push(result.structuredContent);
  await view.connect(viewTransport);
  await bridge.sendToolResult({ content: [], structuredContent: { total: 1 } });
  assert.deepEqual(await view.tools.get_order({ id: "abc" }), { total: 3 });
  assert.deepEqual(await view.resources["orders://summary"].read(), { total: 1 });
  assert.equal((await view.callTool({ name: "get_order", arguments: { id: "abcd" } })).structuredContent.total, 4);
  await assert.rejects(view.tools.get_order({ id: "bad" }), /Invalid structured output from checkout\.get_order/);
  await assert.rejects(view.resources["orders://summary"].watch(() => {}), /endpoint binding/);
  assert.deepEqual(served, [["get_order", { id: "abc" }], ["get_order", { id: "abcd" }], ["get_order", { id: "bad" }]]);
  assert.deepEqual(results, [{ total: 1 }]);
  await view.close();
  await bridge.close();
});
test("a view introduces itself to its host as the app, unless told otherwise", async () => {
  const View = appClass({ name: "example.com/checkout", version: "1.2.0", requires: {} }, { checkout: null }, "checkout");
  for (const [info, introduced] of [[undefined, { name: "example.com/checkout", version: "1.2.0" }], [{ name: "checkout-view", version: "1" }, { name: "checkout-view", version: "1" }]]) {
    const view = new View(info, {}, { autoResize: false });
    const bridge = new AppBridge(null, { name: "host", version: "1" }, {});
    const [viewTransport, hostTransport] = InMemoryTransport.createLinkedPair();
    await bridge.connect(hostTransport);
    await view.connect(viewTransport);
    assert.deepEqual(bridge.getAppVersion(), introduced);
    await view.close();
    await bridge.close();
  }
});


test("page tools register with the MCP Apps host when embedded and with WebMCP when standalone", async t => {
  t.after(() => { delete globalThis.document; });
  const schema = z.object({ x: z.number().min(0).max(1) });
  const calls = [];
  const tools = { move: { description: "Move", inputSchema: schema, annotations: { readOnlyHint: false }, execute: ({ x }) => { calls.push(x); return { content: [{ type: "text", text: String(x) }] }; } } };
  const hosted = [];
  let removed = 0;
  const view = { registerTool: (name, config, callback) => { hosted.push({ name, config, callback }); return { remove: () => { removed += 1; } }; } };
  const controller = new AbortController();
  assert.equal(await registerPageTools(tools, { view, signal: controller.signal }), true);
  assert.equal(hosted.length, 1);
  assert.equal(hosted[0].config.inputSchema, schema);
  assert.deepEqual(hosted[0].callback({ x: 0.5 }), { content: [{ type: "text", text: "0.5" }] });
  controller.abort();
  assert.equal(removed, 1);

  assert.equal(await registerPageTools(tools), false);
  const registered = [];
  globalThis.document = { modelContext: { registerTool: async (tool, options) => { registered.push({ tool, options }); } } };
  const signal = new AbortController().signal;
  assert.equal(await registerPageTools(tools, { signal }), true);
  assert.equal(registered[0].options.signal, signal);
  assert.deepEqual([registered[0].tool.name, registered[0].tool.description, registered[0].tool.inputSchema.properties.x.maximum], ["move", "Move", 1]);
  assert.deepEqual(await registered[0].tool.execute({ x: 1 }), { content: [{ type: "text", text: "1" }] });
  await assert.rejects(registered[0].tool.execute({ x: 2 }), /Invalid arguments for move/);
  assert.deepEqual(calls, [0.5, 1]);
});
