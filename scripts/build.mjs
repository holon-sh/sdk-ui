import { readFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const program = ts.createProgram(
  [
    join(root, "src/app.ts"),
    join(root, "src/react.tsx"),
    join(root, "src/state.ts"),
  ],
  {
    strict: true,
    target: ts.ScriptTarget.ES2023,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    jsx: ts.JsxEmit.ReactJSX,
    skipLibCheck: true,
    declaration: true,
    rootDir: join(root, "src"),
    outDir: root,
  },
);
const diagnostics = ts.getPreEmitDiagnostics(program);
if (diagnostics.length)
  throw new Error(
    ts.formatDiagnostics(diagnostics, {
      getCanonicalFileName: (p) => p,
      getCurrentDirectory: () => root,
      getNewLine: () => "\n",
    }),
  );
if (program.emit().emitSkipped)
  throw new Error("React runtime emission failed");

// npm tarballs always start with an empty slot; generation belongs to the consumer.
const generated = join(root, "generated");
rmSync(generated, { recursive: true, force: true });
mkdirSync(generated);
const banner = "// holon-generated-apps-v1 placeholder\n";
const emptyTypes =
  "export type Apps = Record<never, never>;\nexport type Inputs = Record<never, never>;\nexport type Outputs = Record<never, never>;\nexport type InputTypes = Inputs;\nexport type OutputTypes = Outputs;\nexport type Resources = Record<never, never>;\n";
writeFileSync(
  join(generated, "index.js"),
  banner +
    'import {bindApps} from "../runtime.mjs";\nexport {ToolCallError,exposeTools,registerPageTools} from "../runtime.mjs";\nexport function createApps(bindings, options) { return bindApps({name:"unconfigured",version:"0",requires:{}}, {}, bindings, options); }\n',
);
writeFileSync(
  join(generated, "index.d.ts"),
  banner +
    emptyTypes +
    'export { ToolCallError } from "holon-sh/protocol";\nexport type { EndpointBinding, CreateOptions } from "../runtime.js";\nexport { exposeTools, registerPageTools } from "../runtime.js";\nimport type { CreateOptions } from "../runtime.js";\nexport declare function createApps(bindings: Record<string, never>, options?: CreateOptions): Apps;\n',
);
writeFileSync(
  join(generated, "holon-generated.json"),
  JSON.stringify(
    { marker: "holon-generated-apps-v1", placeholder: true },
    null,
    2,
  ) + "\n",
);

writeFileSync(
  join(generated, "refs.js"),
  "export const tools = {}, resources = {};\n",
);
writeFileSync(
  join(generated, "refs.d.ts"),
  "export declare const tools: Record<never, never>, resources: Record<never, never>;\n",
);
for (const name of ["app.js", "app.d.ts"])
  writeFileSync(
    join(root, name),
    readFileSync(join(root, name), "utf8") +
      '\nexport { tools, resources } from "./generated/refs.js";\n',
  );

const browser = ts.createProgram(
  [
    join(root, "src/browser.tsx"),
    join(root, "src/host.ts"),
    join(root, "src/browser-env.d.ts"),
  ],
  {
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2023,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    jsx: ts.JsxEmit.ReactJSX,
    skipLibCheck: true,
  },
);
const browserErrors = ts.getPreEmitDiagnostics(browser);
if (browserErrors.length)
  throw new Error(
    ts.formatDiagnostics(browserErrors, {
      getCanonicalFileName: (p) => p,
      getCurrentDirectory: () => root,
      getNewLine: () => "\n",
    }),
  );
