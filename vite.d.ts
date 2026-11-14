import type { Plugin } from "vite";

/** Builds the page in ui/index.html twice in one vite build: the web page into dist/web, and into dist/mcp the MCP Apps view, one self-contained HTML file whose holon-ui calls its app through the host. */
export declare function holon(): Plugin;
