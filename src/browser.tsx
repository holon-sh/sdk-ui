import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@modelcontextprotocol/ext-apps";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { Runtime } from "../state.js";
import { Form, RuntimeContext } from "../react.js";
import presentation from "app-view";
import { tools } from "holon-ui/app";
import { validate } from "app-validators";
import type { Tool } from "../app.js";
declare const TARGET: "web" | "mcp", APP_NAME: string, ENDPOINT: string;

let runtime!: Runtime;
const removals: (() => void)[] = [];
const root = createRoot(document.querySelector("#root")!);
let input: Record<string, unknown> = {},
  result: unknown;
let toolError: Error | undefined;
function Generated() {
  return (
    <main>
      <h1>{presentation.open.name?.replaceAll("_", " ")}</h1>
      <Form
        action={presentation.open}
        defaults={input}
        onSuccess={(value) => {
          result = value;
          toolError = undefined;
          mount();
        }}
      />
      <pre aria-label="Result">{JSON.stringify(result, null, 2)}</pre>
      {toolError && <p role="alert">{toolError.message}</p>}
    </main>
  );
}
const mount = () =>
  root.render(
    createElement(
      RuntimeContext.Provider,
      { value: runtime },
      createElement(presentation.component ?? Generated, {
        input,
        result,
        error: toolError,
      }),
    ),
  );
try {
  if (TARGET === "mcp") {
    document.documentElement.classList.add("mcp-app");
    const app = new App({ name: APP_NAME, version: "0.2.0" });
    runtime = new Runtime(
      {
        call: (name, input, signal) =>
          app.callServerTool(
            { name, arguments: input as Record<string, unknown> },
            { signal },
          ),
        read: (uri, signal) => app.readServerResource({ uri }, { signal }),
        close: () => app.close(),
      },
      validate,
      "mcp",
    );
    app.ontoolinput = (event) => {
      input = event.arguments ?? {};
      mount();
    };
    app.ontoolresult = (event) => {
      try {
        result = runtime.result(presentation.open, event);
        toolError = undefined;
      } catch (error) {
        result = undefined;
        toolError = error instanceof Error ? error : new Error(String(error));
      }
      mount();
      runtime.refresh();
    }; // A result can invalidate reads, never replay an action.
    app.onhostcontextchanged = (event) => {
      if (event.theme) document.documentElement.style.colorScheme = event.theme;
    };
    app.onteardown = async () => {
      root.unmount();
      // Keep the bridge open long enough to deliver the teardown acknowledgement.
      runtime.dispose();
      return {};
    };
    await app.connect();
    mount();
  } else {
    const client = new Client(
      { name: `${APP_NAME}-web`, version: "0.2.0" },
      { versionNegotiation: { mode: "auto" } },
    );
    await client.connect(
      new StreamableHTTPClientTransport(new URL(ENDPOINT, location.href)),
    );
    const watchers = new Map<string, Set<() => void>>();
    client.setNotificationHandler(
      "notifications/resources/updated",
      (event) => {
        for (const listener of watchers.get(event.params.uri) ?? []) listener();
      },
    );
    runtime = new Runtime(
      {
        call: (name, input, signal) =>
          client.callTool(
            { name, arguments: input as Record<string, unknown> },
            { signal },
          ),
        read: (uri, signal) =>
          client.readResource({ uri }, { signal, cacheMode: "bypass" }),
        ...(client.getServerCapabilities()?.resources?.subscribe
          ? {
              watch: async (
                uri: string,
                changed: () => void,
                signal: AbortSignal,
              ) => {
                const callbacks = watchers.get(uri) ?? new Set<() => void>();
                callbacks.add(changed);
                watchers.set(uri, callbacks);
                try {
                  if (client.getProtocolEra() === "legacy") {
                    await client.subscribeResource({ uri }, { signal });
                    return () => {
                      callbacks.delete(changed);
                      void client.unsubscribeResource({ uri }).catch(() => {});
                    };
                  }
                  let subscription = await client.listen(
                    { resourceSubscriptions: [uri] },
                    { signal },
                  );
                  if (
                    !subscription.honoredFilter.resourceSubscriptions?.includes(
                      uri,
                    )
                  ) {
                    await subscription.close();
                    throw new Error("Subscription declined");
                  }
                  let stopped = false;
                  void (async () => {
                    while (!signal.aborted && !stopped) {
                      await subscription.closed;
                      if (signal.aborted || stopped) return;
                      changed();
                      let delay = 250;
                      for (;;) {
                        await new Promise<void>((done) => {
                          const finish = () => {
                            clearTimeout(timer);
                            signal.removeEventListener("abort", finish);
                            done();
                          };
                          const timer = setTimeout(finish, delay);
                          signal.addEventListener("abort", finish, {
                            once: true,
                          });
                        });
                        if (signal.aborted || stopped) return;
                        try {
                          subscription = await client.listen(
                            { resourceSubscriptions: [uri] },
                            { signal },
                          );
                          if (
                            !subscription.honoredFilter.resourceSubscriptions?.includes(
                              uri,
                            )
                          ) {
                            await subscription.close();
                            throw new Error("Subscription declined");
                          }
                          changed();
                          break;
                        } catch {
                          changed();
                          delay = Math.min(delay * 2, 30000);
                        }
                      }
                    }
                  })();
                  return () => {
                    stopped = true;
                    callbacks.delete(changed);
                    void subscription.close();
                  };
                } catch (error) {
                  callbacks.delete(changed);
                  throw error;
                }
              },
            }
          : {}),
        close: () => client.close(),
      },
      validate,
    );
    mount();
    if (
      presentation.open.annotations?.readOnlyHint &&
      !presentation.open.inputSchema?.required?.length
    ) {
      try {
        result = await runtime.call(presentation.open, {});
      } catch (error) {
        toolError = error instanceof Error ? error : new Error(String(error));
      }
    }
    if (presentation.webMCP) {
      const context =
        (document as any).modelContext ?? (navigator as any).modelContext;
      for (const tool of Object.values(tools) as Tool<object, unknown>[])
        if (context) {
          await context.registerTool({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
            execute: async (input: object) => ({
              content: [
                {
                  type: "text",
                  text: JSON.stringify(await runtime.call(tool, input)),
                },
              ],
            }),
          });
          removals.push(() => context.unregisterTool?.(tool.name));
        }
    }
    mount();
    window.addEventListener(
      "pagehide",
      () => {
        root.unmount();
        removals.forEach((remove) => remove());
        void runtime.close();
      },
      { once: true },
    );
  }
} catch (error) {
  removals.forEach((remove) => remove());
  await runtime?.close();
  root.render(<main role="alert">{String(error)}</main>);
}
