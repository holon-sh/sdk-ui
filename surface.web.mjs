// The web surface: the page is a document of its own. It calls its app over HTTP, and the browser's agent, if any,
// learns every tool through WebMCP, because nothing else tells it about them.
// https://webmachinelearning.github.io/webmcp/#dom-document-modelcontext
import { getDisplayName } from "@modelcontextprotocol/client";
import { ToolCallError } from "holon-sh/runtime";

export async function open({ own, endpoint, contract, tools, bind }) {
  const client = bind({ endpoint: new URL(endpoint, location.origin) });
  const lifetime = new AbortController();
  const context = globalThis.document?.modelContext;
  // Offering tools to an agent is secondary to the page working, so the page does not wait for it.
  if (context) void offer(context, { own, contract, tools, client, signal: lifetime.signal });
  // Aborting the lifetime unregisters every tool offered.
  return { client, close: async () => { lifetime.abort(); await client.close(); } };
}

async function offer(context, { own, contract, tools, client, signal }) {
  // A tool WebMCP rejects is reported, not thrown. registerTool rejects a duplicate name, an empty name or
  // description, or a schema it cannot serialize: https://webmachinelearning.github.io/webmcp/#dom-modelcontext-registertool
  const register = tool => context.registerTool(tool, { signal }).catch(error => console.warn(`WebMCP did not accept the tool ${tool.name}:`, error));
  const pageTools = Object.entries(tools).map(([name, tool]) => register(pageTool(name, tool)));
  let listed;
  try {
    listed = (await client.listTools({ signal })).tools;
  } catch (error) {
    // A page closed meanwhile has nothing left to offer.
    if (signal.aborted) return;
    console.warn(`Could not list the tools of ${own} for WebMCP:`, error);
    listed = [];
  }
  const serverTools = listed.map(tool => serverTool(own, contract, client, tool)).filter(Boolean).map(register);
  await Promise.all([...pageTools, ...serverTools]);
}

function pageTool(name, { description, inputSchema, annotations, execute }) {
  const standard = inputSchema?.["~standard"];
  return {
    name, title: annotations?.title, description, annotations: hints(annotations),
    inputSchema: standard?.jsonSchema.input({ target: "draft-2020-12" }),
    execute: async (input, { signal }) => {
      if (!standard) return execute({}, { signal });
      const parsed = await standard.validate(input ?? {});
      if (parsed.issues) throw new Error(`Invalid arguments for ${name}: ${JSON.stringify(parsed.issues)}`);
      return execute(parsed.value, { signal });
    },
  };
}

function serverTool(own, contract, client, tool) {
  // MCP Apps: a tool whose visibility omits "model" must not reach the agent; absent means ["model", "app"].
  // https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx#resource-discovery
  if (!(tool._meta?.ui?.visibility ?? ["model"]).includes("model")) return undefined;
  // A typed client calls only the tools its contract names, so an agent is offered no other.
  if (contract && !contract.tools.some(({ name }) => name === tool.name)) return undefined;
  const inputSchema = withoutFiles(tool.inputSchema);
  if (!inputSchema) return undefined;
  return {
    // MCP lets a tool go without a description; WebMCP requires one.
    name: tool.name, title: tool.title ?? tool.annotations?.title, description: tool.description || getDisplayName(tool),
    inputSchema, outputSchema: tool.outputSchema, annotations: hints(tool.annotations),
    execute: async (input, { signal }) => {
      const result = await client.callTool({ name: tool.name, arguments: input ?? {} }, { signal });
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

const hasFile = node => Array.isArray(node) ? node.some(hasFile) : typeof node === "object" && node !== null && ("x-mcp-file" in node || Object.values(node).some(hasFile));

// An agent writes arguments as tokens, so it is not shown a file argument (x-mcp-file): an anyOf or oneOf branch that
// holds one is left out, and a tool that still has one is not exposed.
// https://github.com/modelcontextprotocol/experimental-ext-file-uploads/blob/main/specification/draft/file-uploads.md#file-arguments
export function withoutFiles(schema) {
  if (!hasFile(schema)) return schema;
  const prune = node => {
    if (Array.isArray(node)) return node.map(prune);
    if (typeof node !== "object" || node === null) return node;
    const pruned = Object.fromEntries(Object.entries(node).map(([key, value]) => [key, prune(value)]));
    for (const key of ["anyOf", "oneOf"]) {
      const kept = Array.isArray(pruned[key]) ? pruned[key].filter(branch => !hasFile(branch)) : [];
      if (kept.length) pruned[key] = kept;
    }
    return pruned;
  };
  const pruned = prune(schema);
  return hasFile(pruned) ? undefined : pruned;
}
