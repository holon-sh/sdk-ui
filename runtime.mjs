import { App } from "@modelcontextprotocol/ext-apps";
import { bindApps, ToolCallError } from "holon-core";

export { ToolCallError };

export { createApps, bindApps } from "holon-core";

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

export async function exposeTools(app, options = {}) {
  const context = globalThis.document?.modelContext ?? globalThis.navigator?.modelContext;
  if (!context) return false;
  const { signal } = options;
  const execute = options.execute ?? ((name, args) => app.callTool({ name, arguments: args }, { signal }));
  const { tools } = await app.listTools({ signal });
  for (const tool of tools) {
    await context.registerTool({
      name: tool.name, title: tool.title, description: tool.description ?? "", inputSchema: tool.inputSchema, annotations: tool.annotations,
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
