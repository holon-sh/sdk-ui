import type { App } from "@modelcontextprotocol/ext-apps";
import type { Binding as EndpointBinding, Identity, Contract, RuntimeClient } from "holon-sh/runtime";
export type { Binding as EndpointBinding, Identity, Contract, RuntimeClient } from "holon-sh/runtime";
export type { AuthProvider, CallOptions, CallMetadata, ToolResult, ToolClient } from "holon-sh/runtime";
export { ToolCallError } from "holon-sh/runtime";

export interface CreateOptions { validator?: (schema: object) => (value: unknown) => boolean }
export declare function createApps(identity: Identity, contracts: Record<string, Contract | null>, bindings?: Record<string, EndpointBinding>, options?: CreateOptions): Readonly<Record<string, RuntimeClient>>;
export declare function bindApps(identity: Identity, contracts: Record<string, Contract | null>, bindings: Record<string, EndpointBinding>, options?: CreateOptions): Readonly<Record<string, RuntimeClient>>;
/** The ext-apps App with the app's own tools and resources typed; calls go through the host that embeds the page. */
export type View = App & Pick<RuntimeClient, "tools" | "resources" | "callTool">;
export declare function appClass(identity: Identity, contracts: Record<string, Contract | null>, own: string): new (...args: ConstructorParameters<typeof App>) => View;
export interface ExposeOptions { signal?: AbortSignal; execute?: (name: string, args: Record<string, unknown>) => Promise<unknown> }
export declare function exposeTools(app: Pick<RuntimeClient, "callTool" | "listTools">, options?: ExposeOptions): Promise<boolean>;
export type PageResult<I> = { readonly value: I; readonly issues?: undefined } | { readonly issues: ReadonlyArray<{ readonly message: string }> };
export interface PageSchema<I = unknown> { readonly "~standard": { readonly version: 1; readonly vendor: string; readonly types?: { readonly input: unknown; readonly output: I }; readonly validate: (value: unknown) => PageResult<I> | Promise<PageResult<I>>; readonly jsonSchema: { readonly input: (options: { target: "draft-2020-12" }) => object } } }
export type PageInput<S> = S extends PageSchema<infer I> ? I : never;
export interface PageAnnotations { title?: string; readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean }
export interface PageTool<S extends PageSchema = PageSchema> { description: string; inputSchema: S; annotations?: PageAnnotations; execute: (args: PageInput<S>) => unknown }
export interface PageHost { registerTool(name: string, config: { description: string; inputSchema: PageSchema; annotations?: PageAnnotations }, callback: (args: any, extra: any) => any): { remove(): void } }
export declare function registerPageTools<S extends { [name: string]: PageSchema }>(tools: { [K in keyof S]: PageTool<S[K]> }, options?: { view?: PageHost; signal?: AbortSignal }): Promise<boolean>;
