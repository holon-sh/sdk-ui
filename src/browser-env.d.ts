declare module "app-view" {
  const presentation: import("./react.js").Presentation<
    Record<string, unknown>,
    unknown
  >;
  export default presentation;
}
declare module "app-validators" {
  export function validate(schema: object, data: unknown): void;
}
