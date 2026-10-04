import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { OpsisClient } from './client.js';
import { INSTRUCTIONS, registerTools } from './tools.js';

export function createServer(client: OpsisClient, webUrl: string) {
  const server = new McpServer({ name: 'opsis', version: '0.1.0' }, { instructions: INSTRUCTIONS });
  registerTools(server, client, webUrl);
  return server;
}
