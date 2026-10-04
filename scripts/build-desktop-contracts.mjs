import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

await build({
  absWorkingDir: fileURLToPath(new URL('..', import.meta.url)),
  entryPoints: ['apps/desktop/contracts.ts'],
  outfile: 'apps/desktop/internal/contracts/dist/contracts.js',
  bundle: true,
  platform: 'neutral',
  format: 'iife',
  globalName: 'OpsisContracts',
  target: 'es2015',
});
