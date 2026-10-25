import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createServer } from "node:http";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import assert from "node:assert/strict";
import ts from "typescript";

export function fixture(name) {
  return fileURLToPath(new URL(`fixtures/${name}`, import.meta.url));
}

export function temporary(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "holon-sdk-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

export function typecheck(source, resolutions = [ts.ModuleResolutionKind.NodeNext, ts.ModuleResolutionKind.Bundler]) {
  for (const moduleResolution of resolutions) {
    const program = ts.createProgram([source], { noEmit: true, strict: true, target: ts.ScriptTarget.ES2023, moduleResolution, module: moduleResolution === ts.ModuleResolutionKind.NodeNext ? ts.ModuleKind.NodeNext : ts.ModuleKind.ESNext });
    const diagnostics = ts.getPreEmitDiagnostics(program);
    assert.equal(diagnostics.length, 0, ts.formatDiagnostics(diagnostics, { getCurrentDirectory: () => dirname(source), getCanonicalFileName: p => p, getNewLine: () => "\n" }));
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
