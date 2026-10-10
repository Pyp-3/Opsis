import Fastify from 'fastify';
import { kokoroEngine, registerSpeech } from './speech.js';
import { registerRender } from './render.js';

// The desktop host owns this process and its writable directories. It chooses a free
// loopback port; no desktop session or agent credentials are written to stdout.
const speech = process.env.OPSIS_SPEECH === 'off' ? null : kokoroEngine();
// Accounts, boards, generation and MCP run in Go. This process is only the
// existing Kokoro/ONNX inference adapter and the preview rasteriser; it never opens the
// application database.
const app = Fastify({ logger: false });
registerSpeech(app, speech);
// The native host signs requests in before forwarding board previews here to rasterise.
registerRender(app, { requireUser: () => true });
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  const deadline = setTimeout(() => process.exit(1), 4_000);
  deadline.unref();
  await app.close();
  process.exit(0);
}
process.once('SIGTERM', () => void close());
process.once('SIGINT', () => void close());
// If the native host disappears, EOF prevents an orphaned API from surviving it.
process.stdin.resume();
process.stdin.once('end', () => void close());

try {
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  process.stdout.write(`OPSIS_READY=${address}\n`);
  speech?.warm();
} catch {
  process.stderr.write('Opsis could not start its local service.\n');
  process.exit(1);
}
