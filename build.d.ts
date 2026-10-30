/** Build both surfaces from one presentation declaration. Run in the consumer project. */
export declare function build(options: {
  entry: string;
  outDir?: string;
  endpoint?: string;
  title?: string;
  /** Native MCP Apps resource metadata, including CSP and permissions. */
  ui?: Record<string, unknown>;
}): Promise<{ web: string; manifest: string }>;
