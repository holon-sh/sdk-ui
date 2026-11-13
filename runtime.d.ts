import type { App, AppOptions } from "@modelcontextprotocol/ext-apps";
import type { StandardSchemaV1, StandardSchemaWithJSON, ToolAnnotations, Transport } from "@modelcontextprotocol/client";
import type { EndpointBinding, Identity, Contract, RuntimeClient } from "holon-sh/runtime";
export type { CreateOptions, EndpointBinding, Identity, Contract, RuntimeClient } from "holon-sh/runtime";
export type { AuthProvider, CallOptions, CallMetadata, ToolResult, ToolClient } from "holon-sh/runtime";
export { bindApps, ToolCallError } from "holon-sh/runtime";

/** A tool the page declares. It runs in the browser and acts on what the person is looking at. S is its input schema's type. */
export interface PageTool<S = undefined> {
  /** Shown to the agent. Required and non-empty. */
  description: string;
  /** Validates the agent's arguments, such as a Zod 4 object. Without one the tool takes no arguments. */
  inputSchema?: S & StandardSchemaWithJSON;
  annotations?: ToolAnnotations;
  /** Receives validated input. Returns a JSON value, or a promise of one; throwing reports failure. signal aborts when the agent cancels. */
  execute: (input: S extends StandardSchemaV1 ? StandardSchemaV1.InferOutput<S> : Record<string, never>, options: { signal: AbortSignal }) => unknown;
}
// S is inferred per tool. A tool without an input schema leaves its slot unknown, so the slots are unconstrained.
export interface ConnectOptions<S extends Record<string, unknown> = {}> {
  /** Page tools by name, offered to the host's agent in an MCP Apps host and to the browser's agent through WebMCP. */
  tools?: { [K in keyof S]: PageTool<S[K]> };
  /** The ext-apps App's options in an MCP Apps host, and the transport to connect it with; ignored on a web page. */
  view?: AppOptions & { transport?: Transport };
}
type Tools<C> = C extends { tools: infer T } ? T : never;
/** The tool call that opened a view: typed by its tool, or untyped when the host does not say which tool it was. */
export type Opened<C> =
  | { [K in keyof Tools<C> & string]: Tools<C>[K] extends (input: infer I, ...rest: never[]) => Promise<infer O> ? { tool: K; input: I; output: O } : never }[keyof Tools<C> & string]
  | { tool: undefined; input: Record<string, unknown>; output: unknown };
type Resources<C> = C extends { readonly resources: infer R } ? R : never;
/** What a view can do with its app: call its tools and read its resources. */
type Relayed<C> = Pick<C, Extract<keyof C, "tools" | "callTool" | "close">> & {
  readonly resources: { readonly [U in keyof Resources<C>]: Pick<Resources<C>[U], Extract<keyof Resources<C>[U], "read">> };
};
/** The page's own app C, as a view in an MCP Apps host or as a web page, told apart by view. Only a web page can list the app's tools, watch a resource or subscribe to events. close() also unregisters the page's tools and closes the view. */
export type Page<C> =
  | (Relayed<C> & {
    /** The connected ext-apps App, for host-only features. */
    readonly view: App;
    /** The tool call that opened the view, with the output its tool returns. */
    readonly opened: Promise<Opened<C>>;
  })
  | (C & {
    /** Undefined on a web page. */
    readonly view: undefined;
    readonly opened: undefined;
  });
/** connect, narrowed by the generated #holon-ui module to the client C of the project's own app. A page tool cannot take the name of one of the app's tools. */
export type Connect<C> = <S extends Record<string, unknown> = {}>(options?: ConnectOptions<S> & { tools?: { [K in keyof Tools<C>]?: never } }) => Promise<Page<C>>;
/** Bind the page to its own app on the surface its build chose, and offer every tool to whichever agent is present. Most pages call the generated connect from #holon-ui. */
export declare function connect<S extends Record<string, unknown> = {}, Own extends string = string>(
  app: { identity: Identity; /** Must include the contract of the page's own app. */ contracts: Record<string, Contract | null> & Record<NoInfer<Own>, Contract>; own: Own; /** The app's MCP endpoint on the page's origin, such as "/mcp/checkout". */ endpoint: string },
  options?: ConnectOptions<S>,
): Promise<Page<RuntimeClient>>;
