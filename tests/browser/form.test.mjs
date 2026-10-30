import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cpSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createServer } from "node:http";
import { chromium } from "playwright";
import {
  McpServer,
  createMcpHandler,
  fromJsonSchema,
} from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { temporary } from "../helpers.mjs";

test("one generated form serializes values and preserves failed drafts on web and CSP-restricted MCP Apps", async (t) => {
  const root = temporary(t),
    sdk = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
  const installed = join(root, "node_modules/holon-ui");
  mkdirSync(installed, { recursive: true });
  const pkg = JSON.parse(readFileSync(join(sdk, "package.json"), "utf8"));
  for (const file of [...pkg.files, "package.json"]) {
    const dest = join(installed, file);
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(join(sdk, file), dest, { recursive: true });
  }
  for (const name of [
    "react",
    "react-dom",
    "typescript",
    "esbuild",
    "ajv",
    "ajv-formats",
    "holon-sh",
    "@modelcontextprotocol",
  ])
    symlinkSync(
      join(sdk, "node_modules", name),
      join(root, "node_modules", name),
    );
  writeFileSync(join(root, "package.json"), '{"type":"module"}');
  const schema = {
    type: "object",
    properties: {
      enabled: { type: "boolean", default: true },
      amount: { type: "number" },
      payload: { type: "array", items: { type: "number" } },
    },
    required: ["enabled", "amount", "payload"],
    additionalProperties: false,
  };
  const tool = {
    kind: "tool",
    name: "echo",
    description: "Echo typed arguments",
    inputSchema: schema,
    outputSchema: schema,
  };
  writeFileSync(
    join(installed, "generated/app.json"),
    JSON.stringify({
      identity: { name: "echo", version: "1" },
      schema: { tools: [tool], resources: [] },
    }),
  );
  writeFileSync(
    join(installed, "generated/refs.js"),
    `export const tools={echo:${JSON.stringify(tool)}},resources={};`,
  );
  const entry = join(root, "main.tsx");
  writeFileSync(
    entry,
    'import {tools} from "holon-ui/app";import {view} from "holon-ui/react";export default view(tools.echo);',
  );
  const previous = process.cwd();
  process.chdir(root);
  t.after(() => process.chdir(previous));
  const { build } = await import(pathToFileURL(join(installed, "build.mjs")));
  await build({ entry: "main.tsx" });
  const [view] = JSON.parse(
    readFileSync(join(root, "dist/views.json"), "utf8"),
  );
  const page = readFileSync(join(root, "dist", view.file), "utf8").replace(
    "<head>",
    `<head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'">`,
  );
  const calls = [];
  const handler = createMcpHandler(
    () => {
      const server = new McpServer({ name: "echo", version: "1" });
      server.registerTool(
        "echo",
        {
          inputSchema: fromJsonSchema(schema),
          outputSchema: fromJsonSchema(schema),
          _meta: { ui: { resourceUri: view.uri } },
        },
        (input) => {
          calls.push(input);
          if (input.amount < 0) throw new Error("Negative amount rejected");
          return { content: [], structuredContent: input };
        },
      );
      server.registerResource(
        "Echo",
        view.uri,
        { mimeType: "text/html;profile=mcp-app" },
        () => ({
          contents: [
            {
              uri: view.uri,
              mimeType: "text/html;profile=mcp-app",
              text: page,
              _meta: {
                ui: { csp: { connectDomains: [], resourceDomains: [] } },
              },
            },
          ],
        }),
      );
      return server;
    },
    { legacy: "reject" },
  );
  const dispatch = toNodeHandler(handler);
  const http = createServer((req, res) => {
    if (req.url === "/mcp") {
      void dispatch(req, res);
      return;
    }
    res.setHeader("content-type", "text/html");
    res.end(
      readFileSync(
        join(
          root,
          "dist/web",
          req.url === "/host.html" ? "host.html" : "index.html",
        ),
      ),
    );
  });
  await new Promise((resolve) => http.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await handler.close();
    http.closeAllConnections();
    await new Promise((resolve) => http.close(resolve));
  });
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {}),
  });
  t.after(() => browser.close());
  const origin = `http://127.0.0.1:${http.address().port}`;
  for (const surface of ["web", "mcp"]) {
    const tab = await browser.newPage(),
      errors = [];
    tab.on("pageerror", (error) => errors.push(error.message));
    await tab.goto(origin + (surface === "web" ? "/" : "/host.html"));
    const ui = surface === "web" ? tab : tab.frameLocator("iframe");
    const checkbox = ui.locator("input[name=enabled]");
    await checkbox.waitFor();
    assert.equal(await checkbox.isChecked(), true);
    await checkbox.uncheck();
    await ui.locator("input[name=amount]").fill("2.5");
    await ui.locator("textarea[name=payload]").fill("[1,2]");
    await ui.getByRole("button", { name: "echo", exact: true }).click();
    await ui.locator("pre").filter({ hasText: "2.5" }).waitFor();
    assert.deepEqual(calls.at(-1), {
      enabled: false,
      amount: 2.5,
      payload: [1, 2],
    });
    await ui.locator("input[name=amount]").fill("-1");
    await ui.getByRole("button", { name: "echo", exact: true }).click();
    await ui
      .getByRole("alert")
      .filter({ hasText: "Negative amount rejected" })
      .waitFor();
    assert.equal(await ui.locator("input[name=amount]").inputValue(), "-1");
    assert.deepEqual(errors, []);
    await tab.close();
  }
  assert.equal(calls.length, 4, "opening a mutation view must not execute it");
  writeFileSync(
    entry,
    'import "node:fs";import {tools} from "holon-ui/app";import {view} from "holon-ui/react";export default view(tools.echo);',
  );
  await assert.rejects(build({ entry: "main.tsx" }), /Server import node:fs/);
});
