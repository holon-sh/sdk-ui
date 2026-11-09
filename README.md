# holon-ui

[![Docs](https://img.shields.io/badge/docs-holon--labs.dev-blue)](https://holon-labs.dev/docs/)

Typed MCP clients for browser pages: MCP App views, and pages that call MCP servers directly.

## Install

```sh
npm install holon-ui@dev
npm install -D holon-types typescript
```

## Create an app

```sh
npx create-holon-app foo
```

This creates an MCP server with a `greet` tool and a view in `ui/main.ts`.

## Calling your server from a view

The server declares the tool's input and output:

```ts
server.registerTool(
  "greet",
  {
    inputSchema: z.strictObject({ name: z.string() }),
    outputSchema: z.strictObject({ result: z.string() }),
  },
  ({ name }) => {
    const output = { result: `Hello, ${name}!` };
    return { content: [{ type: "text", text: output.result }], structuredContent: output };
  },
);
```

The `App` from `#holon-ui` types the server's tools, so a wrong tool name, argument or result is a type error:

```sh
npx holon types check
```

```ts
import { App } from "#holon-ui";

const view = new App({ name: "foo", version: "0.1.0" });
await view.connect();

const { result } = await view.tools.greet({ name: "Ada" });

await view.tools.great({ name: "Ada" });
// error TS2551: Property 'great' does not exist on type '{ readonly greet: (input: { name: string; }, options?: ToolCallOptions | undefined) => Promise<{ result: string; }>; }'. Did you mean 'greet'?

await view.tools.greet({ name: 42 });
// error TS2322: Type 'number' is not assignable to type 'string'.

await view.tools.greet({});
// error TS2741: Property '"name"' is missing in type '{}' but required in type '{ name: string; }'.

result.toFixed();
// error TS2551: Property 'toFixed' does not exist on type 'string'. Did you mean 'fixed'?
```

## Community

Ask questions and share what you're building on the [Holon Discord](https://discord.gg/jXExyBdy).
