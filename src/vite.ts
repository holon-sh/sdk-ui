import type { Plugin } from "vite";

/** Builds the page in ui/index.html twice in one vite build: the web page into dist/web, and into dist/mcp the MCP Apps view, one self-contained HTML file whose holon-ui calls its app through the host. A view that would need a file beside it fails the build. */
export function holon(): Plugin {
  return {
    name: "holon",
    config: () => ({
      root: "ui",
      base: "./",
      builder: {},
      build: { outDir: "../dist/web", emptyOutDir: true },
      environments: {
        mcp: {
          consumer: "client",
          build: {
            outDir: "../dist/mcp",
            copyPublicDir: false,
            assetsInlineLimit: () => true,
            rolldownOptions: { output: { codeSplitting: false } },
          },
        },
      },
    }),
    applyToEnvironment: ({ name }) => name === "mcp",
    resolveId: { order: "pre", handler: id => (id === "holon-ui/runtime" ? `${import.meta.dirname}/runtime.host.js` : null) },
    generateBundle: {
      order: "post",
      handler(_, bundle) {
        const { "index.html": page, ...files } = bundle;
        if (page?.type !== "asset" || typeof page.source !== "string") return this.error("holon-ui/vite builds the view from ui/index.html");
        for (const [name, file] of Object.entries(files)) {
          const url = page.source.indexOf(`"./${name}"`);
          const inlined = file.type === "chunk"
            ? `<script type="module">${file.code.replaceAll("<!--", "\\x3C!--")}`
            : typeof file.source === "string" ? `<style>${file.source.replaceAll("</", "<\\/")}</style>` : undefined;
          if (url < 0 || inlined === undefined) this.error(`holon-ui/vite cannot inline ${name} into the view, which a host loads as one HTML file; import a worker with ?worker&inline`);
          const startTag = page.source.slice(page.source.lastIndexOf("<", url), page.source.indexOf(">", url) + 1);
          page.source = page.source.replace(startTag, () => inlined);
          delete bundle[name];
        }
      },
    },
  };
}
