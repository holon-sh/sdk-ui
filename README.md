# holon-ui

Typed MCP clients for browser pages: views that run inside an MCP Apps host, or standalone pages that talk to MCP servers directly. The [`holon` CLI](https://github.com/holon-sh/cli) generates the clients into this package's `generated/` directory, so `import { createApps } from "holon-ui"` resolves to your app's own types. Clients validate arguments before each call and results after it, and can expose tools to the page's WebMCP agent.

`holon-ui` contains only browser code. Server code uses `holon-sh` ([Node.js](https://github.com/holon-sh/sdk-ts) or [Python](https://github.com/holon-sh/sdk-py)). Start with the [CLI README](https://github.com/holon-sh/cli) for the walkthrough.

## Install

In the app's root directory, next to its `server.json`:

```sh
npm install holon-ui@dev
```

Declare `holon-ui` in the app root's `package.json` even when the view's sources live in a subdirectory: `holon types generate` writes browser clients into `node_modules/holon-ui/generated/` whenever that `package.json` declares `holon-ui` (and into `holon-sh` as well when it declares both).

## The generated module

```typescript
import { App, ToolCallError, createApps, exposeTools, registerPageTools, type Inputs, type Outputs, type Resources } from "holon-ui";
```

| Export | What it is |
|---|---|
| `App` | The `App` from `@modelcontextprotocol/ext-apps` with your own server's `tools`, `resources` and `callTool` typed. Calls go through the host that embeds the page. |
| `createApps(bindings, options?)` | Clients for servers you reach by endpoint, keyed like `bindings`. |
| `ToolCallError` | Thrown by `tools.<tool>` when a tool reports an error or asks for more input. |
| `exposeTools(client, options?)` | Registers a client's tools with the page's WebMCP agent. |
| `registerPageTools(tools, options?)` | Registers tools implemented by the page itself. |
| `Inputs`, `Outputs`, `Resources` | Argument, result and resource value types, as `Inputs["dep"]["tool"]`. |

Your own server appears under the last segment of its `server.json` name, e.g. `example.com/checkout` → `checkout`: `Inputs["checkout"]`, `Outputs["checkout"]`, and `createApps({ checkout: { endpoint } })` for a standalone page. Every other key is a dependency declared in `server.json`.

## Bind a client

### Inside an MCP Apps host

A view embedded in an MCP Apps host calls its own server through the host, which owns the connection and the credentials. Construct and connect `App` exactly as you would the one from `@modelcontextprotocol/ext-apps`; it is that class with typed members added:

```typescript
import { App } from "holon-ui";

const view = new App({ name: "checkout-view", version: "1.0.0" });
view.ontoolresult = ({ structuredContent }) => render(structuredContent);
await view.connect();

const { total } = await view.tools.total({ id: "A-1" });
```

The host owns the tool catalog, so `listTools`, `exposeTools` and `watch` need an endpoint binding instead.

### Directly to an endpoint

```typescript
const apps = createApps({
  checkout: { endpoint: new URL("/mcp", location.origin) },
  orders: { endpoint: "https://orders.example.com/mcp" },
});

const order = await apps.orders.tools.lookup({ id: "A-1" }, { timeout: 5000 });
```

An endpoint binding takes `endpoint`, and optionally `authProvider`, `fetch`, and `scoped: true` to close the session after every call. Otherwise a client keeps one session open; call `close()` when the page no longer needs it.

## Read and watch resources

A server types a JSON resource by registering it with `mimeType: "application/json"` and an `"sh.holon/outputSchema"` JSON Schema in its `_meta`:

```typescript
const summary = await apps.orders.resources["orders://summary"].read();

const lifetime = new AbortController();
await apps.orders.resources["orders://summary"].watch(value => render(value.open), { signal: lifetime.signal });
```

`watch` calls back with the current value and then on every update, until the signal aborts; the server must support resource subscriptions.

## Give tools to the page's agent

`exposeTools` registers every tool of an endpoint-bound client with the page's WebMCP context (`navigator.modelContext`). Calls from the agent go through the client, so they are validated. It returns `false` when the browser has no WebMCP context.

```typescript
await exposeTools(apps.orders, { signal: lifetime.signal });
```

`registerPageTools` registers tools the page implements itself. Input schemas are Standard Schema validators that can produce JSON Schema, such as Zod 4. Pass `view` to register with the MCP Apps host; without it they go to WebMCP. Aborting the signal unregisters them.

```typescript
import { z } from "zod";

await registerPageTools(
  {
    highlight: {
      description: "Highlight an order on the page",
      inputSchema: z.object({ id: z.string() }),
      execute: ({ id }) => {
        select(id);
        return { content: [{ type: "text", text: `Highlighted ${id}` }] };
      },
    },
  },
  { view, signal: lifetime.signal },
);
```

## Build and serve a view

The server serves the view as one HTML file, so bundle it into a single file. With Vite, in the app root:

```typescript
// vite.config.ts
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({ root: "ui", plugins: [viteSingleFile()], build: { outDir: "../dist", emptyOutDir: true } });
```

```sh
npm install --save-dev vite vite-plugin-singlefile
npm install @modelcontextprotocol/ext-apps
npx vite build
```

Then serve `dist/index.html` from the server with `appView` from `holon-sh/view` (Node.js) or `app_view` from `holon.view` (Python); both are documented in their runtime READMEs.

## Low-level runtime

`holon-ui/runtime` exports what the generated module calls: `createApps(identity, contracts, bindings?, options?)`, `bindApps`, `appClass(identity, contracts, own)`, `exposeTools`, `registerPageTools`, `ToolCallError`, and the `EndpointBinding`, `View` and page-tool types. Apps use the generated module instead.

## Develop

```sh
npm ci
npm test
```

## License

MIT

## One presentation for web and MCP Apps

Generate the app's contracts with `holon types generate`. TypeScript function apps
and Python `App` decorators produce the same typed references in `holon-ui/app`.
The browser imports those references, never backend implementations.

```tsx
// ui/main.tsx
import { tools, resources } from "holon-ui/app";
import { view, Form, useResource } from "holon-ui/react";

function Counter() {
  const state = useResource(resources["counter://state"], { poll: 2000 });
  return <main>
    <p>{state.data?.count ?? "Loading…"}</p>
    {state.error && <p role="alert">{state.error}</p>}
    <Form action={tools.add} defaults={{ amount: 1 }} />
  </main>;
}

export default view(tools.show, Counter);
```

```ts
// build.ts; run from the app directory after type generation
import { build } from "holon-ui/build";
await build({ entry: "ui/main.tsx", endpoint: "/mcp/counter" });
```

This emits `dist/web/index.html`, an MCP preview at `dist/web/host.html`,
`dist/mcp/index.html`, and `dist/views.json` for the server. React and React DOM
are optional peers; install them when using this presentation API. Existing browser
clients do not need React. The build compiles JSON Schema validators ahead of time
so an MCP App does not need `unsafe-eval` or direct network access.

- `view(tool)` generates a form and result display. Pass a React component for a
  custom UI. The component receives optional `input` and `result` from the host.
- `Form` accepts typed `bind`, `defaults`, `clear`, and `onSuccess`. Binding every
  input yields an action button. Native named controls can replace generated fields
  through `children`. Complex values use JSON textareas. Validation and failed calls
  preserve the draft; successful calls clear only the requested paths.
- `useResource` returns `data`, `loading`, `error`, `denied`, and `refresh`. Resource
  state belongs to the mounted runtime. The web transport subscribes when available;
  `poll` explicitly enables a fallback for hosts without resource events.
- `useRuntime().call(tool, input)` uses the same validation and invalidation path
  as forms and optional WebMCP tools. `onResult(tool, listener)` observes successful
  local calls, useful for recording exact returned IDs. `surface` identifies web
  versus MCP rendering.

Ordinary React owns local state, tables, routing, custom controls, and rendering.
For a custom transport or authentication lifecycle, mount a new `RuntimeContext`
with a `Runtime` and dispose the previous instance; never share a runtime between
users. Server-side authorization remains authoritative. Host results update the
view without replaying mutations. Only an explicitly read-only, zero-required-input
entry tool runs automatically on the web surface. `webMCP: true` opts into browser
tool exposure when the browser supplies that API.

The compiler accepts a static `export default view(tools.operation, Component?)`
declaration. TypeScript/JSON metadata is not a layout language: use React for richer
presentations. Native MCP APIs remain available for tools and resources that need
features outside these helpers.
