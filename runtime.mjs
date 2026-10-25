import { App } from "@modelcontextprotocol/ext-apps";
import { createApps as create, bindApps as bind, ToolCallError } from "holon-core";

export { ToolCallError };

// An MCP Apps host binding routes the app's calls through the host that embeds this view.
const session = (name, binding) => binding.host && {
  callTool: (request, { signal, timeout } = {}) => binding.host.callServerTool(request, { signal, timeout }),
  readResource: (request, { signal, timeout } = {}) => binding.host.readServerResource(request, { signal, timeout }),
  listTools: () => { throw new Error(`${name} is bound to its host; the host owns the tool catalog.`); },
};

export function createApps(identity, contracts, bindings, options) {
  return create(identity, contracts, bindings, { ...options, session });
}

export function bindApps(identity, contracts, bindings, options) {
  return bind(identity, contracts, bindings, { ...options, session });
}

// hostApps binds the app's own server (own, its key in contracts) through the MCP Apps host that
// embeds the page. The returned view is the App; it connects once, on the first call or on the
// page's own `await view.connect()`, so handlers set on it before either still see the first events.
export function hostApps(identity, contracts, own) {
  const view = new App({ name: identity.name, version: identity.version });
  const connect = view.connect.bind(view);
  let connected;
  view.connect = (...args) => (connected ??= connect(...args));
  const host = {
    callServerTool: async (request, options) => (await view.connect(), view.callServerTool(request, options)),
    readServerResource: async (request, options) => (await view.connect(), view.readServerResource(request, options)),
  };
  return { apps: bind(identity, contracts, { [own]: { host } }, { session }), view };
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
