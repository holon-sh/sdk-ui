// Literal schemas preserve $ref and names that SDK schema builders may rewrite.
import { McpServer, createMcpHandler, fromJsonSchema } from "@modelcontextprotocol/server";

export default createMcpHandler(() => {
  const server = new McpServer({ name: "example.com/orders", version: "1", description: "Orders" });
  server.registerTool("get_order", {
    inputSchema: fromJsonSchema({ type: "object", properties: { orderId: { $ref: "#/$defs/OrderId" }, count: { type: "number", default: 5 } }, required: ["orderId"], $defs: { OrderId: { type: "string" } } }),
    outputSchema: fromJsonSchema({ type: "object", properties: { total: { $ref: "#/$defs/Total" } }, required: ["total"], additionalProperties: false, $defs: { Total: { type: "number" } } }),
  }, () => ({ content: [] }));
  for (const name of ["then", "toJSON", "unknown_output"]) server.registerTool(name, { inputSchema: fromJsonSchema({ type: "object", additionalProperties: false }) }, () => ({ content: [] }));
  server.registerResource("summary", "orders://summary", {
    _meta: { "sh.holon/outputSchema": { $schema: "https://json-schema.org/draft/2020-12/schema", type: "object", properties: { total: { type: "number" } }, required: ["total"], additionalProperties: false } },
  }, () => ({ contents: [] }));
  return server;
});
