import { App } from "@modelcontextprotocol/ext-apps";
import { bindApps, ToolCallError } from "holon-sh/runtime";
import { open } from "#surface";
import { withoutFiles } from "./surface.web.mjs";

export { bindApps, ToolCallError };

// connect binds the page to its own app on the surface its bundle was built for: package.json's imports map resolves
// #surface to the MCP Apps view under the mcp-app condition, which the view's build sets, and to a web page otherwise.
export async function connect({ identity, contracts, own, endpoint }, { tools = {}, view } = {}) {
  const contract = contracts[own] ?? null;
  // An agent could not tell a page tool from the app's tool of the same name.
  for (const name of Object.keys(tools)) {
    if (contract?.tools.some(tool => tool.name === name)) throw new Error(`Page tool ${name} has the name of a tool of ${own}.`);
  }
  const bind = binding => bindApps(identity, contracts, { [own]: binding })[own];
  const { client, ...surface } = await open({ identity, own, endpoint, contract, tools, view, bind });
  return Object.freeze({ ...client, ...surface });
}

// appClass returns the ext-apps App with the app's own tools and resources (contracts[own]) typed.
// Calls go through the host that embeds the page, so connect the App first, as with any App.
// Unless told otherwise, the page introduces itself to the host as the app.
export function appClass(identity, contracts, own) {
  return class extends App {
    constructor(info = { name: identity.name, version: identity.version }, ...rest) { super(info, ...rest); }
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

export async function exposeTools(app, options = {}) {
  const context = globalThis.document?.modelContext ?? globalThis.navigator?.modelContext;
  if (!context) return false;
  const { signal } = options;
  const execute = options.execute ?? (async (name, args) => {
    const result = await app.callTool({ name, arguments: args }, { signal });
    // An agent can only supply arguments, so it cannot answer. A custom execute can.
    if (result.resultType === "input_required") throw new ToolCallError("page", name, result);
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
