# holon-ui

Typed MCP clients for browser pages: views inside an MCP Apps host, or standalone pages that call MCP servers directly. The [`holon` CLI](https://github.com/holon-sh/cli) generates them into `generated/holon-ui/`, imported as `#holon-ui`. Server code uses `holon-sh` ([Node.js](https://github.com/holon-sh/sdk-ts) or [Python](https://github.com/holon-sh/sdk-py)).

## Install

In the app's root directory, next to its `server.json` and `package.json`:

```sh
npm install holon-ui@dev @modelcontextprotocol/ext-apps
```

## Bind a client

### Inside an MCP Apps host

`App` is the `App` from `@modelcontextprotocol/ext-apps` with typed members added. Calls go through the host:

```typescript
import { App } from "#holon-ui";

const view = new App({ name: "checkout-view", version: "1.0.0" });
view.ontoolresult = ({ structuredContent }) => render(structuredContent);
await view.connect();

const { total } = await view.tools.total({ id: "A-1" });
```

The host owns the tool catalog, so `listTools`, `exposeTools` and `watch` need an endpoint binding instead.

### Directly to an endpoint

```typescript
import { createApps } from "#holon-ui";

const apps = createApps({
  checkout: { endpoint: new URL("/mcp", location.origin) },
  orders: { endpoint: "https://orders.example.com/mcp" },
});

const order = await apps.orders.tools.lookup({ id: "A-1" }, { timeout: 5000 });
```

Your own server is keyed by the last segment of its `server.json` name, e.g. `example.com/checkout` → `checkout`; every other key is a dependency.

A binding also takes `authProvider`, `fetch`, and `scoped: true` to close the session after every call; otherwise call `close()` when done.

A tool can ask for input through an MCP elicitation. Pass `elicit` to answer it:

```typescript
const { shipped } = await apps.orders.tools.ship({ id: "A-1" }, {
  elicit: async params => ({ action: "accept", content: await showForm(params) }),
});
```

Without `elicit`, the call throws `ToolCallError` with the question on `.result`.

## Read and watch resources

A server types a JSON resource by registering it with `mimeType: "application/json"` and an `"sh.holon/outputSchema"` JSON Schema in its `_meta`:

```typescript
const summary = await apps.orders.resources["orders://summary"].read();

const lifetime = new AbortController();
await apps.orders.resources["orders://summary"].watch(value => render(value.open), { signal: lifetime.signal });
```

`watch` needs a server that supports resource subscriptions.

## Give tools to the page's agent

`exposeTools` registers an endpoint-bound client's tools with the page's WebMCP context (`navigator.modelContext`), except those whose `_meta.ui.visibility` omits `"model"`. It returns `false` when the browser has no WebMCP context.

```typescript
await exposeTools(apps.orders, { signal: lifetime.signal });
```

`registerPageTools` registers tools the page implements, with Standard Schema inputs such as Zod 4. Pass `view` to register with the MCP Apps host instead of WebMCP.

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

## Community

Ask questions and share what you're building on the [Holon Discord](https://discord.gg/jXExyBdy).
