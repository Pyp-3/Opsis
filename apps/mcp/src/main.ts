#!/usr/bin/env -S node --import tsx
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { opsisClient } from './client.js';
import { createServer } from './server.js';

// The API the web app saves through, and the web app itself for the "open" links.
const api = process.env.OPSIS_API_URL ?? 'http://127.0.0.1:8000';
const web = process.env.OPSIS_WEB_URL ?? 'http://127.0.0.1:3000';

// Created by its owner under Account → Agent keys; it only works from this machine.
const key = process.env.OPSIS_AGENT_KEY;

await createServer(opsisClient(api, key), web).connect(new StdioServerTransport());
