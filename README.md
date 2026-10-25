# holon-ui

Typed MCP clients for browser views: pages that run inside an MCP Apps host, or standalone pages that talk to MCP servers directly. The `holon` CLI (PyPI `holon-types`) generates the clients into this package's `generated/` directory, so `import { createApps } from "holon-ui"` resolves to your app's own types. Clients validate arguments before each call and results after it, and can expose tools to the page's WebMCP agent.

`holon-ui` contains only browser code. Server code uses `holon-sh` (npm or PyPI) instead.

For the end-to-end walkthrough (declaring dependencies in `server.json`, generating, checking), see the [`holon-types` README](https://pypi.org/project/holon-types/).

## Install

Once published, install the dev release (no non-dev version exists yet) in the app's root directory, next to its `server.json`:

```sh
npm install holon-ui@dev
```

Declare `holon-ui` in the app root's `package.json`, even when the view's sources live in a subdirectory. `holon types generate` writes the browser clients into `node_modules/holon-ui/generated/` whenever that `package.json` declares `holon-ui`, and into `node_modules/holon-sh/generated/` as well when it also declares `holon-sh`. Like `holon-sh`, the package has a `postinstall` script that runs `holon types generate --no-install --quiet` when the install directory has a `server.json`; set `HOLON_SKIP_POSTINSTALL=1` to turn it off.

## Use the generated module

```typescript
import { ToolCallError, createApps, exposeTools, registerPageTools, type Inputs, type Outputs, type Resources } from "holon-ui";
```

| Export | What it is |
|---|---|
| `createApps(bindings, options?)` | Clients for the dependencies you bind, keyed like `bindings`. There is no `apps` export: a browser has no environment variables, so every client is bound explicitly. |
| `ToolCallError` | Thrown by `tools.<tool>` when a tool reports an error or asks for more input. |
| `exposeTools(client, options?)` | Registers a client's tools with the page's WebMCP agent. |
| `registerPageTools(tools, options?)` | Registers tools implemented by the page itself. |
| `Inputs`, `Outputs`, `Resources` | Argument, result and resource value types, as `Inputs["dep"]["tool"]`. |
| `EndpointBinding`, `HostBinding`, `CreateOptions` | Binding and option types. |

### Your own server is `self`

The generated clients include one for your own server, under the reserved key `self`: `createApps({ self: ... })`, `apps.self.tools.<tool>()`, `Inputs["self"]`, `Outputs["self"]`, `Resources["self"]`. Every other key is a dependency declared in `server.json`. `self` cannot be used as a `requires` alias.

## Bind a client

### Inside an MCP Apps host

A view embedded in an MCP Apps host calls its own server through the host, which owns the connection and the credentials. Pass the `App` from `@modelcontextprotocol/ext-apps` as the host:

```typescript
import { App } from "@modelcontextprotocol/ext-apps";
import { createApps } from "holon-ui";

const view = new App({ name: "checkout-view", version: "1.0.0" });
await view.connect();

const apps = createApps({ self: { host: view } });
const { total } = await apps.self.tools.total({ id: "A-1" });
```

A host binding needs only `callServerTool` and `readServerResource`. The host owns the tool catalog, so `listTools`, `exposeTools` and `watch` need an endpoint binding instead.

### Directly to an endpoint

A standalone page connects to MCP servers over Streamable HTTP:

```typescript
import { createApps } from "holon-ui";

const apps = createApps({
  self: { endpoint: new URL("/mcp", location.origin) },
  orders: { endpoint: "https://orders.example.com/mcp" },
});

const order = await apps.orders.tools.lookup({ id: "A-1" }, { timeout: 5000 });
```

An endpoint binding takes `endpoint`, and optionally `authProvider`, `fetch`, and `scoped: true` (close the session after every call). Without `scoped`, a client keeps one session open; call `close()` on it when the page no longer needs it. `timeout` is in milliseconds; `signal` takes an `AbortSignal`.

## Read and watch resources

A server types a JSON resource by registering it with `mimeType: "application/json"` and an `"sh.holon/outputSchema"` JSON Schema in its `_meta`. The client then offers `read` and, through an endpoint binding, `watch`:

```typescript
const summary = await apps.orders.resources["orders://summary"].read();

const lifetime = new AbortController();
await apps.orders.resources["orders://summary"].watch(value => render(value.open), {
  signal: lifetime.signal,
});
```

`watch` subscribes to the resource, calls back with the current value and then on every update, and stops when the signal aborts. The server must support resource subscriptions.

## Give tools to the page's agent

`exposeTools` registers every tool of an endpoint-bound client with the page's WebMCP context (`document.modelContext` or `navigator.modelContext`). Calls from the agent go through the client, so they are validated. It returns `false` when the browser has no WebMCP context:

```typescript
await exposeTools(apps.orders, { signal: lifetime.signal });
```

`registerPageTools` registers tools the page implements itself. Their input schemas are Standard Schema validators that can produce JSON Schema, such as Zod 4 schemas. Pass `view` to register them with the MCP Apps host; without it they go to WebMCP:

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

Aborting the signal unregisters the tools.

## Build a view with Vite

The server serves the view as one HTML file, so bundle it into a single file. In the app root, next to `server.json`:

`vite.config.ts`:

```typescript
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  root: "ui",
  plugins: [viteSingleFile()],
  build: { outDir: "../dist", emptyOutDir: true },
});
```

`ui/index.html`:

```html
<!doctype html>
<html>
  <body>
    <input id="order" value="A-1" />
    <button>Total</button>
    <output></output>
    <script type="module" src="./main.ts"></script>
  </body>
</html>
```

`ui/main.ts`:

```typescript
import { App } from "@modelcontextprotocol/ext-apps";
import { createApps } from "holon-ui";

const view = new App({ name: "checkout-view", version: "1.0.0" });
await view.connect();
const apps = createApps({ self: { host: view } });

document.querySelector("button")!.addEventListener("click", async () => {
  const id = document.querySelector<HTMLInputElement>("#order")!.value;
  const { total } = await apps.self.tools.total({ id });
  document.querySelector("output")!.textContent = String(total);
});
```

```sh
npm install --save-dev vite vite-plugin-singlefile
npm install @modelcontextprotocol/ext-apps
npx vite build
```

Serve `dist/index.html` from the server as an MCP App resource with `appView` from `holon-sh/view` (or `app_view` from `holon.view` in Python):

```typescript
import { appView } from "holon-sh/view";

server.registerResource(...appView("Checkout", "ui://checkout/index.html", new URL("./dist/index.html", import.meta.url)));
```

## Low-level runtime

`holon-ui/runtime` exports what the generated module calls: `createApps(identity, contracts, bindings?, options?)`, `bindApps`, `exposeTools`, `registerPageTools`, `ToolCallError`, and the `HostBinding`, `EndpointBinding` and page-tool types. Applications use the generated module instead.

## Develop

```sh
HOLON_SKIP_POSTINSTALL=1 npm ci
npm test
npm pack
```

## License

MIT
