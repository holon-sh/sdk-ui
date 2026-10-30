/** JSON Schema, with annotations used by the optional generated form. */
export type Schema = {
  [key: string]: unknown;
  $ref?: string;
  $defs?: Record<string, Schema>;
  type?: string;
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  anyOf?: Schema[];
  enum?: unknown[];
  const?: unknown;
  title?: string;
  additionalProperties?: boolean;
};
export interface Resource<T> {
  readonly kind: "resource";
  readonly uri: string;
  readonly schema: Schema;
  readonly value?: T;
}
export interface Tool<I, O> {
  readonly kind: "tool";
  readonly name: string;
  readonly inputSchema: Schema;
  readonly outputSchema?: Schema;
  readonly description?: string;
  readonly annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
  readonly changes?: readonly string[];
  readonly input?: I;
  readonly output?: O;
}
export type Input<T> = T extends Tool<infer I, any> ? I : never;
export type Output<T> = T extends Tool<any, infer O> ? O : never;
export type Value<T> = T extends Resource<infer V> ? V : never;
