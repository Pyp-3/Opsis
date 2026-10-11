import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// Attachment I/O stays in Go; the bundled workflow only receives explicit callbacks.
const nativeAttachmentIO = {
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
};

// Separate VM globals retain the existing TypeScript owners of shared domain rules.
const bundles = [
  {
    entryPoints: ['apps/desktop/contracts.ts'],
    outfile: 'apps/desktop/internal/contracts/dist/contracts.js',
    globalName: 'OpsisContracts',
    target: 'es2015',
  },
  {
    entryPoints: ['apps/desktop/workflows.ts'],
    outfile: 'apps/desktop/internal/generation/dist/workflows.js',
    globalName: 'OpsisWorkflows',
    target: 'es2017',
    plugins: [nativeAttachmentIO],
  },
  {
    entryPoints: ['apps/desktop/mcp.ts'],
    outfile: 'apps/desktop/internal/mcpbridge/dist/tools.js',
    globalName: 'OpsisTools',
    target: 'es2017',
  },
];

await Promise.all(
  bundles.map((bundle) =>
    build({
      absWorkingDir: fileURLToPath(new URL('..', import.meta.url)),
      bundle: true,
      platform: 'neutral',
      format: 'iife',
      ...bundle,
    }),
  ),
);
