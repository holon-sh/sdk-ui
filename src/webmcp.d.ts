interface ModelContextTool {
  name: string;
  title?: string;
  description: string;
  inputSchema?: object;
  outputSchema?: object;
  annotations: { readOnlyHint: boolean; consequentialHint: boolean; untrustedContentHint: boolean };
  execute(input: Record<string, unknown>, client: { signal: AbortSignal }): Promise<unknown>;
}

interface Document {
  readonly modelContext?: {
    registerTool(tool: ModelContextTool, options?: { signal?: AbortSignal }): Promise<void>;
  };
}
