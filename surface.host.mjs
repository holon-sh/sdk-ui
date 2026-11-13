// The host surface: the page is an MCP Apps view in a host's iframe. The host's agent already has the app's tools,
// because the host is the app's MCP client, so the view offers it only the page's own tools, and the view's calls to
// its app go through the host.
// https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx#standard-mcp-messages
import { App } from "@modelcontextprotocol/ext-apps";

export async function open({ identity, contract, tools, view: { transport, ...options } = {}, bind }) {
  const app = new App({ name: identity.name, version: identity.version }, {}, options);
  // Registered before connecting, so the view declares the tools capability in ui/initialize.
  for (const [name, { description, inputSchema, annotations, execute }] of Object.entries(tools)) {
    const run = async (input, { mcpReq: { signal } }) => {
      try {
        return toolResult(await execute(input, { signal }));
      } catch (error) {
        // A tool's own failure is a result the agent can read, not a protocol error.
        // https://modelcontextprotocol.io/specification/2026-07-28/server/tools#error-handling
        return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }] };
      }
    };
    // ext-apps validates input against inputSchema first, and calls a tool without one with the request context alone.
    app.registerTool(name, { title: annotations?.title, description, inputSchema, annotations }, inputSchema ? run : extra => run({}, extra));
  }
  // The host sends the call that opened the view once, right after the handshake, so listen before connecting.
  // https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx#data-passing
  const delivered = new Promise((resolve, reject) => {
    let input = {};
    app.addEventListener("toolinput", params => { input = params.arguments ?? {}; });
    app.addEventListener("toolresult", result => resolve({ input, result }));
    app.addEventListener("toolcancelled", ({ reason }) => reject(new Error(`The tool call that opened the view was cancelled${reason ? `: ${reason}` : "."}`)));
  });
  await app.connect(transport);
  const client = bind({ session: {
    callTool: (request, { signal, timeout }) => app.callServerTool(request, { signal, timeout }),
    readResource: (request, { signal, timeout }) => app.readServerResource(request, { signal, timeout }),
    listTools: async () => { throw new Error("An MCP Apps host owns the tool catalog, so a view cannot list tools."); },
  } });
  // Replaying the delivered result through the app's own client gives exactly what calling the tool would have:
  // the same output validation, and the same ToolCallError for an error result.
  // The host may not say which tool it was. https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx#host-context-in-mcpuiinitializeresult
  // Without a typed method for it, the call comes as delivered; an untyped page knows every tool by name.
  const opened = delivered.then(async ({ input, result }) => {
    const tool = app.getHostContext()?.toolInfo?.tool.name;
    const replay = tool && bind({ session: { callTool: async () => result } }).tools[tool];
    if (replay) return { tool, input, output: await replay(input) };
    return { tool: contract ? undefined : tool, input, output: result.structuredContent ?? result };
  });
  // A page that never reads opened must not see an unhandled rejection.
  opened.catch(() => {});
  // Closing the view removes its tools from the host.
  return { client, view: app, opened, close: () => app.close() };
}

function toolResult(value) {
  if (value === undefined) return { content: [] };
  const structured = typeof value === "object" && value !== null && !Array.isArray(value);
  return { content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }], ...(structured && { structuredContent: value }) };
}
