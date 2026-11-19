// holon-ui/runtime for a web page, a document of its own: package.json resolves to it unless the build sets mcp-app.
// The page calls its app over HTTP, and the browser's agent, if any, learns every tool through WebMCP, because nothing
// else tells it about them. https://webmachinelearning.github.io/webmcp/#dom-document-modelcontext
import { fromJsonSchema, getDisplayName, type Tool, type ToolAnnotations } from "@modelcontextprotocol/client";
import { bindApps, ToolCallError, type RuntimeClient } from "holon-sh/runtime";
import type { AnyPageTool, Runtime } from "./page.js";

export { bindApps, ToolCallError };
export type { AuthProvider, CallMetadata, CallOptions, Connect, ConnectOptions, Contract, CreateOptions, EndpointBinding, Identity, Opened, Page, PageTool, RuntimeClient, ToolClient, ToolResult } from "./page.js";

/** Bind the page to its own app on the surface its build chose, and offer every tool to whichever agent is present. Most pages call the generated connect from #holon-ui. */
export const connect: Runtime = async ({ identity, contracts, own, endpoint }, { tools = {}, batch = false, web = { endpoint } } = {}) => {
  const client = bindApps(identity, contracts, { [own]: { ...web, endpoint: new URL(web.endpoint, location.origin) } })[own];
  const lifetime = new AbortController();
  const context = globalThis.document?.modelContext;
  // Offering tools is secondary to the page working: the page does not wait for it, and a failure is only reported.
  // Aborting the lifetime unregisters every tool. https://webmachinelearning.github.io/webmcp/#dom-modelcontext-registertool
  if (context) {
    const { signal } = lifetime;
    const offered = new Map<string, ModelContextTool>();
    const register = (tool: ModelContextTool) => context.registerTool(tool, { signal }).then(() => true, error => console.warn(`WebMCP did not accept the tool ${tool.name}:`, error));
    const offer = async (tool: ModelContextTool) => await register(tool) && offered.set(tool.name, tool);
    const offers = Object.entries<AnyPageTool>(tools).map(([name, tool]) => offer(pageTool(name, tool)));
    const contracted = (name: string) => !contracts[own] || contracts[own].tools.some(tool => tool.name === name);
    const listed = client.listTools({ signal }).then(
      ({ tools: listed }) => {
        for (const tool of listed) {
          // MCP Apps: a tool whose visibility omits "model" must not reach the agent; absent means ["model", "app"].
          // https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx#resource-discovery
          // A typed client calls only its contract's tools, and an agent cannot write a file argument.
          if (!visibleToModel(tool) || !contracted(tool.name)) continue;
          const inputSchema = withoutFiles(tool.inputSchema);
          if (typeof inputSchema === "object" && inputSchema !== null) offers.push(offer(serverTool(own, client, tool, inputSchema)));
        }
      },
      error => signal.aborted || console.warn(`Could not list the tools of ${own} for WebMCP:`, error),
    );
    if (batch) listed.then(() => Promise.all(offers)).then(() => offered.size > 0 && register(batchTool(offered)));
  }
  return Object.freeze({ ...client, view: undefined, opened: undefined, close: async () => { lifetime.abort(); await client.close(); } });
};

function visibleToModel(tool: Tool): boolean {
  const ui = tool._meta?.ui;
  const visibility = typeof ui === "object" && ui !== null && "visibility" in ui ? ui.visibility ?? ["model"] : ["model"];
  return Array.isArray(visibility) && visibility.includes("model");
}

function pageTool(name: string, { description, inputSchema, outputSchema, annotations, execute }: AnyPageTool): ModelContextTool {
  const standard = inputSchema?.["~standard"];
  const output = outputSchema?.["~standard"];
  return {
    name, title: annotations?.title, description, annotations: hints(annotations),
    inputSchema: standard?.jsonSchema.input({ target: "draft-2020-12" }),
    outputSchema: output?.jsonSchema.output({ target: "draft-2020-12" }),
    execute: async (input, { signal }) => {
      const parsed = standard ? await standard.validate(input) : { value: {} };
      if (parsed.issues) throw new Error(`Invalid arguments for ${name}: ${JSON.stringify(parsed.issues)}`);
      const result = await execute(parsed.value, { signal });
      const checked = output ? await output.validate(result) : { value: result };
      if (checked.issues) throw new Error(`Invalid output for ${name}: ${JSON.stringify(checked.issues)}`);
      return checked.value;
    },
  };
}

