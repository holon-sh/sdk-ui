// holon-ui/runtime for an MCP Apps view in a host's iframe: package.json resolves to it under the mcp-app condition,
// which the view's build sets. The host is the app's MCP client, so its agent already has the app's tools: the view
// offers it only the page's own tools, and calls its app through the host.
// https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx#standard-mcp-messages
import { App } from "@modelcontextprotocol/ext-apps";
import type { BaseContext, CallToolResult, StandardSchemaV1 } from "@modelcontextprotocol/client";
import { bindApps, ToolCallError, type RuntimeClient, type ToolSession } from "holon-sh/runtime";
import type { AnyPageTool, Opened, Runtime } from "./page.js";

export { bindApps, ToolCallError };

export const connect: Runtime = async ({ identity, contracts, own }, { tools = {}, view: { transport, ...options } = {} } = {}) => {
  const bind = (session: ToolSession) => bindApps(identity, contracts, { [own]: { session } })[own];
  const app = new App({ name: identity.name, version: identity.version }, {}, options);
  const session: ToolSession = {
    callTool: (request, { signal, timeout } = {}) => app.callServerTool(request, { signal, timeout }),
    readResource: (request, { signal, timeout } = {}) => app.readServerResource(request, { signal, timeout }),
  };
  // Registered before connecting, so the view declares the tools capability in ui/initialize.
  for (const [name, { description, inputSchema, outputSchema, annotations, execute }] of Object.entries<AnyPageTool>(tools)) {
    const output = outputSchema?.["~standard"];
    const run = async (input: unknown, { mcpReq: { signal } }: BaseContext): Promise<CallToolResult> => {
      try {
        const result = await execute(input, { signal });
        const checked = output ? await output.validate(result) : { value: result };
        if (checked.issues) throw new Error(`Invalid output for ${name}: ${JSON.stringify(checked.issues)}`);
        return toolResult(checked.value);
      } catch (error) {
        // A tool's own failure is a result the agent can read, not a protocol error.
        // https://modelcontextprotocol.io/specification/2026-07-28/server/tools#error-handling
        return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }] };
      }
    };
    // ext-apps validates input against inputSchema first, and calls a tool without one with the request context alone.
    const listed = output && { "~standard": { ...output, validate: (value: unknown) => ({ value }) } };
    if (inputSchema) app.registerTool<StandardSchemaV1 | undefined, StandardSchemaV1>(name, { description, inputSchema, outputSchema: listed, annotations }, run);
    else app.registerTool<StandardSchemaV1 | undefined>(name, { description, outputSchema: listed, annotations }, extra => run({}, extra));
  }
  // The host sends the call that opened the view once, right after the handshake, so listen before connecting.
  // https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx#data-passing
  const delivered = new Promise<{ input: Record<string, unknown>; result: CallToolResult }>((resolve, reject) => {
    let input = {};
    app.addEventListener("toolinput", params => { input = params.arguments ?? {}; });
    app.addEventListener("toolresult", result => resolve({ input, result }));
    app.addEventListener("toolcancelled", ({ reason }) => reject(new Error(`The tool call that opened the view was cancelled${reason ? `: ${reason}` : "."}`)));
  });
  await app.connect(transport);
  // Replaying the delivered result through the app's own client gives exactly what calling the tool would have: the
  // same output validation and ToolCallError. When the host does not say which tool it was, the call comes as delivered.
  // https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx#host-context-in-mcpuiinitializeresult
  const opened = delivered.then(async ({ input, result }): Promise<Opened<RuntimeClient>> => {
    const tool = app.getHostContext()?.toolInfo?.tool.name;
    const replay = tool && bind({ ...session, callTool: async () => result }).tools[tool];
    return replay ? { tool, input, output: await replay(input) } : { tool: undefined, input, output: result };
  });
  // A page that never reads opened must not see an unhandled rejection.
  opened.catch(() => {});
  const client = bind(session);
  // Closing the view removes its tools from the host.
  return Object.freeze({ tools: client.tools, callTool: client.callTool, resources: client.resources, view: app, opened, close: () => app.close() });
};

function toolResult(value: unknown): CallToolResult {
  if (value === undefined) return { content: [] };
  const structured = typeof value === "object" && value !== null && !Array.isArray(value);
  return { content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }], ...(structured && { structuredContent: value }) };
}
