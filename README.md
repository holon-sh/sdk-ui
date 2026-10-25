# holon-ui

Typed MCP clients for browser pages: views that run inside an MCP Apps host, or standalone pages that talk to MCP servers directly. The [`holon` CLI](https://github.com/holon-sh/cli) generates the clients into this package's `generated/` directory, so `import { createApps } from "holon-ui"` resolves to your app's own types. Clients validate arguments before each call and results after it, and can expose tools to the page's WebMCP agent.

`holon-ui` contains only browser code. Server code uses `holon-sh` ([Node.js](https://github.com/holon-sh/sdk-ts) or [Python](https://github.com/holon-sh/sdk-py)). Start with the [CLI README](https://github.com/holon-sh/cli) for the walkthrough.

## Install

In the app's root directory, next to its `server.json`:

```sh
npm install holon-ui@dev
```

Declare `holon-ui` in the app root's `package.json` even when the view's sources live in a subdirectory: `holon types generate` writes browser clients into `node_modules/holon-ui/generated/` whenever that `package.json` declares `holon-ui` (and into `holon-sh` as well when it declares both). The package has the same `postinstall` as `holon-sh`; set `HOLON_SKIP_POSTINSTALL=1` to turn it off.

## The generated module

```typescript
import { ToolCallError, apps, view, createApps, exposeTools, registerPageTools, type Inputs, type Outputs, type Resources } from "holon-ui";
```

| Export | What it is |
|---|---|
| `apps` | A client for your own server, bound through the MCP Apps host that embeds the page. |
| `view` | The `App` from `@modelcontextprotocol/ext-apps` that `apps` connects through. It connects on the first tool call, or when you `await view.connect()`. |
| `createApps(bindings, options?)` | Clients for the servers you bind explicitly, keyed like `bindings`. |
| `ToolCallError` | Thrown by `tools.<tool>` when a tool reports an error or asks for more input. |
| `exposeTools(client, options?)` | Registers a client's tools with the page's WebMCP agent. |
| `registerPageTools(tools, options?)` | Registers tools implemented by the page itself. |
| `Inputs`, `Outputs`, `Resources` | Argument, result and resource value types, as `Inputs["dep"]["tool"]`. |

Your own server appears under the last segment of its `server.json` name, e.g. `example.com/checkout` → `checkout`: `createApps({ checkout: ... })`, `apps.checkout.tools.<tool>()`, `Inputs["checkout"]`. Every other key is a dependency declared in `server.json`.

## Bind a client

### Inside an MCP Apps host

A view embedded in an MCP Apps host calls its own server through the host, which owns the connection and the credentials. `apps` is already bound that way:

```typescript
import { apps, view } from "holon-ui";

view.ontoolresult = ({ structuredContent }) => render(structuredContent); // set handlers before the first call
const { total } = await apps.checkout.tools.total({ id: "A-1" });
```

`view` connects on that first call. To connect earlier, `await view.connect()`; the clients reuse the connection. To bind a different `App` yourself, use `createApps({ checkout: { host: myApp } })`.

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

`holon-ui/runtime` exports what the generated module calls: `createApps(identity, contracts, bindings?, options?)`, `bindApps`, `hostApps(identity, contracts, own)`, `exposeTools`, `registerPageTools`, `ToolCallError`, and the `HostBinding`, `EndpointBinding` and page-tool types. Apps use the generated module instead.

## Develop

```sh
HOLON_SKIP_POSTINSTALL=1 npm ci
npm test
```

## License

MIT
