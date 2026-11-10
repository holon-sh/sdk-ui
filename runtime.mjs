import { App } from "@modelcontextprotocol/ext-apps";
import { createApps as create, bindApps, ToolCallError } from "holon-sh/runtime";

export { ToolCallError };

export { bindApps };

// Browser clients have no process environment or host-wide default binding.
export function createApps(identity, contracts, bindings, options) {
  return create(identity, contracts, bindings, { ...options, resolve: () => undefined });
}

// appClass returns the ext-apps App with the app's own tools and resources (contracts[own]) typed.
// Calls go through the host that embeds the page, so connect the App first, as with any App.
export function appClass(identity, contracts, own) {
  return class extends App {
    #client = bindApps(identity, { [own]: contracts[own] }, { [own]: {} }, {
      session: () => ({
        callTool: (request, { signal, timeout } = {}) => this.callServerTool(request, { signal, timeout }),
        readResource: (request, { signal, timeout } = {}) => this.readServerResource(request, { signal, timeout }),
        listTools: () => { throw new Error("The host owns the tool catalog; bind an endpoint to list tools."); },
      }),
    })[own];
    get tools() { return this.#client.tools; }
    get resources() { return this.#client.resources; }
    callTool(request, options) { return this.#client.callTool(request, options); }
  };
}

const hasFile = node => Array.isArray(node) ? node.some(hasFile) : typeof node === "object" && node !== null && ("x-mcp-file" in node || Object.values(node).some(hasFile));

// An agent writes arguments as tokens, so it is not shown a file argument (x-mcp-file): an anyOf or oneOf branch that
// holds one is left out, and a tool that still has one is not exposed.
// https://github.com/modelcontextprotocol/experimental-ext-file-uploads/blob/main/specification/draft/file-uploads.md#file-arguments
function withoutFiles(schema) {
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
  const pruned = hasFile(schema) ? prune(schema) : schema;
  return hasFile(pruned) ? undefined : pruned;
}

export async function exposeTools(app, options = {}) {
  const context = globalThis.document?.modelContext ?? globalThis.navigator?.modelContext;
  if (!context) return false;
  const { signal } = options;
  const execute = options.execute ?? (async (name, args) => {
    const result = await app.callTool({ name, arguments: args }, { signal });
    // An agent can only supply arguments, so it cannot answer. A custom execute can.
    if (result.resultType === "input_required") throw new ToolCallError("page", name, result);
    // Fetching a returned file is the page's choice; a custom execute can.
    const { downloads, ...shown } = result;
    return shown;
  });
  const { tools } = await app.listTools({ signal });
  for (const tool of tools) {
    // MCP Apps: a tool whose visibility omits "model" must not reach the agent; absent means ["model", "app"].
    // https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx#resource-discovery
    if (!(tool._meta?.ui?.visibility ?? ["model"]).includes("model")) continue;
    const inputSchema = withoutFiles(tool.inputSchema);
    if (!inputSchema) continue;
    await context.registerTool({
      name: tool.name, title: tool.title, description: tool.description ?? "", inputSchema, annotations: tool.annotations,
      execute: args => execute(tool.name, args ?? {}),
    }, { signal });
  }
  return true;
}

export async function registerPageTools(tools, { view, signal } = {}) {
  const context = globalThis.document?.modelContext ?? globalThis.navigator?.modelContext;
  const removals = [];
  for (const [name, { description, inputSchema, annotations, execute }] of Object.entries(tools)) {
    if (view) {
      removals.push(view.registerTool(name, { description, inputSchema, annotations }, args => execute(args)).remove);
    } else if (context) {
      const standard = inputSchema["~standard"];
      await context.registerTool({
        name, description, annotations, inputSchema: standard.jsonSchema.input({ target: "draft-2020-12" }),
        execute: async args => {
          const parsed = await standard.validate(args ?? {});
          if (parsed.issues) throw new Error(`Invalid arguments for ${name}: ${JSON.stringify(parsed.issues)}`);
          return execute(parsed.value);
        },
      }, { signal });
    }
  }
  signal?.addEventListener("abort", () => { for (const remove of removals) remove(); }, { once: true });
  return Boolean(view || context);
}
