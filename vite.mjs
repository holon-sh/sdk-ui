// holon-ui/vite: one vite build makes both surfaces of a page from ui/index.html. The web page is Vite's ordinary
// build. The view is built with the mcp-app condition, so holon-ui/runtime resolves to runtime.host.mjs there, and as
// one HTML document, since a host loads a view from a single text/html;profile=mcp-app resource.
// https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx#ui-resource-format
import { defaultClientConditions } from "vite";

export function holon() {
  return {
    name: "holon",
    config: () => ({
      root: "ui",
      // Relative URLs work wherever the page is served: at / and under /<app>/ alike.
      base: "./",
      // A plain vite build builds every environment, the view too.
      builder: {},
      build: { outDir: "../dist/web", emptyOutDir: true },
      environments: {
        mcp: {
          consumer: "client",
          resolve: { conditions: ["mcp-app", ...defaultClientConditions] },
          build: {
            outDir: "../dist/mcp",
            copyPublicDir: false,
            // One chunk, with every asset it imports inlined, so the document needs nothing else.
            assetsInlineLimit: () => true,
            rolldownOptions: { output: { codeSplitting: false } },
          },
        },
      },
    }),
    applyToEnvironment: ({ name }) => name === "mcp",
    generateBundle: {
      // After Vite has written the tags this replaces, each naming a file as ./<fileName>, and filled in every chunk's
      // preload list.
      order: "post",
      handler(_, bundle) {
        const take = path => {
          const file = bundle[path];
          delete bundle[path];
          return file;
        };
        const page = bundle["index.html"];
        page.source = page.source
          // Rolldown already writes "</script" as "<\/script"; a "<!--" would still keep the parser from ending the
          // element at its "</script>". https://html.spec.whatwg.org/multipage/scripting.html#restrictions-for-contents-of-script-elements
          .replace(/<script[^>]* src="\.\/([^"]+)"[^>]*><\/script>/g, (_, path) => `<script type="module">${take(path).code.replaceAll("<!--", "\\x3C!--")}</script>`)
          .replace(/<link[^>]* href="\.\/([^"]+\.css)"[^>]*>/g, (_, path) => `<style>${take(path).source}</style>`);
      },
    },
  };
}
