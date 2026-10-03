#!/usr/bin/env -S node --import tsx
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { opsisClient } from './client.js';
import { createServer } from './server.js';

// The API the web app saves through, and the web app itself for the "open" links.
const api = process.env.OPSIS_API_URL ?? 'http://127.0.0.1:8000';
const web = process.env.OPSIS_WEB_URL ?? 'http://127.0.0.1:3000';

await createServer(opsisClient(api), web).connect(new StdioServerTransport());
