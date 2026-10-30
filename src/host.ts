import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import {
  AppBridge,
  PostMessageTransport,
} from "@modelcontextprotocol/ext-apps/app-bridge";
declare const APP_NAME: string,
  ENDPOINT: string,
  TOOL_NAME: string,
  VIEW_URI: string;

// Local preview only. Production MCP hosts own their sandbox origin and policy.
const client = new Client(
  { name: `${APP_NAME}-preview`, version: "1" },
  { versionNegotiation: { mode: "auto" } },
);
const iframe = document.querySelector("iframe")!;
const bridge = new AppBridge(
  client,
  { name: "Holon app preview", version: "1" },
  { serverTools: {}, serverResources: {} },
  {
    hostContext: {
      theme: matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light",
    },
  },
);
bridge.onsizechange = ({ height }) => {
  if (height) iframe.style.height = `${height}px`;
};
const ready = new Promise<void>((resolve) => {
  bridge.oninitialized = () => resolve();
});
try {
  await client.connect(
    new StreamableHTTPClientTransport(new URL(ENDPOINT, location.href)),
  );
  const resource = await client.readResource({ uri: VIEW_URI });
  const content = resource.contents.find(
    (content) => content.uri === VIEW_URI && "text" in content,
  );
  if (!content || !("text" in content))
    throw new Error("The server has no built presentation");
  const connected = bridge.connect(
    new PostMessageTransport(iframe.contentWindow!, iframe.contentWindow!),
  );
  iframe.srcdoc = content.text;
  await connected;
  await ready;
  await bridge.sendToolInput({ arguments: {} });
  const tool = (await client.listTools()).tools.find(
    (tool) => tool.name === TOOL_NAME,
  );
  if (tool?.annotations?.readOnlyHint && !tool.inputSchema.required?.length)
    await bridge.sendToolResult(
      await client.callTool({ name: TOOL_NAME, arguments: {} }),
    );
} catch (error) {
  document.querySelector('[role="alert"]')!.textContent = String(error);
}
window.addEventListener(
  "pagehide",
  () => {
    void bridge.close();
    void client.close();
  },
  { once: true },
);
