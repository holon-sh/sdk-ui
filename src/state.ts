import type { Resource, Tool } from "./app.js";

export interface Transport {
  call(name: string, input: unknown, signal: AbortSignal): Promise<any>;
  read(uri: string, signal: AbortSignal): Promise<any>;
  watch?: (
    uri: string,
    changed: () => void,
    signal: AbortSignal,
  ) => Promise<() => void>;
  close(): Promise<void>;
}
export type State<T> = {
  data?: T;
  loading: boolean;
  error?: string;
  denied: boolean;
};
export const denied = (error: any) =>
  error?.code === -32003 ||
  error?.denied === true ||
  [401, 403].includes(error?.status ?? error?.data?.status) ||
  ["InsufficientScopeError", "UnauthorizedError"].includes(error?.name);
export class Runtime {
  readonly lifetime = new AbortController();
  private entries = new Map<string, Entry<any>>();
  private results = new Map<string, Set<(output: any) => void>>();
  constructor(
    readonly transport: Transport,
    readonly validate: (schema: object, data: unknown) => void,
    readonly surface: "web" | "mcp" = "web",
  ) {}
  onResult<I, O>(tool: Tool<I, O>, listener: (output: O) => void) {
    const listeners = this.results.get(tool.name!) ?? new Set();
    listeners.add(listener);
    this.results.set(tool.name!, listeners);
    return () => {
      listeners.delete(listener);
    };
  }
  entry<T>(resource: Resource<T>, poll?: number): Entry<T> {
    let entry = this.entries.get(resource.uri);
    if (!entry) {
      entry = new Entry(this, resource, poll);
      this.entries.set(resource.uri, entry);
    }
    return entry;
  }
  async call<I, O>(tool: Tool<I, O>, input: I): Promise<O> {
    this.validate(tool.inputSchema, input);
    const result = await this.transport.call(
      tool.name!,
      input,
      this.lifetime.signal,
    );
    const output = this.result(tool, result);
    for (const listener of this.results.get(tool.name!) ?? []) {
      try {
        listener(output);
      } catch (error) {
        console.error("Result observer failed", error);
      }
    }
    for (const uri of tool.changes ?? []) this.entries.get(uri)?.refresh();
    return output;
  }
  result<I, O>(tool: Tool<I, O>, result: any): O {
    if (result.isError)
      throw Object.assign(
        new Error(
          result.content?.find((part: any) => part.type === "text")?.text ??
            "Action failed",
        ),
        {
          denied: result._meta?.["holon/error"] === "permission_denied",
        },
      );
    if (tool.outputSchema)
      this.validate(tool.outputSchema, result.structuredContent);
    return result.structuredContent;
  }
  refresh() {
    for (const entry of this.entries.values()) entry.refresh();
  }
  dispose() {
    this.lifetime.abort();
    for (const entry of this.entries.values()) entry.stop();
    this.results.clear();
  }
  async close() {
    this.dispose();
    await this.transport.close();
  }
}
class Entry<T> {
  private state: State<T> = { loading: true, denied: false };
  private listeners = new Set<() => void>();
  private generation = 0;
  private requested = 0;
  private reading = false;
  private active?: AbortController;
  private timer?: ReturnType<typeof setInterval>;
  private unwatch?: () => void;
  constructor(
    private runtime: Runtime,
    private resource: Resource<T>,
    private poll?: number,
  ) {}
  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    if (this.listeners.size === 1) void this.start();
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) this.stop();
    };
  };
  private publish(state: State<T>) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
  private async start() {
    this.active = new AbortController();
    const signal = AbortSignal.any([
      this.active.signal,
      this.runtime.lifetime.signal,
    ]);
    const generation = this.generation;
    try {
      // Subscribe before reading to avoid an initial read/subscribe gap.
      if (this.runtime.transport.watch) {
        const unwatch = await this.runtime.transport.watch(
          this.resource.uri,
          this.refresh,
          signal,
        );
        if (generation !== this.generation) {
          unwatch();
          return;
        }
        this.unwatch = unwatch;
      } else if (this.poll) {
        this.timer = setInterval(() => {
          if (!document.hidden) this.refresh();
        }, this.poll);
      }
      this.refresh();
    } catch (error) {
      if (!signal.aborted && this.poll && !denied(error)) {
        this.timer = setInterval(() => {
          if (!document.hidden) this.refresh();
        }, this.poll);
        this.refresh();
      } else if (!signal.aborted)
        this.publish({
          loading: false,
          denied: denied(error),
          error: String(error),
        });
    }
  }
  refresh = () => {
    this.requested++;
    if (this.reading || !this.active || this.active.signal.aborted) return;
    this.reading = true;
    const generation = this.generation;
    const signal = AbortSignal.any([
      this.active.signal,
      this.runtime.lifetime.signal,
    ]);
    void (async () => {
      let read = -1;
      while (!signal.aborted && read !== this.requested) {
        read = this.requested;
        try {
          const result = await this.runtime.transport.read(
            this.resource.uri,
            signal,
          );
          const content = result.contents?.find(
            (item: any) => item.uri === this.resource.uri && "text" in item,
          );
          if (!content) throw new Error("Resource has no JSON text content");
          const data = JSON.parse(content.text) as T;
          this.runtime.validate(this.resource.schema, data);
          if (!signal.aborted && read === this.requested)
            this.publish({ data, loading: false, denied: false });
        } catch (error) {
          if (!signal.aborted)
            this.publish({
              data: denied(error) ? undefined : this.state.data,
              loading: false,
              denied: denied(error),
              error: String(error),
            });
        }
      }
    })().finally(() => {
      if (generation === this.generation) this.reading = false;
    });
  };
  stop() {
    this.generation++;
    this.active?.abort();
    this.active = undefined;
    this.reading = false;
    clearInterval(this.timer);
    this.unwatch?.();
    this.unwatch = undefined;
  }
}
