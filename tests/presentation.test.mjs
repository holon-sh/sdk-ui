import assert from "node:assert/strict";
import { test } from "node:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Runtime } from "../state.js";
import { temporary, typecheck } from "./helpers.mjs";

const tick = () => new Promise((resolve) => setImmediate(resolve));
const schema = { type: "object" };
const resource = { kind: "resource", uri: "counter://state", schema };
const action = {
  kind: "tool",
  name: "add",
  inputSchema: schema,
  outputSchema: schema,
  changes: [resource.uri],
};

test("successful actions publish their exact result and refresh canonical state; denied reads clear it", async () => {
  let count = 0,
    deny = false,
    calls = 0;
  const runtime = new Runtime(
    {
      async call() {
        calls++;
        return {
          resultType: "complete",
          structuredContent: { id: ++count },
          content: [],
        };
      },
      async read() {
        if (deny) throw Object.assign(new Error("Forbidden"), { status: 403 });
        return {
          contents: [{ uri: resource.uri, text: JSON.stringify({ count }) }],
        };
      },
      async close() {},
    },
    () => {},
  );
  const state = runtime.entry(resource),
    stop = state.subscribe(() => {}),
    results = [];
  runtime.onResult(action, (result) => results.push(result));
  await tick();
  assert.deepEqual(state.snapshot().data, { count: 0 });
  await runtime.call(action, { amount: 1 });
  await tick();
  assert.deepEqual(results, [{ id: 1 }]);
  assert.deepEqual(state.snapshot().data, { count: 1 });
  deny = true;
  state.refresh();
  await tick();
  assert.equal(state.snapshot().data, undefined);
  assert.equal(state.snapshot().denied, true);
  // Rendering a host result does not execute or re-observe the mutation.
  runtime.result(action, { structuredContent: { id: 1 }, content: [] });
  assert.equal(calls, 1);
  assert.equal(results.length, 1);
  stop();
  await runtime.close();
});

test("unmount aborts pending reads and failed mutations are not retried", async () => {
  let resolveRead,
    signal,
    calls = 0;
  const runtime = new Runtime(
    {
      async call() {
        calls++;
        throw new Error("Rejected");
      },
      read(uri, abort) {
        signal = abort;
        return new Promise((resolve) => {
          resolveRead = resolve;
        });
      },
      async close() {},
    },
    () => {},
  );
  const state = runtime.entry(resource),
    stop = state.subscribe(() => {});
  await tick();
  stop();
  assert.equal(signal.aborted, true);
  resolveRead({ contents: [{ uri: resource.uri, text: '{"count":99}' }] });
  await tick();
  assert.equal(state.snapshot().data, undefined);
  await assert.rejects(runtime.call(action, {}), /Rejected/);
  await tick();
  assert.equal(calls, 1);
  await runtime.close();
});

test("form arguments and clear paths remain typed for Python's open argument objects", (t) => {
  const root = temporary(t),
    source = join(root, "form.mts");
  const react = fileURLToPath(new URL("../react.js", import.meta.url));
  const app = fileURLToPath(new URL("../app.js", import.meta.url));
  writeFileSync(
    source,
    `import {Form} from ${JSON.stringify(react)};import type {Tool} from ${JSON.stringify(app)};
declare const send:Tool<{author:{name:string};text:string;[key:string]:unknown},{id:string}>;
Form({action:send,clear:["text","author.name"],defaults:{author:{name:"Guest"}},onSuccess:result=>result.id});
// @ts-expect-error wrong bound argument type
Form({action:send,bind:{author:"Guest"}});
// @ts-expect-error not a declared field
Form({action:send,clear:["missing"]});
// @ts-expect-error wrong result field
Form({action:send,onSuccess:result=>result.missing});
`,
  );
  typecheck(source);
});
