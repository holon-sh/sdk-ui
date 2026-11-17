// holon-ui/runtime for a web page, a document of its own: package.json resolves to it unless the build sets mcp-app.
// The page calls its app over HTTP, and the browser's agent, if any, learns every tool through WebMCP, because nothing
// else tells it about them. https://webmachinelearning.github.io/webmcp/#dom-document-modelcontext
import { getDisplayName } from "@modelcontextprotocol/client";
import { bindApps, ToolCallError } from "holon-sh/runtime";

export { bindApps, ToolCallError };

export async function connect({ identity, contracts, own, endpoint }, { tools = {} } = {}) {
  const client = bindApps(identity, contracts, { [own]: { endpoint: new URL(endpoint, location.origin) } })[own];
  const lifetime = new AbortController();
  const context = globalThis.document?.modelContext;
  // Offering tools is secondary to the page working: the page does not wait for it, and a failure is only reported.
  // Aborting the lifetime unregisters every tool. https://webmachinelearning.github.io/webmcp/#dom-modelcontext-registertool
  if (context) {
    const { signal } = lifetime;
    const offer = tool => context.registerTool(tool, { signal }).catch(error => console.warn(`WebMCP did not accept the tool ${tool.name}:`, error));
    for (const [name, tool] of Object.entries(tools)) offer(pageTool(name, tool));
    const contracted = name => !contracts[own] || contracts[own].tools.some(tool => tool.name === name);
    client.listTools({ signal }).then(
      ({ tools: listed }) => {
        for (const tool of listed) {
          // MCP Apps: a tool whose visibility omits "model" must not reach the agent; absent means ["model", "app"].
          // https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx#resource-discovery
          // A typed client calls only its contract's tools, and an agent cannot write a file argument.
          if (!(tool._meta?.ui?.visibility ?? ["model"]).includes("model") || !contracted(tool.name)) continue;
          const inputSchema = withoutFiles(tool.inputSchema);
          if (inputSchema !== FILE) offer(serverTool(own, client, tool, inputSchema));
        }
      },
      error => signal.aborted || console.warn(`Could not list the tools of ${own} for WebMCP:`, error),
    );
  }
  return Object.freeze({ ...client, view: undefined, opened: undefined, close: async () => { lifetime.abort(); await client.close(); } });
}

function pageTool(name, { description, inputSchema, annotations, execute }) {
  const standard = inputSchema?.["~standard"];
  return {
    name, title: annotations?.title, description, annotations: hints(annotations),
    inputSchema: standard?.jsonSchema.input({ target: "draft-2020-12" }),
    execute: async (input, { signal }) => {
      const parsed = standard ? await standard.validate(input) : { value: {} };
      if (parsed.issues) throw new Error(`Invalid arguments for ${name}: ${JSON.stringify(parsed.issues)}`);
      return execute(parsed.value, { signal });
    },
  };
}

function serverTool(own, client, tool, inputSchema) {
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

// MCP's hints default to the cautious reading (not read-only, destructive, open-world); WebMCP's all default to false.
// So each MCP hint is read with its own default, then translated, and an unannotated tool stays consequential.
// https://modelcontextprotocol.io/specification/2026-07-28/schema#toolannotations
// https://webmachinelearning.github.io/webmcp/#dictdef-toolannotations
function hints(annotations) {
  const readOnlyHint = annotations?.readOnlyHint === true;
  return { readOnlyHint, consequentialHint: !readOnlyHint && annotations?.destructiveHint !== false, untrustedContentHint: annotations?.openWorldHint !== false };
}

const FILE = Symbol("schema requires a file");

// An agent writes arguments as tokens, so it is not shown a file argument (x-mcp-file): an anyOf or oneOf branch that
// holds one is left out, and a tool that still has one is not exposed.
// https://github.com/modelcontextprotocol/experimental-ext-file-uploads/blob/main/specification/draft/file-uploads.md#file-arguments
function withoutFiles(node, key) {
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
