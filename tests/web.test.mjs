import { test } from "node:test";
import assert from "node:assert/strict";
import { fromJsonSchema, inputRequired, McpServer } from "@modelcontextprotocol/server";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import { connect } from "holon-ui/runtime";
import { serve } from "./helpers.mjs";

const identity = { name: "example.com/checkout", version: "1" };
const order = { input: z.strictObject({ id: z.string() }), output: z.object({ total: z.number() }) };
const getOrder = { name: "get_order", inputSchema: z.toJSONSchema(order.input, { io: "input" }), outputSchema: z.toJSONSchema(order.output) };

// Serves the page's own app at /mcp on the page's origin, with get_order and what register adds. Like a generated
// contract, the page's names the server's tools: get_order and those in contracted.
async function page(t, register = () => {}, contracted = []) {
  const { endpoint } = await serve(t, () => {
    const server = new McpServer({ name: "checkout", version: "1" });
    server.registerTool("get_order", { description: "Read one order", inputSchema: order.input, outputSchema: order.output, annotations: { readOnlyHint: true } }, async ({ id }) =>
      ({ content: [{ type: "text", text: id }], structuredContent: { total: id.length } }));
    register(server);
    return server;
  });
  globalThis.location = { origin: new URL(endpoint).origin };
  t.after(() => { delete globalThis.location; delete globalThis.document; });
  const contract = { tools: [getOrder, ...contracted.map(name => ({ name, inputSchema: { type: "object" } }))] };
  return async options => {
    const app = await connect({ identity, contracts: { checkout: contract }, own: "checkout", endpoint: "/mcp" }, options);
    t.after(() => app.close());
    return app;
  };
}

// The browser's WebMCP, which rejects the tools reject names. Offering runs after connect() resolves, so a test waits
// for the tools it expects.
function modelContext(reject = () => false) {
  const registered = new Map();
  let arrived = () => {};
  globalThis.document = { modelContext: { registerTool: async (tool, options) => {
    if (reject(tool)) throw new DOMException("Duplicate tool name", "InvalidStateError");
    registered.set(tool.name, { tool, options });
    arrived();
  } } };
  const until = async (...names) => {
    while (!names.every(name => registered.has(name))) await new Promise(resolve => { arrived = resolve; });
  };
  return { registered, until };
}

function warnings(t) {
  const messages = [];
  let warned;
  t.mock.method(console, "warn", message => { messages.push(message); warned(); });
  return { messages, next: () => new Promise(resolve => { warned = resolve; }) };
}

test("a web page calls its own app over HTTP", async t => {
  const app = await (await page(t))();
  assert.equal(app.view, undefined);
  assert.equal(app.opened, undefined);
  assert.deepEqual(await app.tools.get_order({ id: "abc" }), { total: 3 });
});

test("a web page offers its own tools and the app's model-visible tools to WebMCP until it closes", async t => {
  const connect = await page(t, server => {
    server.registerTool("unannotated", { title: "Unannotated" }, async () => ({ content: [] }));
    server.registerTool("safe", { annotations: { title: "Safe", destructiveHint: false, openWorldHint: false } }, async () => ({ content: [] }));
    server.registerTool("uncontracted", { description: "Added after the contract was generated" }, async () => ({ content: [] }));
    for (const [name, visibility] of [["both", ["model", "app"]], ["view_only", ["app"]], ["nobody", []]]) registerAppTool(server, name, { description: name, _meta: { ui: { visibility } } }, async () => ({ content: [] }));
  }, ["unannotated", "safe", "both", "view_only", "nobody"]);
  const { registered, until } = modelContext();
  const app = await connect({ tools: {
    select: { description: "Select shapes", inputSchema: z.object({ ids: z.array(z.string()) }), annotations: { title: "Select", openWorldHint: false }, execute: () => ({}) },
    selection: { description: "List selected shapes", annotations: { readOnlyHint: true }, execute: () => ({}) },
  } });
  await until("get_order", "unannotated", "safe", "both");
  assert.deepEqual([...registered.keys()].sort(), ["both", "get_order", "safe", "select", "selection", "unannotated"]);

  const fields = name => {
    const { title, description, inputSchema, outputSchema, annotations } = registered.get(name).tool;
    return { title, description, input: Object.keys(inputSchema?.properties ?? {}), output: Boolean(outputSchema), annotations };
  };
  // MCP's hints read with their own defaults, then translated: unannotated means consequential and untrusted.
  const hints = (readOnlyHint, consequentialHint, untrustedContentHint) => ({ readOnlyHint, consequentialHint, untrustedContentHint });
  assert.deepEqual(fields("get_order"), { title: undefined, description: "Read one order", input: ["id"], output: true, annotations: hints(true, false, true) });
  assert.deepEqual(fields("unannotated"), { title: "Unannotated", description: "Unannotated", input: [], output: false, annotations: hints(false, true, true) });
  assert.deepEqual(fields("safe"), { title: "Safe", description: "Safe", input: [], output: false, annotations: hints(false, false, false) });
  assert.deepEqual(fields("select"), { title: "Select", description: "Select shapes", input: ["ids"], output: false, annotations: hints(false, true, false) });
  assert.deepEqual(fields("selection"), { title: undefined, description: "List selected shapes", input: [], output: false, annotations: hints(true, false, true) });

  await app.close();
  assert.ok([...registered.values()].every(({ options }) => options.signal.aborted));
});

