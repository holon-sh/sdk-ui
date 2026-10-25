import { test } from "node:test";
import assert from "node:assert/strict";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { createApps, bindApps, exposeTools, registerPageTools } from "holon-ui/runtime";
import { serve } from "./helpers.mjs";

test("browser bindings call the app's own tools directly or through an MCP Apps host and expose them to WebMCP", { timeout: 10000 }, async t => {
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

  const calls = [];
  const host = {
    callServerTool: async (params, options) => { calls.push([params, options?.signal]); return params.arguments.id === "bad" ? { content: [], structuredContent: { total: "no" } } : { content: [{ type: "text", text: "hosted" }], structuredContent: { total: 9 } }; },
    readServerResource: async ({ uri }) => ({ contents: [{ uri, mimeType: "application/json", text: JSON.stringify({ total: 1 }) }] }),
  };
  const hosted = createApps(identity, { chat: contract }, { chat: { host } });
  assert.deepEqual(await hosted.chat.tools.get_order({ id: "x" }, { signal }), { total: 9 });
  assert.deepEqual(await hosted.chat.resources["orders://summary"].read(), { total: 1 });
  assert.deepEqual(calls, [[{ name: "get_order", arguments: { id: "x" } }, signal]]);
  await assert.rejects(hosted.chat.tools.get_order({ id: 1 }), /Invalid arguments/);
  await assert.rejects(exposeTools(hosted.chat), /bound to its host/);
  await hosted.chat.close();
});

test("host bindings cannot watch resources", async () => {
  const uri = "orders://summary";
  const contract = { tools: [], resources: [{ uri, outputSchema: z.toJSONSchema(z.object({ total: z.number() })) }] };
  const hosted = createApps({ name: "script", version: "1", requires: {} }, { orders: contract }, { orders: { host: { callServerTool: async () => ({}), readServerResource: async () => ({ contents: [{ text: '{"total":3}' }] }) } } });
  await assert.rejects(hosted.orders.resources[uri].watch(() => {}), /endpoint binding/);
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
  const host = { callServerTool: () => assert.fail("invalid arguments reached the host"), readServerResource: () => assert.fail("unexpected read") };
  const apps = bindApps({ name: "checkout", version: "1", requires: {} }, contracts, { orders: { host } }, { validator });
  await assert.rejects(apps.orders.tools.get({}), /Invalid arguments for orders\.get: \["rejected"\]/);
  assert.deepEqual(schemas, [{ type: "object" }]);
});
