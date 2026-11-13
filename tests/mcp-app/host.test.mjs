// Run as a view runs in a host (see package.json's test script): built with the mcp-app and browser conditions, and
// under a content security policy without unsafe-eval, which MCP Apps hosts set.
import { test } from "node:test";
import assert from "node:assert/strict";
import { App } from "@modelcontextprotocol/ext-apps";
import { AppBridge } from "@modelcontextprotocol/ext-apps/app-bridge";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { z } from "zod";
import { connect } from "holon-ui/runtime";

const identity = { name: "example.com/checkout", version: "1.2.0" };
const summary = z.toJSONSchema(z.object({ total: z.number() }));
const contract = {
  tools: [{ name: "get_order", inputSchema: z.toJSONSchema(z.strictObject({ id: z.string() }), { io: "input" }), outputSchema: summary }],
  resources: [{ uri: "orders://summary", outputSchema: summary }],
};

// Opens the page as a view inside a real ext-apps host.
async function view(t, { hostContext, tools, contracts = { checkout: contract } } = {}) {
  const bridge = new AppBridge(null, { name: "host", version: "1" }, {}, { hostContext });
  const [viewTransport, hostTransport] = InMemoryTransport.createLinkedPair();
  await bridge.connect(hostTransport);
  const app = await connect({ identity, contracts, own: "checkout", endpoint: "/mcp/checkout" }, { tools, view: { transport: viewTransport, autoResize: false } });
  t.after(async () => { await app.close(); await bridge.close(); });
  return { app, bridge };
}

test("a view introduces itself as its app and calls the app through the host", async t => {
  const { app, bridge } = await view(t);
  const served = [];
  bridge.oncalltool = async ({ name, arguments: args }) => {
    served.push([name, args]);
    return { content: [], structuredContent: { total: args.id.length } };
  };
  bridge.onreadresource = async ({ uri }) => ({ contents: [{ uri, mimeType: "application/json", text: JSON.stringify({ total: 1 }) }] });
  assert.ok(app.view instanceof App);
  assert.deepEqual(bridge.getAppVersion(), { name: "example.com/checkout", version: "1.2.0" });
  assert.deepEqual(await app.tools.get_order({ id: "abc" }), { total: 3 });
  assert.deepEqual(served, [["get_order", { id: "abc" }]]);
  assert.deepEqual(await app.resources["orders://summary"].read(), { total: 1 });
  await assert.rejects(app.listTools(), /An MCP Apps host owns the tool catalog/);
});

test("the host's agent lists the page's tools and gets each outcome as an MCP result", async t => {
  // What execute returns or throws, and the result the host's agent gets for it.
  const outcomes = {
    object: [() => ({ moved: 1 }), { content: [{ type: "text", text: '{"moved":1}' }], structuredContent: { moved: 1 } }],
    text: [() => "done", { content: [{ type: "text", text: "done" }] }],
    nothing: [() => {}, { content: [] }],
    number: [() => 3, { content: [{ type: "text", text: "3" }] }],
    thrown: [() => { throw new Error("Nothing is selected."); }, { isError: true, content: [{ type: "text", text: "Nothing is selected." }] }],
  };
  let received;
  const tools = {
    move: {
      description: "Move the selection", inputSchema: z.object({ x: z.number().max(1) }), annotations: { title: "Move", destructiveHint: false },
      execute: (input, { signal }) => { received = [input, signal]; },
    },
    ...Object.fromEntries(Object.entries(outcomes).map(([name, [execute]]) => [name, { description: name, execute }])),
  };
  const { bridge } = await view(t, { tools });
  const listed = Object.fromEntries((await bridge.listTools({})).tools.map(tool => [tool.name, tool]));
  assert.deepEqual(Object.keys(listed).sort(), Object.keys(tools).sort());
  const { title, description, inputSchema, annotations } = listed.move;
  assert.deepEqual([title, description, inputSchema.properties.x.maximum, annotations], ["Move", "Move the selection", 1, { title: "Move", destructiveHint: false }]);

  await bridge.callTool({ name: "move", arguments: { x: 1 } });
  assert.deepEqual(received[0], { x: 1 });
  assert.ok(received[1] instanceof AbortSignal);
  for (const [name, [, expected]] of Object.entries(outcomes)) {
    const { content, structuredContent, isError } = await bridge.callTool({ name, arguments: {} });
    assert.deepEqual({ content, ...(structuredContent && { structuredContent }), ...(isError && { isError }) }, expected, name);
  }
});

test("opened is the call that opened the view, with what its tool returns", async t => {
  const toolInfo = { id: 1, tool: { name: "get_order", inputSchema: { type: "object" } } };
  const open = async (hostContext, send, contracts) => {
    const { app, bridge } = await view(t, { hostContext, contracts });
    await bridge.sendToolInput({ arguments: { id: "abc" } });
    await send(bridge);
    return app.opened;
  };
  assert.deepEqual(await open({ toolInfo }, bridge => bridge.sendToolResult({ content: [], structuredContent: { total: 3 } })), { tool: "get_order", input: { id: "abc" }, output: { total: 3 } });
  await assert.rejects(open({ toolInfo }, bridge => bridge.sendToolResult({ isError: true, content: [{ type: "text", text: "No such order." }] })), { name: "ToolCallError" });
  await assert.rejects(open({ toolInfo }, bridge => bridge.sendToolCancelled({ reason: "The person stopped it." })), { message: "The tool call that opened the view was cancelled: The person stopped it." });
  // Without toolInfo, the host does not say which tool it was, so the call comes as delivered.
  assert.deepEqual(await open({}, bridge => bridge.sendToolResult({ content: [], structuredContent: { total: 3 } })), { tool: undefined, input: { id: "abc" }, output: { total: 3 } });
  // A page without a contract knows every tool by name, and takes the call as delivered.
  const failed = { isError: true, content: [{ type: "text", text: "No such order." }] };
  assert.deepEqual(await open({ toolInfo }, bridge => bridge.sendToolResult(failed), { checkout: null }), { tool: "get_order", input: { id: "abc" }, output: failed });
});

test("an opening call that fails is no unhandled rejection when the page ignores it", async t => {
  const unhandled = [];
  const record = reason => unhandled.push(reason);
  process.on("unhandledRejection", record);
  t.after(() => process.off("unhandledRejection", record));
  const { bridge } = await view(t);
  await bridge.sendToolCancelled({});
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(unhandled, []);
});

test("close closes the view", async t => {
  const { app, bridge } = await view(t);
  const closed = new Promise(resolve => { bridge.onclose = resolve; });
  await app.close();
  await closed;
});