test("an agent is not shown file arguments, which it cannot write", async t => {
  const file = { type: "object", "x-mcp-file": {}, properties: { id: { type: "string" } }, required: ["id"] };
  const schemas = {
    upload: { type: "object", properties: { file } },
    linked: { type: "object", properties: { file: { $ref: "#/$defs/file" } }, $defs: { file } },
    source: { type: "object", properties: { source: { anyOf: [{ type: "string" }, { type: "array", items: file }] } } },
  };
  const connect = await page(t, server => {
    for (const [name, inputSchema] of Object.entries(schemas)) server.registerTool(name, { description: name, inputSchema: fromJsonSchema(inputSchema) }, async () => ({ content: [] }));
  }, Object.keys(schemas));
  const { registered, until } = modelContext();
  await connect();
  await until("get_order", "source");
  assert.deepEqual([...registered.keys()].sort(), ["get_order", "source"]);
  assert.deepEqual(registered.get("source").tool.inputSchema.properties, { source: { anyOf: [{ type: "string" }] } });
});

test("an agent's call to an app tool returns its output, fails as the tool did, and stops when cancelled", async t => {
  let started, aborted;
  const cancelled = new Promise(resolve => { aborted = resolve; });
  const connect = await page(t, server => {
    server.registerTool("text_only", {}, async () => ({ content: [{ type: "text", text: "plain" }] }));
    server.registerTool("broken", {}, async () => ({ isError: true, content: [{ type: "text", text: "out of stock" }] }));
    server.registerTool("ship", {}, async () => inputRequired({ inputRequests: {
      size: inputRequired.elicit({ message: "Which size should I ship?", requestedSchema: z.object({ size: z.string() }) }),
    } }));
    server.registerTool("slow", {}, ({ mcpReq: { signal } }) => new Promise(resolve => {
      started();
      signal.addEventListener("abort", () => { aborted(); resolve({ content: [] }); });
    }));
  }, ["text_only", "broken", "ship", "slow"]);
  const { registered, until } = modelContext();
  await connect();
  await until("get_order", "text_only", "broken", "ship", "slow");
  const execute = (name, input, signal = new AbortController().signal) => registered.get(name).tool.execute(input, { signal });

  assert.deepEqual(await execute("get_order", { id: "abcd" }), { total: 4 });
  assert.deepEqual(await execute("text_only", undefined), [{ type: "text", text: "plain" }]);
  // An agent can only supply arguments, so a question the server asks back fails the call too.
  for (const name of ["broken", "ship"]) await assert.rejects(execute(name, {}), { name: "ToolCallError" }, name);

  const cancel = new AbortController();
  const slow = execute("slow", {}, cancel.signal);
  await new Promise(resolve => { started = resolve; });
  const rejected = assert.rejects(slow);
  cancel.abort();
  await Promise.all([cancelled, rejected]);
});

test("an agent's call to a page tool runs it with validated input and the agent's signal", async t => {
  const connect = await page(t);
  const { registered } = modelContext();
  const calls = [];
  await connect({ tools: {
    move: { description: "Move", inputSchema: z.object({ x: z.number().max(1) }), execute: (input, { signal }) => { calls.push([input, signal]); return { moved: input.x }; } },
    reset: { description: "Reset", execute: (input, { signal }) => { calls.push([input, signal]); } },
  } });
  const signal = new AbortController().signal;
  assert.deepEqual(await registered.get("move").tool.execute({ x: 1 }, { signal }), { moved: 1 });
  await assert.rejects(registered.get("move").tool.execute({ x: 2 }, { signal }));
  assert.equal(await registered.get("reset").tool.execute({ ignored: true }, { signal }), undefined);
  assert.deepEqual(calls, [[{ x: 1 }, signal], [{}, signal]]);
});

test("a tool WebMCP rejects is reported, and the others are still offered", async t => {
  const connect = await page(t, server => server.registerTool("second", { description: "Second" }, async () => ({ content: [] })), ["second"]);
  const { registered, until } = modelContext(tool => tool.name === "get_order");
  const { messages, next } = warnings(t);
  const warned = next();
  await connect({ tools: { local: { description: "Local", execute: () => {} } } });
  await Promise.all([warned, until("local", "second")]);
  assert.match(messages[0], /get_order/);
  assert.deepEqual([...registered.keys()].sort(), ["local", "second"]);
});

test("an app that cannot be listed is reported, and the page's own tools are still offered", async t => {
  const { registered } = modelContext();
  globalThis.location = { origin: "http://127.0.0.1:1" };
  t.after(() => { delete globalThis.location; delete globalThis.document; });
  const { messages, next } = warnings(t);
  const warned = next();
  const app = await connect({ identity, contracts: { checkout: { tools: [getOrder] } }, own: "checkout", endpoint: "/mcp" }, { tools: { local: { description: "Local", execute: () => {} } } });
  t.after(() => app.close());
  await warned;
  assert.equal(messages.length, 1);
  assert.deepEqual([...registered.keys()], ["local"]);
});