function serverTool(own: string, client: RuntimeClient, tool: Tool, inputSchema: object): ModelContextTool {
  return {
    // MCP lets a tool go without a description; WebMCP requires one.
    name: tool.name, title: tool.title ?? tool.annotations?.title, description: tool.description || getDisplayName(tool),
    inputSchema, outputSchema: tool.outputSchema, annotations: hints(tool.annotations),
    execute: async (input, { signal }) => {
      const result = await client.callTool({ name: tool.name, arguments: input }, { signal });
      // An agent can only supply arguments, so it cannot answer a question the server asks back.
      if (result.resultType === "input_required" || result.isError) throw new ToolCallError(own, tool.name, result);
      return result.structuredContent ?? result.content;
    },
  };
}

type Calls = { calls: { tool: string; input: Record<string, unknown> }[] };

function batchTool(offered: Map<string, ModelContextTool>): ModelContextTool {
  const call = { type: "object", properties: { tool: { enum: [...offered.keys()] }, input: { type: "object" } }, required: ["tool", "input"] };
  const inputSchema = { type: "object", properties: { calls: { type: "array", items: call } }, required: ["calls"] };
  const { validate } = fromJsonSchema<Calls>(inputSchema)["~standard"];
  const members = Object.fromEntries(offered);
  const hinted = Object.values(members).map(tool => tool.annotations);
  return {
    name: "call_tools",
    description: "Run several of this page's tools in order, in one call. Stops at the first that fails, and returns the outputs before it and its error.",
    inputSchema,
    annotations: {
      readOnlyHint: hinted.every(hint => hint.readOnlyHint),
      consequentialHint: hinted.some(hint => hint.consequentialHint),
      untrustedContentHint: hinted.some(hint => hint.untrustedContentHint),
    },
    execute: async (input, client) => {
      const outputs = [];
      try {
        const parsed = await validate(input);
        if (parsed.issues) throw new Error(`Invalid arguments for call_tools: ${JSON.stringify(parsed.issues)}`);
        for (const { tool, input } of parsed.value.calls) {
          client.signal.throwIfAborted();
          outputs.push(await members[tool].execute(input, client));
        }
      } catch (error) {
        return { outputs, error: String(error) };
      }
      return { outputs };
    },
  };
}

// MCP's hints default to the cautious reading (not read-only, destructive, open-world); WebMCP's all default to false.
// So each MCP hint is read with its own default, then translated, and an unannotated tool stays consequential.
// https://modelcontextprotocol.io/specification/2026-07-28/schema#toolannotations
// https://webmachinelearning.github.io/webmcp/#dictdef-toolannotations
function hints(annotations?: ToolAnnotations): ModelContextTool["annotations"] {
  const readOnlyHint = annotations?.readOnlyHint === true;
  return { readOnlyHint, consequentialHint: !readOnlyHint && annotations?.destructiveHint !== false, untrustedContentHint: annotations?.openWorldHint !== false };
}

const FILE = Symbol("schema requires a file");

// An agent writes arguments as tokens, so it is not shown a file argument (x-mcp-file): an anyOf or oneOf branch that
// holds one is left out, and a tool that still has one is not exposed.
// https://github.com/modelcontextprotocol/experimental-ext-file-uploads/blob/main/specification/draft/file-uploads.md#file-arguments
function withoutFiles(node: unknown, key?: string): unknown {
  if (Array.isArray(node)) {
    const items = node.map(item => withoutFiles(item));
    if (!items.includes(FILE)) return items;
    if (key !== "anyOf" && key !== "oneOf") return FILE;
    const kept = items.filter(item => item !== FILE);
    return kept.length ? kept : FILE;
  }
  if (typeof node !== "object" || node === null) return node;
  if (Object.hasOwn(node, "x-mcp-file")) return FILE;
  const entries = Object.entries(node).map(([key, value]) => [key, withoutFiles(value, key)]);
  return entries.some(([, value]) => value === FILE) ? FILE : Object.fromEntries(entries);
}
