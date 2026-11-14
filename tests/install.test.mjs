import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, copyFileSync, cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const repository = dirname(dirname(fileURLToPath(import.meta.url)));
const fixtures = join(repository, "tests/fixtures");
const root = realpathSync(mkdtempSync(join(tmpdir(), "holon-ui-")));
const consumer = join(root, "consumer");
after(() => rmSync(root, { recursive: true, force: true }));

before(() => {
  const packed = execFileSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", root], {
    cwd: repository,
    encoding: "utf8",
  });
  const [tarball] = JSON.parse(packed);
  mkdirSync(consumer);
  const { devDependencies } = JSON.parse(readFileSync(join(repository, "package.json"), "utf8"));
  writeFileSync(join(consumer, "package.json"), JSON.stringify({
    type: "module",
    private: true,
    imports: { "#holon-ui": "./generated/holon-ui/index.mjs" },
    dependencies: { "holon-ui": `file:${join(root, tarball.filename)}` },
    devDependencies: {
      "@types/node": devDependencies["@types/node"],
      typescript: devDependencies.typescript,
      vite: devDependencies.vite,
      zod: devDependencies.zod,
    },
  }));
  execFileSync("npm", ["install", "--no-audit", "--no-fund", "--prefer-offline"], {
    cwd: consumer,
    stdio: "inherit",
  });
  cpSync(join(fixtures, "checkout"), join(consumer, "generated/holon-ui"), { recursive: true });
  copyFileSync(join(fixtures, "consumer.ts"), join(consumer, "consumer.ts"));
  cpSync(join(fixtures, "page"), consumer, { recursive: true });
  writeFileSync(join(consumer, "ui/texture.bin"), Buffer.alloc(5000));
});

const build = () => execFileSync("npm", ["exec", "--offline", "--", "vite", "build"], { cwd: consumer, stdio: "pipe" });
const read = path => readFileSync(join(consumer, path), "utf8");

test("the packed package installs, loads on both surfaces, and type-checks generated clients and the Vite plugin", () => {
  const generated = JSON.stringify(pathToFileURL(join(consumer, "generated/holon-ui/index.mjs")).href);
  for (const conditions of [[], ["--conditions=mcp-app"]]) {
    execFileSync(process.execPath, [...conditions, "--input-type=module", "--eval", `await import(${generated})`], { cwd: consumer, stdio: "inherit" });
  }
  execFileSync("npm", [
    "exec", "--offline", "--", "tsc", "--noEmit", "--strict", "--target", "es2023", "--types", "node",
    "--module", "nodenext", "consumer.ts", "vite.config.ts",
  ], { cwd: consumer, stdio: "inherit" });
});

test("vite build writes the web page and the view, one HTML file that calls its app through the host", () => {
  build();
  const view = read("dist/mcp/index.html");
  assert.ok(read("dist/web/index.html").includes(' src="./'));
  assert.ok(readdirSync(join(consumer, "dist/web/assets")).some(name => read(`dist/web/assets/${name}`).includes("modelContext")));
  assert.ok(view.includes("ui/initialize"));
  assert.deepEqual(readdirSync(join(consumer, "dist/mcp")), ["index.html"]);
  assert.ok(!view.includes("<!--"));
  assert.equal(view.indexOf("</style"), view.lastIndexOf("</style"));
});

test("vite build fails when the view would need a file beside it", () => {
  writeFileSync(join(consumer, "ui/worker.js"), "");
  appendFileSync(join(consumer, "ui/main.js"), `new Worker(new URL("./worker.js", import.meta.url));\n`);
  assert.throws(build);
});
