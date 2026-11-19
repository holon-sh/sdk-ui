import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { parseArgs } from "node:util";
import { createMcpHandler, fromJsonSchema, McpServer } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { initialSettings } from "./vercel-ui/benchmarks/agent/src/settings.ts";
import { tools } from "./tools.mjs";

const { values: flags } = parseArgs({ options: { port: { type: "string", default: "5700" }, tools: { type: "string", default: "domain" } } });
const web = join(import.meta.dirname, "dist/web");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

const settings = initialSettings();
const saves = [];
let changed = false;

const member = id => {
  const found = settings.members.find(member => member.id === id);
  if (!found) throw new Error(`No member has the id ${id}.`);
  return found;
};

const run = {
  get_settings: () => settings,
  save_settings: input => {
    Object.assign(settings, structuredClone(input));
    saves.push(structuredClone(settings));
    return settings;
  },
  update_project: ({ name, visibility }) => {
    if (name !== undefined) settings.name = name;
    if (visibility !== undefined) settings.visibility = visibility;
    return { name: settings.name, visibility: settings.visibility };
  },
  set_member_role: ({ memberId, role }) => Object.assign(member(memberId), { role }),
  remove_member: ({ memberId }) => {
    const removed = member(memberId);
    settings.members = settings.members.filter(member => member !== removed);
    return { removed };
  },
  set_notification: ({ channel, notification, on }) => {
    if (!Object.hasOwn(settings[channel], notification)) throw new Error(`${channel} has no notification named ${notification}. It has: ${Object.keys(settings[channel]).join(", ")}.`);
    settings[channel][notification] = on;
    return { channel, notification, on };
  },
};

const handler = createMcpHandler(() => {
  const server = new McpServer({ name: "example.com/settings", version: "1" });
  for (const { name, description, inputSchema, outputSchema, annotations, page } of tools) {
    if (flags.tools !== "domain" && !page && name !== "get_settings") continue;
    const visibility = flags.tools === "form" || (page && flags.tools === "domain") ? ["app"] : ["model", "app"];
    server.registerTool(name, { description, inputSchema: fromJsonSchema(inputSchema), outputSchema: fromJsonSchema(outputSchema), annotations, _meta: { ui: { visibility } } }, input => {
      const output = run[name](input);
      if (name !== "get_settings" && name !== "save_settings") changed = true;
      return { content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: output };
    });
  }
  return server;
}, { legacy: "reject" });
const mcp = toNodeHandler(handler);

const shim = `<script>
  window.__agentTools = [];
  window.__agent = {};
  document.modelContext = { registerTool: async (tool, { signal } = {}) => {
    window.__agentTools.push({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema ?? { type: "object", properties: {} } });
    window.__agent[tool.name] = input => tool.execute(input, { signal: new AbortController().signal });
    signal?.addEventListener("abort", () => { delete window.__agent[tool.name]; });
  } };
</script>`;

createServer(async (request, response) => {
  const url = new URL(request.url, "http://localhost");
  try {
    if (url.pathname === "/mcp") return await mcp(request, response);
    if (url.pathname === "/__saved") return response.setHeader("content-type", "application/json").end(JSON.stringify(saves.length ? saves : changed ? [settings] : []));
    const file = url.pathname === "/" ? "index.html" : normalize(url.pathname).slice(1);
    const body = await readFile(join(web, file));
    response.setHeader("content-type", types[extname(file)] ?? "application/octet-stream");
    response.end(file === "index.html" && url.searchParams.has("agent") ? String(body).replace("<head>", () => `<head>${shim}`) : body);
  } catch {
    response.writeHead(404).end("Not found.");
  }
}).listen(Number(flags.port), "127.0.0.1", () => console.log(`http://127.0.0.1:${flags.port}`));
