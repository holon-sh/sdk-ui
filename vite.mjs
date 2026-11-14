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
          const [tag, inline] = file.type === "chunk"
            ? [`<script type="module" crossorigin src="./${name}"></script>`, () => `<script type="module">${file.code.replaceAll("<!--", "\\x3C!--")}</script>`]
            : [`<link rel="stylesheet" crossorigin href="./${name}">`, () => `<style>${file.source.replaceAll("</", "<\\/")}</style>`];
          if (!page.source.includes(tag)) this.error(`A host loads the view as one HTML file, so it cannot load ${name}; import a worker with ?worker&inline`);
          page.source = page.source.replace(tag, inline);
          delete bundle[name];
        }
      },
    },
  };
}
