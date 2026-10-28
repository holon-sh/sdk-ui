// Regenerates tests/fixtures/checkout with the holon CLI's compiler:
//   HOLON=/path/to/holon npm run fixtures   (default: `holon` on PATH; install with `uv tool install --prerelease allow holon-types`)
// The request mirrors the slot the CLI writes into node_modules/holon-ui/generated/, and the
// contracts match holon-sh/sdk-ts's fixtures (packages/node/scripts/fixtures.mjs).
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const holon = process.env.HOLON || "holon";
const directory = fileURLToPath(new URL("../tests/fixtures/checkout/", import.meta.url));
const contract = { tools: [
  { name: "get_order",
    inputSchema: { type: "object", properties: { orderId: { $ref: "#/$defs/OrderId" }, count: { type: "number", default: 5 } }, required: ["orderId"], $defs: { OrderId: { type: "string" } } },
    outputSchema: { type: "object", properties: { total: { $ref: "#/$defs/Total" } }, required: ["total"], additionalProperties: false, $defs: { Total: { type: "number" } } },
  },
  { name: "then", inputSchema: { type: "object", additionalProperties: false } },
  { name: "toJSON", inputSchema: { type: "object", additionalProperties: false } },
  { name: "unknown_output", inputSchema: { type: "object", additionalProperties: false } },
], resources: [{ uri: "orders://summary", outputSchema: z.toJSONSchema(z.object({ total: z.number() })) }] };
const dependencies = { orders: contract, "with-hyphen": { tools: [contract.tools[1]] } };
// A browser view also calls its own server, keyed by the last segment of its server.json name (as the CLI does).
const request = {
  target: "browser", identity: { name: "checkout", version: "1" }, requires: { orders: { name: "orders", version: "1" } },
  contracts: { ...dependencies, checkout: contract }, browser_runtime_specifier: "../runtime.mjs", protocol_specifier: "holon-sh/protocol",
  entry: "index", own: "checkout", banner: "holon-generated-apps-v1 app=checkout",
};
rmSync(directory, { recursive: true, force: true });
mkdirSync(directory, { recursive: true });
const input = JSON.stringify(request, null, 2) + "\n";
writeFileSync(join(directory, "browser.request.json"), input);
execFileSync(holon, ["types", "compile", "--out", directory], { input, stdio: ["pipe", "inherit", "inherit"] });
