import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

// npm tarballs always start with an empty slot; generation belongs to the consumer.
const generated = join(root, "generated");
rmSync(generated, { recursive: true, force: true });
mkdirSync(generated);
const banner = "// holon-generated-apps-v1 placeholder\n";
const emptyTypes = 'export type Apps = Record<never, never>;\nexport type Inputs = Record<never, never>;\nexport type Outputs = Record<never, never>;\nexport type InputTypes = Inputs;\nexport type OutputTypes = Outputs;\nexport type Resources = Record<never, never>;\n';
writeFileSync(join(generated, "index.js"), banner + 'import {bindApps} from "../runtime.mjs";\nexport {ToolCallError,exposeTools,registerPageTools} from "../runtime.mjs";\nexport function createApps(bindings, options) { return bindApps({name:"unconfigured",version:"0",requires:{}}, {}, bindings, options); }\n');
writeFileSync(join(generated, "index.d.ts"), banner + emptyTypes + 'export { ToolCallError } from "holon-sh/protocol";\nexport type { EndpointBinding, CreateOptions } from "../runtime.js";\nexport { exposeTools, registerPageTools } from "../runtime.js";\nimport type { CreateOptions } from "../runtime.js";\nexport declare function createApps(bindings: Record<string, never>, options?: CreateOptions): Apps;\n');
writeFileSync(join(generated, "holon-generated.json"), JSON.stringify({ marker: "holon-generated-apps-v1", placeholder: true }, null, 2) + "\n");
