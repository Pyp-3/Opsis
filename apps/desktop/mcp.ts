import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { INSTRUCTIONS, registerTools } from '../mcp/src/tools';
import { opsisClient } from '../mcp/src/client';

declare function nativeURL(relative: string, base: string): string;
declare function nativeFetch(url: string, init: string): string;

(globalThis as unknown as { URL: unknown }).URL = class {
  private value: string;
  constructor(relative: string, base: string) {
    this.value = nativeURL(relative, base);
  }
  toString() {
    return this.value;
  }
};

type Definition = {
  title?: string;
  description?: string;
  inputSchema: z.ZodRawShape;
  annotations?: Record<string, unknown>;
};
type Tool = { definition: Definition; handler: (args: unknown) => Promise<unknown> };
const tools = new Map<string, Tool>();

export function initialize(base: string, key: string, web: string) {
  const fetcher = (async (url: URL | RequestInfo, init?: RequestInit) => {
    const response = JSON.parse(nativeFetch(String(url), JSON.stringify(init ?? {}))) as {
      status: number;
      body: string;
      error?: string;
    };
    if (response.error) throw new Error('Local API unavailable.');
    return {
      status: response.status,
      ok: response.status >= 200 && response.status < 300,
      json: async () => JSON.parse(response.body),
    };
  }) as typeof fetch;
  const registrar = {
    registerTool(name: string, definition: Definition, handler: Tool['handler']) {
      tools.set(name, { definition, handler });
    },
  } as unknown as Parameters<typeof registerTools>[0];
  registerTools(registrar, opsisClient(base, key || undefined, fetcher), web);
  return JSON.stringify({
    instructions: INSTRUCTIONS,
    tools: [...tools].map(([name, { definition }]) => ({
      ...definition,
      name,
      inputSchema: zodToJsonSchema(z.object(definition.inputSchema)),
    })),
  });
}

export async function call(name: string, argumentsJSON: string): Promise<string> {
  const tool = tools.get(name);
  if (!tool) throw new Error('Unknown tool.');
  const parsed = z.object(tool.definition.inputSchema).safeParse(JSON.parse(argumentsJSON));
  if (!parsed.success)
    return JSON.stringify({
      isError: true,
      content: [{ type: 'text', text: `Input validation error: ${parsed.error.message}` }],
    });
  return JSON.stringify(await tool.handler(parsed.data));
}
