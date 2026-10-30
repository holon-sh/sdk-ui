import { build as bundle } from "esbuild";
import ts from "typescript";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import standaloneCode from "ajv/dist/standalone/index.js";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

/** Build a static SPA, self-contained MCP App, and server view manifest. */
export async function build({
  entry,
  outDir = "dist",
  endpoint = "/mcp",
  title,
  ui = {},
}) {
  const root = process.cwd();
  const generated = fileURLToPath(new URL("./generated/", import.meta.url));
  const contract = JSON.parse(
    await readFile(resolve(generated, "app.json"), "utf8"),
  );
  if (!contract.schema)
    throw new Error("Run holon types generate before building a view");
  const source = ts.createSourceFile(
    entry,
    await readFile(resolve(root, entry), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const declaration = source.statements.find(ts.isExportAssignment)?.expression;
  const imports = new Map();
  for (const statement of source.statements)
    if (
      ts.isImportDeclaration(statement) &&
      statement.importClause?.namedBindings &&
      ts.isNamedImports(statement.importClause.namedBindings)
    ) {
      for (const binding of statement.importClause.namedBindings.elements)
        imports.set(binding.name.text, {
          module: statement.moduleSpecifier.text,
          name: (binding.propertyName ?? binding.name).text,
        });
    }
  const isImport = (expression, module, name) =>
    ts.isIdentifier(expression) &&
    imports.get(expression.text)?.module === module &&
    imports.get(expression.text)?.name === name;
  if (
    !declaration ||
    !ts.isCallExpression(declaration) ||
    !isImport(declaration.expression, "holon-ui/react", "view")
  )
    throw new Error(
      "Declare the presentation with export default view(tools.operation, Component?) imported from holon-ui/react",
    );
  const open = declaration.arguments[0];
  if (
    !open ||
    !ts.isPropertyAccessExpression(open) ||
    !isImport(open.expression, "holon-ui/app", "tools")
  )
    throw new Error(
      "A view's entry tool must be a generated tools.operation reference",
    );
  const tool = contract.schema.tools.find(
    (tool) => tool.name === open.name.text,
  );
  if (!tool) throw new Error(`Unknown presentation tool ${open.name.text}`);
  const schemas = [
    ...contract.schema.tools.flatMap((tool) =>
      [tool.inputSchema, tool.outputSchema].filter(Boolean),
    ),
    ...(contract.schema.resources ?? []).map(
      (resource) => resource.outputSchema,
    ),
  ];
  const unique = [
    ...new Map(
      schemas.map((schema) => [JSON.stringify(schema), schema]),
    ).entries(),
  ];
  const ajv = new Ajv2020({
    strict: false,
    ownProperties: true,
    code: { source: true, esm: true },
  });
  addFormats(ajv);
  const exports = {},
    lookup = {};
  for (const [key, schema] of unique) {
    const id = `urn:holon:validator:${Object.keys(exports).length}`,
      name = `v${Object.keys(exports).length}`;
    ajv.addSchema(schema, id);
    exports[name] = id;
    lookup[key] = name;
  }
  const validators =
    standaloneCode(ajv, exports) +
    `\nconst checks={${Object.values(lookup).join(",")}};const keys=${JSON.stringify(lookup)};\nexport function validate(schema,data){const check=checks[keys[JSON.stringify(schema)]];if(!check)throw new Error('No compiled validator for this schema');if(!check(data))throw new Error('Invalid data: '+JSON.stringify(check.errors));}\n`;
  const destination = resolve(root, outDir);
  const uri = `ui://${encodeURIComponent(contract.identity.name)}/app.html`;
  await mkdir(destination, { recursive: true });
  for (const target of ["web", "mcp"]) {
    const result = await bundle({
      entryPoints: [
        fileURLToPath(new URL("./src/browser.tsx", import.meta.url)),
      ],
      absWorkingDir: root,
      bundle: true,
      write: false,
      outdir: destination,
      format: "esm",
      platform: "browser",
      target: "es2022",
      minify: true,
      jsx: "automatic",
      metafile: true,
      alias: {
        "app-view": resolve(root, entry),
        "holon-ui/app": resolve(dirname(generated), "app.js"),
      },
      loader: {
        ".woff2": "dataurl",
        ".woff": "dataurl",
        ".png": "dataurl",
        ".svg": "dataurl",
      },
      define: {
        TARGET: JSON.stringify(target),
        APP_NAME: JSON.stringify(contract.identity.name),
        ENDPOINT: JSON.stringify(endpoint),
        "process.env.NODE_ENV": '"production"',
      },
      plugins: [
        {
          name: "compiled-validators",
          setup(build) {
            build.onResolve({ filter: /^app-validators$/ }, () => ({
              path: "validators",
              namespace: "compiled",
            }));
            build.onLoad({ filter: /.*/, namespace: "compiled" }, () => ({
              contents: validators,
              loader: "js",
              resolveDir: dirname(generated),
            }));
            build.onResolve({ filter: /^holon-sh\/app$|^node:/ }, (args) => ({
              errors: [
                {
                  text: `Server import ${args.path} is not allowed in a browser view`,
                },
              ],
            }));
          },
        },
      ],
    });
    const js = result.outputFiles.find((file) =>
      file.path.endsWith(".js"),
    ).text;
    const css =
      result.outputFiles.find((file) => file.path.endsWith(".css"))?.text ?? "";
    const escape = (text) =>
      text
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll('"', "&quot;");
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title ?? contract.identity.name)}</title><style>${css.replace(/<\/style/gi, "<\\/style")}</style></head><body><div id="root"></div><script type="module">${js.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
    await mkdir(resolve(destination, target), { recursive: true });
    await writeFile(resolve(destination, target, "index.html"), html);
  }
  const host = await bundle({
    entryPoints: [fileURLToPath(new URL("./src/host.ts", import.meta.url))],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2022",
    minify: true,
    define: {
      APP_NAME: JSON.stringify(contract.identity.name),
      ENDPOINT: JSON.stringify(endpoint),
      TOOL_NAME: JSON.stringify(tool.name),
      VIEW_URI: JSON.stringify(uri),
    },
  });
  await writeFile(
    resolve(destination, "web/host.html"),
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MCP App preview</title><style>body{margin:0}iframe{width:100%;min-height:400px;border:0}</style><p role="alert"></p><iframe title="MCP App" sandbox="allow-scripts"></iframe><script type="module">${host.outputFiles[0].text.replace(/<\/script/gi, "<\\/script")}</script></html>`,
  );
  await writeFile(
    resolve(destination, "views.json"),
    JSON.stringify(
      [{ tool: tool.name, uri, file: "mcp/index.html", ui }],
      null,
      2,
    ) + "\n",
  );
  return {
    web: relative(root, resolve(destination, "web")),
    manifest: relative(root, resolve(destination, "views.json")),
  };
}
