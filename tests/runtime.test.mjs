import { test } from "node:test";
import assert from "node:assert/strict";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { App } from "@modelcontextprotocol/ext-apps";
import { AppBridge } from "@modelcontextprotocol/ext-apps/app-bridge";
import { InMemoryTransport } from "@modelcontextprotocol/client";
import { createApps, bindApps, appClass, exposeTools, registerPageTools } from "holon-ui/runtime";
import { serve } from "./helpers.mjs";

test("endpoint bindings call tools directly and expose them to WebMCP", { timeout: 10000 }, async t => {
  const input = z.strictObject({ id: z.string() });
  const output = z.object({ total: z.number() });
  const { endpoint } = await serve(t, () => {
    const server = new McpServer({ name: "chat", version: "1" });
    server.registerTool("get_order", { description: "Read one order", inputSchema: input, annotations: { readOnlyHint: true } }, async ({ id }) =>
      ({ content: [{ type: "text", text: id }], structuredContent: { total: id.length } }));
    for (const [uri, total] of [["orders://summary", 3], ["orders://broken", "x"]]) {
      server.registerResource(uri, uri, { mimeType: "application/json" }, () => ({ contents: [{ uri, mimeType: "application/json", text: JSON.stringify({ total }) }] }));
    }
    return server;
  });
  t.after(() => { delete globalThis.document; });
  const summary = z.toJSONSchema(output);
  const contract = { tools: [{ name: "get_order", inputSchema: z.toJSONSchema(input, { io: "input" }), outputSchema: summary }], resources: [{ uri: "orders://summary", outputSchema: summary }, { uri: "orders://broken", outputSchema: summary }] };
  const identity = { name: "chat-web", version: "1", requires: {} };
  const unbound = createApps({ ...identity, requires: { chat: {} } }, { chat: contract });
  await assert.rejects(unbound.chat.tools.get_order({ id: "abc" }), { message: "Dependency chat is unavailable. Provide a binding." });
  const direct = createApps(identity, { chat: contract }, { chat: { endpoint } });
  t.after(() => direct.chat.close());
  assert.deepEqual(await direct.chat.tools.get_order({ id: "abc" }), { total: 3 });
  assert.deepEqual(await direct.chat.resources["orders://summary"].read(), { total: 3 });
  await assert.rejects(direct.chat.resources["orders://broken"].read(), /Invalid contents/);
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
  await assert.rejects(view.tools.get_order({ id: 1 }), /Invalid arguments/);
  await assert.rejects(view.tools.get_order({ id: "bad" }), /Invalid structured output from checkout\.get_order/);
  await assert.rejects(view.resources["orders://summary"].watch(() => {}), /endpoint binding/);
  assert.deepEqual(served, [["get_order", { id: "abc" }], ["get_order", { id: "abcd" }], ["get_order", { id: "bad" }]]);
  assert.deepEqual(results, [{ total: 1 }]);
  await view.close();
  await bridge.close();
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

test("createApps validates with the caller's validator when one is given", async () => {
  const schemas = [];
  const validator = schema => { schemas.push(schema); return Object.assign(() => false, { errors: ["rejected"] }); };
  const contracts = { orders: { tools: [{ name: "get", inputSchema: { type: "object" } }] } };
  const apps = bindApps({ name: "checkout", version: "1", requires: {} }, contracts, { orders: { endpoint: "https://orders.invalid/mcp" } }, { validator });
  await assert.rejects(apps.orders.tools.get({}), /Invalid arguments for orders\.get: \["rejected"\]/);
  assert.deepEqual(schemas, [{ type: "object" }]);
});
