import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createServer } from "node:http";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import assert from "node:assert/strict";

export function fixture(name) {
  return fileURLToPath(new URL(`fixtures/${name}`, import.meta.url));
}

export function temporary(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "holon-sdk-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

const manifest = import.meta.resolve("typescript/package.json");
const tsc = fileURLToPath(new URL(JSON.parse(readFileSync(new URL(manifest), "utf8")).bin.tsc, manifest));

export function typecheck(source) {
  // Check browser declarations with Bundler resolution; retain NodeNext's library-skipping consumer check.
  for (const options of [["--module", "esnext", "--moduleResolution", "bundler"], ["--module", "nodenext", "--skipLibCheck"]]) {
    const checked = spawnSync(process.execPath, [tsc, "--noEmit", "--strict", "--target", "es2023", "--types", "node", ...options, source], { cwd: dirname(source), encoding: "utf8" });
    assert.equal(checked.status, 0, checked.stdout + checked.stderr);
  }
}

export async function serve(t, factory, onRequest) {
  const handler = createMcpHandler(factory, { legacy: "reject" });
  const dispatch = toNodeHandler(handler);
  const http = createServer((req, res) => {
    onRequest?.(req);
    void dispatch(req, res).catch(() => res.destroy());
  });
  t.after(async () => {
    await handler.close();
    http.closeAllConnections();
    await new Promise(resolve => http.close(resolve));
  });
  http.listen(0, "127.0.0.1");
  await once(http, "listening");
  return { handler, endpoint: `http://127.0.0.1:${http.address().port}/mcp` };
}
