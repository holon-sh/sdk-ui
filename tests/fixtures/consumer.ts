// Checks holon-ui's own types as the generated connect narrows them; compiling the generated module checks the rest.
import { connect } from "#holon-ui";
import { z } from "zod";

const app = await connect({
  tools: {
    select: { description: "Select", inputSchema: z.object({ ids: z.array(z.string()) }), execute: ({ ids }, { signal }) => ids.length + Number(signal.aborted) },
    // A tool without an input schema leaves the others' inputs inferred.
    selection: { description: "List the selection", execute: () => [] },
    // @ts-expect-error The schema supplies ids, not names.
    wrong: { description: "Wrong", inputSchema: z.object({ ids: z.array(z.string()) }), execute: ({ names }) => names },
  },
});
(await app.tools.get_order({ orderId: "own" })).total.toFixed();
const opened = await app.opened;
// @ts-expect-error Until narrowed by its tool, the output is not known.
opened?.output.total;
if (opened?.tool === "get_order") opened.output.total.toFixed();
// @ts-expect-error The view is undefined on a web page.
app.view.close();
// @ts-expect-error A page tool cannot take the name of one of the app's tools.
connect({ tools: { get_order: { description: "Shadow", execute: () => {} } } });
