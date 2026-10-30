import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { ReactNode, ComponentType } from "react";
import type { Resource, Schema, Tool } from "./app.js";
import { Runtime, denied } from "./state.js";
export type { Tool, Resource, Input, Output, Value } from "./app.js";
export { Runtime } from "./state.js";
export type { Transport, State } from "./state.js";

export const RuntimeContext = createContext<Runtime | null>(null);
export function useRuntime() {
  const runtime = useContext(RuntimeContext);
  if (!runtime) throw new Error("Missing app runtime");
  return runtime;
}
export function useResource<T>(
  resource: Resource<T>,
  options: { poll?: number } = {},
) {
  const runtime = useRuntime();
  const entry = useMemo(
    () => runtime.entry(resource, options.poll),
    [runtime, resource, options.poll],
  );
  const state = useSyncExternalStore(entry.subscribe, entry.snapshot);
  return { ...state, refresh: entry.refresh };
}
type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};
type Known<T> = {
  [K in keyof T as string extends K
    ? never
    : number extends K
      ? never
      : K]: T[K];
};
type Path<T> = {
  [K in keyof Known<T> & string]: NonNullable<T[K]> extends readonly unknown[]
    ? K
    : NonNullable<T[K]> extends object
      ? `${K}.${Path<NonNullable<T[K]>>}`
      : K;
}[keyof Known<T> & string];
export type FormProps<I, O> = {
  action: Tool<I, O>;
  bind?: Partial<NoInfer<I>>;
  defaults?: DeepPartial<NoInfer<I>>;
  label?: string;
  clear?: Path<NoInfer<I>>[];
  denied?: string;
  children?: ReactNode;
  onSuccess?: (result: O) => void;
  className?: string;
};
const get = (value: any, path: string): any =>
  path.split(".").reduce((value, key) => value?.[key], value);
function set(value: any, path: string, next: unknown) {
  const parts = path.split("."),
    last = parts.pop()!;
  parts.reduce((value, key) => {
    if (!Object.hasOwn(value, key)) value[key] = Object.create(null);
    return value[key];
  }, value)[last] = next;
}
function leaves(
  schema: Schema,
  prefix = "",
  root = schema,
  seen = new Set<Schema>(),
): { path: string; schema: Schema; required: boolean }[] {
  if (schema.$ref?.startsWith("#/")) {
    const resolved = schema.$ref
      .slice(2)
      .split("/")
      .reduce(
        (node: any, key) =>
          node?.[key.replaceAll("~1", "/").replaceAll("~0", "~")],
        root,
      );
    if (!resolved) throw new Error(`Unknown form schema ${schema.$ref}`);
    schema = resolved;
  }
  return Object.entries(schema.properties ?? {}).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value.$ref?.startsWith("#/"))
      value = value.$ref
        .slice(2)
        .split("/")
        .reduce(
          (node: any, key) =>
            node?.[key.replaceAll("~1", "/").replaceAll("~0", "~")],
          root,
        );
    return value.type === "object" &&
      value.properties &&
      !seen.has(value) &&
      schema.required?.includes(key)
      ? leaves(value, path, root, new Set(seen).add(schema))
      : [{ path, schema: value, required: !!schema.required?.includes(key) }];
  });
}
export function Form<I extends object, O>(props: FormProps<I, O>) {
  const runtime = useRuntime(),
    ref = useRef<HTMLFormElement>(null),
    busy = useRef(false);
  const focusAfter = useRef<HTMLInputElement | null>(null);
  const [pending, setPending] = useState(false),
    [error, setError] = useState("");
  useLayoutEffect(() => {
    if (!pending) {
      focusAfter.current?.focus();
      focusAfter.current = null;
    }
  }, [pending]);
  const fields = leaves(props.action.inputSchema).filter(
    (field) => !(field.path.split(".")[0] in (props.bind ?? {})),
  );
  async function submit() {
    const form = ref.current!;
    if (busy.current || !form.reportValidity()) return;
    busy.current = true;
    setPending(true);
    setError("");
    try {
      const input: any = Object.create(null);
      const data = new FormData(form);
      for (const { path, schema, required } of fields) {
        const value = data.get(path);
        if (
          !required &&
          schema.type !== "boolean" &&
          (value === null || value === "")
        )
          continue;
        set(
          input,
          path,
          schema.type === "boolean"
            ? value !== null
            : schema.type === "number" || schema.type === "integer"
              ? Number(value)
              : schema.type === "string"
                ? value
                : JSON.parse(String(value)),
        );
      }
      Object.assign(input, props.bind); // A binding supplies arguments; it is not authorization.
      const result = await runtime.call(props.action, input);
      try {
        props.onSuccess?.(result);
      } catch (error) {
        console.error("Success observer failed", error);
      }
      for (const path of props.clear ?? []) {
        const field = form.elements.namedItem(path) as HTMLInputElement | null;
        if (field) {
          if (field.type === "checkbox") field.checked = false;
          else field.value = "";
          focusAfter.current = field;
        }
      }
    } catch (error) {
      setError(
        denied(error) ? (props.denied ?? "Permission denied") : String(error),
      );
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return (
    <form
      className={props.className}
      ref={ref}
      onSubmit={(event) => event.preventDefault()}
      onClickCapture={(event) => {
        const button = (event.target as Element).closest("button");
        if (button?.type === "submit") {
          event.preventDefault();
          void submit();
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
          event.preventDefault();
          void submit();
        }
      }}
    >
      <fieldset disabled={pending}>
        {props.children ?? (
          <>
            {fields.map(({ path, schema, required }) => (
              <label key={path}>
                {schema.title ??
                  path
                    .split(".")
                    .at(-1)!
                    .replace(
                      /(^|_)([a-z])/g,
                      (_, space, letter) =>
                        (space ? " " : "") + letter.toUpperCase(),
                    )}
                {!["string", "boolean", "number", "integer"].includes(
                  schema.type ?? "",
                ) ? (
                  <textarea
                    name={path}
                    required={required}
                    defaultValue={
                      get(props.defaults, path) === undefined
                        ? ""
                        : JSON.stringify(get(props.defaults, path))
                    }
                  />
                ) : (
                  <input
                    name={path}
                    type={
                      schema.type === "boolean"
                        ? "checkbox"
                        : schema.type === "number" || schema.type === "integer"
                          ? "number"
                          : "text"
                    }
                    required={required && schema.type !== "boolean"}
                    defaultValue={
                      schema.type === "boolean"
                        ? undefined
                        : (get(props.defaults, path) ??
                          schema.default ??
                          schema.const)
                    }
                    defaultChecked={
                      schema.type === "boolean"
                        ? ((get(props.defaults, path) ??
                            schema.default ??
                            schema.const ??
                            false) as boolean)
                        : undefined
                    }
                    step={schema.type === "number" ? "any" : undefined}
                  />
                )}
              </label>
            ))}
            <button type="button" onClick={() => void submit()}>
              {pending
                ? "Working…"
                : (props.label ?? props.action.name?.replaceAll("_", " "))}
            </button>
          </>
        )}
      </fieldset>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}

export interface Presentation<I extends object, O> {
  open: Tool<I, O>;
  component?: ComponentType<{ input?: I; result?: O; error?: Error }>;
  webMCP?: boolean;
}
/** Bind a tool result to ordinary React, or omit the component for a generated form. */
export function view<I extends object, O>(
  open: Tool<I, O>,
  component?: Presentation<I, O>["component"],
  options: { webMCP?: boolean } = {},
): Presentation<I, O> {
  return { open, component, ...options };
}
