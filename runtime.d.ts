import type { App, AppOptions } from "@modelcontextprotocol/ext-apps";
import type { StandardSchemaV1, StandardSchemaWithJSON, ToolAnnotations, Transport } from "@modelcontextprotocol/client";
import type { EndpointBinding, Identity, Contract, RuntimeClient, ToolClient } from "holon-sh/runtime";
export type { EndpointBinding, Identity, Contract, RuntimeClient } from "holon-sh/runtime";
export type { AuthProvider, CallOptions, CallMetadata, ToolResult, ToolClient } from "holon-sh/runtime";
export { ToolCallError } from "holon-sh/runtime";

type EventShapes = Record<string, { arguments: unknown; data: unknown }>;
type AnyEvents = Record<string, { arguments: Record<string, unknown>; data: unknown }>;

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
/** Options of the ext-apps App in an MCP Apps host, and the transport to connect it with. */
export type ViewOptions = AppOptions & { transport?: Transport };
// S is inferred per tool. A tool without an input schema leaves its slot unknown, so the slots are unconstrained.
export interface ConnectOptions<S extends Record<string, unknown> = {}> {
  /** Page tools by name, offered to the host's agent in an MCP Apps host and to the browser's agent through WebMCP. */
  tools?: { [K in keyof S]: PageTool<S[K]> };
  /** Used in an MCP Apps host; ignored on a web page. */
  view?: ViewOptions;
}
type Tools<I, O> = ToolClient<I, O, {}>["tools"];
/** The tool call that opened a view: typed by the tool's name, or untyped when the host does not say which tool it was. */
export type Opened<I, O> =
  | { [K in keyof Tools<I, O> & string]: { tool: K; input: Parameters<Tools<I, O>[K]>[0]; output: Awaited<ReturnType<Tools<I, O>[K]>> } }[keyof Tools<I, O> & string]
  | { tool: undefined; input: Record<string, unknown>; output: unknown };
/** The page's own app, bound through the host in an MCP Apps view and over HTTP on a web page. close() also unregisters the page's tools and closes the view. */
export type Page<I, O, R, E extends EventShapes = AnyEvents> = ToolClient<I, O, R, E> & {
  /** The connected ext-apps App in an MCP Apps host; undefined on a web page. */
  readonly view: App | undefined;
  /** In an MCP Apps host, the tool call that opened the view, with the output its tool would return; undefined on a web page. */
  readonly opened: Promise<Opened<I, O>> | undefined;
};
/** What the generated module knows about the page's own app. */
export interface OwnApp {
  identity: Identity;
  contracts: Record<string, Contract | null>;
  /** The key of the page's own app in contracts. */
  own: string;
  /** The app's MCP endpoint as a path on the page's origin, such as "/mcp/checkout". */
  endpoint: string;
}
/** connect, narrowed by the generated #holon-ui module to the project's own app. A page tool cannot take the name of one of the app's tools. */
export type Connect<I, O, R, E extends EventShapes = AnyEvents> = <S extends Record<string, unknown> = {}>(options?: ConnectOptions<S> & { tools?: { [K in keyof I]?: never } }) => Promise<Page<I, O, R, E>>;
/** Bind the page to its own app on the surface its build chose, and offer every tool to whichever agent is present. Most pages call the generated connect from #holon-ui. */
export declare function connect<S extends Record<string, unknown> = {}>(app: OwnApp, options?: ConnectOptions<S>): Promise<Page<Record<string, Record<string, unknown>>, Record<string, unknown>, Record<string, unknown>>>;

export interface CreateOptions { validator?: (schema: object) => (value: unknown) => boolean }
export declare function bindApps(identity: Identity, contracts: Record<string, Contract | null>, bindings: Record<string, EndpointBinding>, options?: CreateOptions): Readonly<Record<string, RuntimeClient>>;
/** The ext-apps App with the app's own tools and resources typed; calls go through the host that embeds the page. */
export type View = App & Pick<RuntimeClient, "tools" | "resources" | "callTool">;
export declare function appClass(identity: Identity, contracts: Record<string, Contract | null>, own: string): new (info?: ConstructorParameters<typeof App>[0], ...rest: ConstructorParameters<typeof App> extends [unknown, ...infer Rest] ? Rest : never) => View;
export interface ExposeOptions { signal?: AbortSignal; execute?: (name: string, args: Record<string, unknown>) => Promise<unknown> }
export declare function exposeTools(app: Pick<RuntimeClient, "callTool" | "listTools">, options?: ExposeOptions): Promise<boolean>;
export type PageResult<I> = { readonly value: I; readonly issues?: undefined } | { readonly issues: ReadonlyArray<{ readonly message: string }> };
export interface PageSchema<I = unknown> { readonly "~standard": { readonly version: 1; readonly vendor: string; readonly types?: { readonly input: unknown; readonly output: I }; readonly validate: (value: unknown) => PageResult<I> | Promise<PageResult<I>>; readonly jsonSchema: { readonly input: (options: { target: "draft-2020-12" }) => object } } }
export type PageInput<S> = S extends PageSchema<infer I> ? I : never;
export interface PageAnnotations { title?: string; readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean }
export interface PageHost { registerTool(name: string, config: { description: string; inputSchema: PageSchema; annotations?: PageAnnotations }, callback: (args: any, extra: any) => any): { remove(): void } }
export declare function registerPageTools<S extends { [name: string]: PageSchema }>(tools: { [K in keyof S]: { description: string; inputSchema: S[K]; annotations?: PageAnnotations; execute: (args: PageInput<S[K]>) => unknown } }, options?: { view?: PageHost; signal?: AbortSignal }): Promise<boolean>;
