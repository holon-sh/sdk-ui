// The only fixture refresh path: HOLON=/path/to/holon npm run fixtures.
// Uses public generation in a temporary browser project; no network is needed.
// The project's own server shares the orders contract, so the clients also have its App class.
// The project sits inside the repository so that every server loads the repository's MCP SDK.
import { execFileSync } from "node:child_process";
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const holon = process.env.HOLON ? resolve(process.env.HOLON) : "holon";
const directory = fileURLToPath(new URL("../tests/fixtures/checkout/", import.meta.url));
const orders = fileURLToPath(new URL("../tests/fixtures/orders/", import.meta.url));
const temporary = mkdtempSync(fileURLToPath(new URL("../.holon-fixtures-", import.meta.url)));
try {
  const consumer = join(temporary, "checkout");
  const runtime = join(consumer, "node_modules/holon-ui");
  mkdirSync(runtime, { recursive: true });
  copyFileSync(new URL("../package.json", import.meta.url), join(runtime, "package.json"));
  writeFileSync(join(consumer, "package.json"), JSON.stringify({ type: "module", dependencies: { "holon-ui": "*" } }));
  copyFileSync(join(orders, "server.js"), join(consumer, "server.js"));
  writeFileSync(join(consumer, "server.json"), JSON.stringify({ name: "example.com/checkout", version: "1", description: "Checkout" }));
  execFileSync(holon, ["types", "generate", "-s", "./server.js", "-s", `orders=${orders}`, "-s", `with-hyphen=${orders}`], { cwd: consumer, stdio: "inherit" });
  rmSync(directory, { recursive: true, force: true });
  cpSync(join(consumer, "generated/holon-ui"), directory, { recursive: true });
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
