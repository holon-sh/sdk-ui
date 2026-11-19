import type { App, AppOptions } from "@modelcontextprotocol/ext-apps";
import type { StandardSchemaV1, StandardSchemaWithJSON, ToolAnnotations } from "@modelcontextprotocol/client";
import type { EndpointBinding, Identity, Contract, RuntimeClient, SessionClient, ToolClient } from "holon-sh/runtime";
export type { CreateOptions, EndpointBinding, Identity, Contract, RuntimeClient } from "holon-sh/runtime";
export type { AuthProvider, CallOptions, CallMetadata, ToolResult, ToolClient } from "holon-sh/runtime";

/** A tool the page declares. It runs in the browser and acts on what the person is looking at. S and O are its input and output schemas' types. */
export interface PageTool<S = undefined, O = undefined> {
  /** Shown to the agent. Required and non-empty. */
  description: string;
  /** Validates the agent's arguments, such as a Zod 4 object. Without one the tool takes no arguments. */
  inputSchema?: S & StandardSchemaWithJSON;
  /** Describes and validates the object execute returns, such as a Zod 4 object. */
  outputSchema?: O & StandardSchemaWithJSON;
  annotations?: ToolAnnotations;
  /** Receives validated input. Returns a JSON value, or a promise of one; throwing reports failure. signal aborts when the agent cancels. */
  execute(input: S extends StandardSchemaV1 ? StandardSchemaV1.InferOutput<S> : Record<string, never>, options: { signal: AbortSignal }): O extends StandardSchemaV1 ? StandardSchemaV1.InferInput<O> | Promise<StandardSchemaV1.InferInput<O>> : unknown;
}
export interface AnyPageTool {
  description: string;
  inputSchema?: StandardSchemaWithJSON;
  outputSchema?: StandardSchemaWithJSON;
  annotations?: ToolAnnotations;
  execute(input: unknown, options: { signal: AbortSignal }): unknown;
}
// S and O are inferred per tool. A tool without a schema leaves its slot unknown, so the slots are unconstrained.
export interface ConnectOptions<S extends Record<string, unknown> = {}, O extends Record<string, unknown> = {}> {
  /** Page tools by name, offered to the host's agent in an MCP Apps host and to the browser's agent through WebMCP. */
  tools?: { [K in keyof S]: PageTool<S[K], O[K & keyof O]> } & { [K in keyof O]: { outputSchema?: O[K] & StandardSchemaWithJSON } };
  /** On a web page, also offer call_tools, which runs several of the other offered tools in one call. Ignored in an MCP Apps host, whose agent calls the app's tools itself. */
  batch?: "call_tools" extends keyof S ? false : boolean;
  /** The ext-apps App's options in an MCP Apps host, and the transport to connect it with; ignored on a web page. */
  view?: AppOptions & { transport?: Parameters<App["connect"]>[0] };
  /** The app's binding on a web page, in place of the generated one; its endpoint resolves against the page's origin. Ignored in an MCP Apps host. */
  web?: EndpointBinding;
}
type Client = ToolClient<any, any, any, any>;
/** The tool call that opened a view: typed by its tool, or untyped when the host does not say which tool it was. */
export type Opened<C extends Client> =
  | { [K in keyof C["tools"] & string]: C["tools"][K] extends (input: infer I, ...rest: never[]) => Promise<infer O> ? { tool: K; input: I; output: O } : never }[keyof C["tools"] & string]
  | { tool: undefined; input: Record<string, unknown>; output: unknown };
/** The page's own app C, as a view in an MCP Apps host or as a web page, told apart by view. Only a web page can list the app's tools, watch a resource or subscribe to events. close() also unregisters the page's tools and closes the view. */
export type Page<C extends Client> =
  | (SessionClient<C> & {
    close(): Promise<void>;
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
export type Connect<C extends Client> = <S extends Record<string, unknown> = {}, O extends Record<string, unknown> = {}>(options?: ConnectOptions<S, O> & { tools?: { [K in keyof C["tools"]]?: never }; batch?: "call_tools" extends keyof C["tools"] ? false : boolean }) => Promise<Page<C>>;
export interface OwnApp {
  identity: Identity;
  contracts: Record<string, Contract | null>;
  own: string;
  /** The app's MCP endpoint on the page's origin, such as "/mcp/checkout". */
  endpoint: string;
}
export type Runtime = <S extends Record<string, unknown> = {}, O extends Record<string, unknown> = {}>(app: OwnApp, options?: ConnectOptions<S, O>) => Promise<Page<RuntimeClient>>;
