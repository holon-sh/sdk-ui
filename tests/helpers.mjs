import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";

export function fixture(name) {
  return fileURLToPath(new URL(`fixtures/${name}`, import.meta.url));
}

export function temporary(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "holon-sdk-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

export async function serve(t, factory) {
  const handler = createMcpHandler(factory, { legacy: "reject" });
  const dispatch = toNodeHandler(handler);
  const http = createServer((req, res) => {
    void dispatch(req, res).catch(() => res.destroy());
  });
  t.after(async () => {
    await handler.close();
    http.closeAllConnections();
    await new Promise(resolve => http.close(resolve));
  });
  http.listen(0, "127.0.0.1");
  await once(http, "listening");
  return { endpoint: `http://127.0.0.1:${http.address().port}/mcp` };
}
