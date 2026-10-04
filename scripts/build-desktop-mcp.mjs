import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

await build({
  absWorkingDir: fileURLToPath(new URL('..', import.meta.url)),
  entryPoints: ['apps/desktop/mcp.ts'],
  outfile: 'apps/desktop/internal/mcpbridge/dist/tools.js',
  bundle: true,
  platform: 'neutral',
  format: 'iife',
  globalName: 'OpsisTools',
  target: 'es2017',
});
