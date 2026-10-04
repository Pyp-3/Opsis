import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

await build({
  absWorkingDir: fileURLToPath(new URL('..', import.meta.url)),
  entryPoints: ['apps/desktop/workflows.ts'],
  outfile: 'apps/desktop/internal/generation/dist/workflows.js',
  bundle: true,
  platform: 'neutral',
  format: 'iife',
  globalName: 'OpsisWorkflows',
  target: 'es2017',
  plugins: [
    {
      name: 'native-attachment-io',
      setup(plugin) {
        plugin.onResolve({ filter: /^node:path$/ }, () => ({
          path: 'path',
          namespace: 'native-attachment',
        }));
        plugin.onResolve({ filter: /harness\/pdf\.js$/ }, () => ({
          path: 'pdf',
          namespace: 'native-attachment',
        }));
        plugin.onLoad({ filter: /.*/, namespace: 'native-attachment' }, ({ path }) => ({
          contents:
            path === 'path'
              ? 'export const extname = (name) => nativeExtname(name);'
              : 'export const pdfText = (data) => nativePdfText(data.toJSON());',
          loader: 'js',
        }));
      },
    },
  ],
});
