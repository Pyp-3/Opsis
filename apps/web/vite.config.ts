import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Cross-origin isolation lets the natural narrator's speech model use several CPU threads,
// which makes it several times faster. "credentialless" keeps cross-origin assets working.
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
};

export default defineConfig({
  plugins: [react()],
  worker: { format: 'es' },
  // Only the narrator's worker imports it; pre-bundling avoids a dev reload on first use.
  optimizeDeps: { include: ['kokoro-js'] },
  preview: { headers: isolation },
  server: {
    host: '127.0.0.1',
    port: 3000,
    strictPort: true,
    headers: isolation,
    proxy: {
      '/v1': process.env.OPSIS_API_URL ?? 'http://127.0.0.1:8000',
    },
  },
});
