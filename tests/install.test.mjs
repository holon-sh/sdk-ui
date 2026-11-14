import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const repository = dirname(dirname(fileURLToPath(import.meta.url)));
const fixtures = join(repository, "tests/fixtures");
const root = realpathSync(mkdtempSync(join(tmpdir(), "holon-ui-")));
const consumer = join(root, "consumer");
after(() => rmSync(root, { recursive: true, force: true }));

// A project that installs the packed package as an app does, with the generated clients of its own app.
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
});

test("the packed package installs, loads on both surfaces, and type-checks generated clients and the Vite plugin", () => {
  // Both surfaces ship: the generated module loads as a web page's build and as a view's.
  const generated = JSON.stringify(pathToFileURL(join(consumer, "generated/holon-ui/index.mjs")).href);
  for (const conditions of [[], ["--conditions=mcp-app"]]) {
    execFileSync(process.execPath, [...conditions, "--input-type=module", "--eval", `await import(${generated})`], { cwd: consumer, stdio: "inherit" });
  }

  const tsc = [
    "exec", "--offline", "--", "tsc", "--noEmit", "--strict",
    "--target", "es2023", "--types", "node", "consumer.ts", "vite.config.ts",
  ];
  // NodeNext is the stricter resolution, and checking the declarations too covers what a bundler would see.
  execFileSync("npm", [...tsc, "--module", "nodenext"], {
    cwd: consumer,
    stdio: "inherit",
  });
});

test("a plain vite build writes the web page and the view, one self-contained file calling through the host", () => {
  // Larger than the 4 KiB under which Vite inlines an asset anyway.
  writeFileSync(join(consumer, "ui/texture.bin"), Buffer.alloc(5000));
  execFileSync("npm", ["exec", "--offline", "--", "vite", "build"], { cwd: consumer, stdio: "inherit" });
  const web = readdirSync(join(consumer, "dist/web"), { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => readFileSync(join(entry.parentPath, entry.name), "utf8"))
    .join("\n");
  const view = readFileSync(join(consumer, "dist/mcp/index.html"), "utf8");

  // Relative, so the page works wherever it is served: at / and under /<app>/.
  assert.match(readFileSync(join(consumer, "dist/web/index.html"), "utf8"), / src="\.\/assets\//);

  // The web page offers its tools through WebMCP; a view opens with the MCP Apps handshake.
  assert.match(web, /modelContext/);
  assert.match(view, /ui\/initialize/);

  assert.deepEqual(readdirSync(join(consumer, "dist/mcp")), ["index.html"]);
  // The page's code is all in the view's one script element, the dynamically imported module too, and holds no
  // "<!--", after which an HTML parser stops ending the element at its "</script>".
  const [, code] = view.match(/<script[^>]*>([\s\S]*?)<\/script>/);
  assert.match(code, /Total due: /);
  assert.doesNotMatch(code, /<!--/);
  assert.match(view, /url\(data:application\/octet-stream;base64,/, "the stylesheet's asset is inlined");
  // Left in the view, the placeholder makes the dynamic import throw.
  assert.doesNotMatch(view, /__VITE_PRELOAD__/);
});
