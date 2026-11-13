import { test } from "node:test";
import assert from "node:assert/strict";
import { fromJsonSchema, inputRequired, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { connect, ToolCallError } from "holon-ui/runtime";
import { serve } from "./helpers.mjs";

const identity = { name: "example.com/checkout", version: "1" };
const order = { input: z.strictObject({ id: z.string() }), output: z.object({ total: z.number() }) };
const empty = async () => ({ content: [] });

// Serves the page's own app at /mcp on the page's origin: get_order and tools, each [config, handler], all in the
// page's contract as a generated one would have them, and what register adds outside it. With origin, the app is
// somewhere the page cannot reach.
async function page(t, tools = {}, { register = () => {}, origin } = {}) {
  const served = { get_order: [{ description: "Read one order", inputSchema: order.input, outputSchema: order.output, annotations: { readOnlyHint: true } }, async ({ id }) => ({ content: [{ type: "text", text: id }], structuredContent: { total: id.length } })], ...tools };
  origin ??= new URL((await serve(t, () => {
    const server = new McpServer({ name: "checkout", version: "1" });
    for (const [name, [config, handler]] of Object.entries(served)) server.registerTool(name, config, handler);
    register(server);
    return server;
  })).endpoint).origin;
  globalThis.location = { origin };
  t.after(() => { delete globalThis.location; });
  const contract = { tools: Object.keys(served).map(name => ({ name, inputSchema: { type: "object" }, ...(name === "get_order" && { outputSchema: z.toJSONSchema(order.output) }) })) };
  return async options => {
    const app = await connect({ identity, contracts: { checkout: contract }, own: "checkout", endpoint: "/mcp" }, options);
    t.after(() => app.close());
    return app;
  };
}

// The browser's WebMCP, rejecting the tools reject picks. Offering runs after connect() resolves, so a test waits for
// the tools it expects.
function modelContext(t, reject = () => false) {
  const registered = new Map();
  let arrived = () => {};
  globalThis.document = { modelContext: { registerTool: async (tool, options) => {
    if (reject(tool)) throw new DOMException("Duplicate tool name", "InvalidStateError");
    registered.set(tool.name, { tool, options });
    arrived();
  } } };
  t.after(() => { delete globalThis.document; });
  const until = async (...names) => {
    while (!names.every(name => registered.has(name))) await new Promise(resolve => { arrived = resolve; });
  };
  return { registered, until };
}

test("a web page calls its own app over HTTP", async t => {
  const app = await (await page(t))();
  assert.equal(app.view, undefined);
  assert.equal(app.opened, undefined);
  assert.deepEqual(await app.tools.get_order({ id: "abc" }), { total: 3 });
});

test("a web page offers its own tools and the app's model-visible tools to WebMCP until it closes", async t => {
  const connect = await page(t, {
    unannotated: [{ title: "Unannotated" }, empty],
    safe: [{ annotations: { title: "Safe", destructiveHint: false, openWorldHint: false } }, empty],
    both: [{ description: "Both", _meta: { ui: { visibility: ["model", "app"] } } }, empty],
    view_only: [{ description: "View only", _meta: { ui: { visibility: ["app"] } } }, empty],
    nobody: [{ description: "Nobody", _meta: { ui: { visibility: [] } } }, empty],
  }, { register: server => server.registerTool("uncontracted", { description: "Added after the contract was generated" }, empty) });
  const { registered, until } = modelContext(t);
  const app = await connect({ tools: {
    select: { description: "Select shapes", inputSchema: z.object({ ids: z.array(z.string()) }), annotations: { title: "Select", openWorldHint: false }, execute: () => ({}) },
    selection: { description: "List selected shapes", annotations: { readOnlyHint: true }, execute: () => ({}) },
  } });
  // MCP's hints read with their own defaults, then translated: unannotated means consequential and untrusted. A tool
  // without a description is described by its title.
  const hints = (readOnlyHint, consequentialHint, untrustedContentHint) => ({ readOnlyHint, consequentialHint, untrustedContentHint });
  const offered = {
    get_order: { title: undefined, description: "Read one order", input: ["id"], output: true, annotations: hints(true, false, true) },
    unannotated: { title: "Unannotated", description: "Unannotated", input: [], output: false, annotations: hints(false, true, true) },
    safe: { title: "Safe", description: "Safe", input: [], output: false, annotations: hints(false, false, false) },
    both: { title: undefined, description: "Both", input: [], output: false, annotations: hints(false, true, true) },
    select: { title: "Select", description: "Select shapes", input: ["ids"], output: false, annotations: hints(false, true, false) },
    selection: { title: undefined, description: "List selected shapes", input: [], output: false, annotations: hints(true, false, true) },
  };
  await until(...Object.keys(offered));
  const fields = ({ title, description, inputSchema, outputSchema, annotations }) => ({ title, description, input: Object.keys(inputSchema?.properties ?? {}), output: Boolean(outputSchema), annotations });
  assert.deepEqual(Object.fromEntries([...registered].map(([name, { tool }]) => [name, fields(tool)])), offered);

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
  const connect = await page(t, Object.fromEntries(Object.entries(schemas).map(([name, schema]) => [name, [{ description: name, inputSchema: fromJsonSchema(schema) }, empty]])));
  const { registered, until } = modelContext(t);
  await connect();
  await until("get_order", "source");
  assert.deepEqual([...registered.keys()].sort(), ["get_order", "source"]);
  assert.deepEqual(registered.get("source").tool.inputSchema.properties, { source: { anyOf: [{ type: "string" }] } });
});

test("an agent's call to an app tool returns its output, fails as the tool did, and stops when cancelled", async t => {
  let started;
  const connect = await page(t, {
    text_only: [{}, async () => ({ content: [{ type: "text", text: "plain" }] })],
    broken: [{}, async () => ({ isError: true, content: [{ type: "text", text: "out of stock" }] })],
    // An agent can only supply arguments, so it cannot answer a question the server asks back.
    ship: [{}, async () => inputRequired({ inputRequests: { size: inputRequired.elicit({ message: "Which size?", requestedSchema: z.object({ size: z.string() }) }) } })],
    slow: [{}, ({ mcpReq: { signal } }) => new Promise(resolve => { started(); signal.addEventListener("abort", () => resolve({ content: [] })); })],
  });
  const { registered, until } = modelContext(t);
  await connect();
  await until("get_order", "text_only", "broken", "ship", "slow");
  const execute = (name, input = {}, signal = new AbortController().signal) => registered.get(name).tool.execute(input, { signal });

  assert.deepEqual(await execute("get_order", { id: "abcd" }), { total: 4 });
  assert.deepEqual(await execute("text_only"), [{ type: "text", text: "plain" }]);
  for (const name of ["broken", "ship"]) await assert.rejects(execute(name), ToolCallError, name);

  const cancel = new AbortController();
  const begun = new Promise(resolve => { started = resolve; });
  const slow = execute("slow", {}, cancel.signal);
  await begun;
  cancel.abort();
  await assert.rejects(slow);
});

test("an agent's call to a page tool runs it with validated input and the agent's signal", async t => {
  const connect = await page(t);
  const { registered } = modelContext(t);
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

test("a failure to offer a tool is reported once, and the others are still offered", async t => {
  let warned;
  const warnings = t.mock.method(console, "warn", () => warned());
  for (const { failure, origin, reject = () => false, offered } of [
    { failure: "WebMCP rejects a tool", reject: tool => tool.name === "get_order", offered: ["local", "second"] },
    { failure: "the app cannot be listed", origin: "http://127.0.0.1:1", offered: ["local"] },
  ]) {
    warnings.mock.resetCalls();
    const reported = new Promise(resolve => { warned = resolve; });
    const connect = await page(t, { second: [{ description: "Second" }, empty] }, { origin });
    const { registered, until } = modelContext(t, reject);
    await connect({ tools: { local: { description: "Local", execute: () => {} } } });
    await Promise.all([reported, until(...offered)]);
    assert.equal(warnings.mock.callCount(), 1, failure);
    assert.deepEqual([...registered.keys()].sort(), offered, failure);
  }
});
