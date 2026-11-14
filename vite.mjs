import { defaultClientConditions } from "vite";

export function holon() {
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
          resolve: { conditions: ["mcp-app", ...defaultClientConditions] },
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
    generateBundle: {
      order: "post",
      handler(_, bundle) {
        const { "index.html": page, ...files } = bundle;
        for (const [name, file] of Object.entries(files)) {
          const url = page.source.indexOf(`"./${name}"`);
          if (url < 0) this.error(`holon-ui/vite cannot inline ${name} into the view, which a host loads as one HTML file; import a worker with ?worker&inline`);
          const startTag = page.source.slice(page.source.lastIndexOf("<", url), page.source.indexOf(">", url) + 1);
          page.source = page.source.replace(startTag, () => file.type === "chunk"
            ? `<script type="module">${file.code.replaceAll("<!--", "\\x3C!--")}`
            : `<style>${file.source.replaceAll("</", "<\\/")}</style>`);
          delete bundle[name];
        }
      },
    },
  };
}
