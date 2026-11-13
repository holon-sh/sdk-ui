import {
  App, createApps, exposeTools, registerPageTools, ToolCallError,
  type Apps, type Resources, type Inputs, type Outputs, type InputTypes, type OutputTypes,
} from "#holon-ui";
import type { Connect, EndpointBinding } from "holon-ui/runtime";
import type { App as HostApp } from "@modelcontextprotocol/ext-apps";
import { z } from "zod";

const view = new App({ name: "checkout-view", version: "1.0.0" }, {}, { autoResize: false });
view satisfies HostApp;
view.ontoolresult = ({ structuredContent }) => structuredContent;
await view.connect();
(await view.tools.get_order({ orderId: "own" })).total.toFixed();
const summary: Resources["checkout"]["orders://summary"] = await view.resources["orders://summary"].read();
summary.total.toFixed();
const result = await view.callTool({ name: "get_order", arguments: { orderId: "own" } });
if (result.resultType === "complete" && !result.isError) {
  result.structuredContent.total.toFixed();
}
// @ts-expect-error orderId must be a string.
view.tools.get_order({ orderId: 1 });
// @ts-expect-error The app has no lookup tool.
view.tools.lookup;

await registerPageTools({
  move: {
    description: "Move",
    inputSchema: z.object({ x: z.number() }),
    execute: ({ x }) => x.toFixed(),
  },
  // @ts-expect-error The schema supplies x, not y.
  wrong: { description: "Wrong", inputSchema: z.object({ x: z.number() }), execute: ({ y }) => y },
}, {
  view: { registerTool: () => ({ remove() {} }) },
  signal: new AbortController().signal,
});

const apps = createApps({
  orders: { endpoint: new URL("https://orders.example/mcp"), installationUID: "installation-one" },
  "with-hyphen": { endpoint: new URL("https://other.example/mcp") },
});
(await apps.orders.tools.get_order({ orderId: "direct" })).total.toFixed();
const checkout = createApps({ checkout: { endpoint: new URL("https://checkout.example/mcp") } });
(await checkout.checkout.listTools()).tools[0]?.description?.toUpperCase();
const exposed: boolean = await exposeTools(checkout.checkout, {
  signal: new AbortController().signal,
  execute: async (name, args) => name + JSON.stringify(args),
});
await exposeTools(apps.orders);
// @ts-expect-error Direct bindings need an endpoint.
createApps({ orders: {} });
// @ts-expect-error A host view is not an endpoint binding.
createApps({ checkout: { host: view } });

const ordersBinding: EndpointBinding = { endpoint: "https://orders.example/mcp" };
const ordersOnly = createApps({ orders: ordersBinding });
ordersOnly satisfies Pick<Apps, "orders">;
// @ts-expect-error Only the explicitly bound app is available.
ordersOnly["with-hyphen"];
// @ts-expect-error Bindings must name a declared app.
createApps({ missing: ordersBinding });
// @ts-expect-error The then tool is excluded from the property-based API.
ordersOnly.orders.tools.then;

const orderId: InputTypes["orders"]["get_order"]["OrderId"] = "ord";
const total: OutputTypes["orders"]["get_order"]["Total"] = 1;
// @ts-expect-error The named OrderId schema is a string, not a number.
const wrongId: InputTypes["orders"]["get_order"]["OrderId"] = total;
const input: Inputs["checkout"]["get_order"] = { orderId };
const output: Outputs["checkout"]["get_order"] = { total };
try {
  await view.tools.get_order(input);
} catch (error) {
  if (error instanceof ToolCallError) error.result.resultType.toUpperCase();
}

// connect as the generated module narrows it to the page's own app.
declare const connect: Connect<Inputs["checkout"], Outputs["checkout"], Resources["checkout"]>;
const page = await connect({
  tools: {
    select: { description: "Select", inputSchema: z.object({ ids: z.array(z.string()) }), execute: ({ ids }, { signal }) => ids.length + Number(signal.aborted) },
    selection: { description: "List the selection", annotations: { readOnlyHint: true }, execute: () => [] },
    // @ts-expect-error The schema supplies ids, not names.
    wrong: { description: "Wrong", inputSchema: z.object({ ids: z.array(z.string()) }), execute: ({ names }) => names },
  },
  view: { autoResize: false },
});
(await page.tools.get_order({ orderId: "own" })).total.toFixed();
(await page.resources["orders://summary"].read()).total.toFixed();
// @ts-expect-error The app has no lookup tool.
page.tools.lookup;
const opened = await page.opened;
if (opened?.tool === "get_order") opened.output.total.toFixed();
if (page.view) page.view.onhostcontextchanged = ({ theme }) => theme?.toUpperCase();
// @ts-expect-error A page tool cannot take the name of one of the app's tools.
connect({ tools: { get_order: { description: "Shadow", execute: () => {} } } });
