# holon-ui

[![Docs](https://img.shields.io/badge/docs-holonlabs.ai-blue)](https://holonlabs.ai/docs/)

Typed MCP clients for browser pages. One `connect()` serves a page as an MCP Apps view inside a host and as a web page that offers its tools to the browser's agent through WebMCP.

## Install

```sh
npm install holon-ui
npm install -D holon-types typescript
```

## Create an app

```sh
npx create-holon-app foo
```

This creates an MCP server with a `greet` tool and a page in `ui/main.ts`.

## Calling your server from the page

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

`connect` from `#holon-ui` types the server's tools, so a wrong tool name, argument or result is a type error:

```sh
npx holon types check
```

```ts
import { connect } from "#holon-ui";

const app = await connect();

const { result } = await app.tools.greet({ name: "Ada" });

await app.tools.great({ name: "Ada" });
// error TS2551: Property 'great' does not exist on type '{ readonly greet: (input: { name: string; }, options?: ToolCallOptions | undefined) => Promise<{ result: string; }>; }'. Did you mean 'greet'?

await app.tools.greet({ name: 42 });
// error TS2322: Type 'number' is not assignable to type 'string'.

result.toFixed();
// error TS2551: Property 'toFixed' does not exist on type 'string'. Did you mean 'fixed'?
```

## Tools that run in the page

`connect` offers them to whichever agent is present: the host's agent in an MCP Apps host, the browser's agent through WebMCP on a web page.

```ts
const app = await connect({
  tools: {
    select_shapes: {
      description: "Select shapes on the board the person is looking at.",
      inputSchema: z.object({ ids: z.array(z.string()) }),
      annotations: { destructiveHint: false, openWorldHint: false },
      execute: ({ ids }) => ({ selected: board.select(ids) }),
    },
  },
});
```

`execute` also receives a `signal` that aborts when the agent cancels.

On a web page, the browser's agent is also offered the server's tools that the generated clients know, leaving out those whose `_meta.ui.visibility` lacks `"model"` and those that need a file argument. In a host, its agent already has them.

## The call that opened a view

In an MCP Apps host, `app.opened` is the tool call that opened the view, with the output its tool returns. On a web page it is `undefined`.

```ts
const opened = await app.opened;
if (opened?.tool === "greet") greeting.value = opened.output.result;
```

Host-only features are on `app.view`, the ext-apps `App`:

```ts
if (app.view) app.view.onhostcontextchanged = ({ theme }) => { if (theme) document.documentElement.style.colorScheme = theme; };
```

## Building the view

A view is its own build. Set the `mcp-app` condition in it, and `holon-ui` calls through the host there and over HTTP everywhere else:

```ts
import { defaultClientConditions, defineConfig } from "vite";

export default defineConfig(({ mode }) => ({
  resolve: { conditions: mode === "mcp" ? ["mcp-app", ...defaultClientConditions] : undefined },
}));
```

`create-holon-app` sets this up.

## Community

Ask questions and share what you're building on the [Holon Discord](https://discord.gg/jXExyBdy).
