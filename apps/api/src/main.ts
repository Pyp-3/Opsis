import { buildApp } from './app.js';
import { kokoroEngine } from './speech.js';

const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? 8000);

const speech = process.env.OPSIS_SPEECH === 'off' ? null : kokoroEngine();
const app = buildApp({ logger: true, speech });

try {
  await app.listen({ host, port });
  // Start the download/load in the background; the API remains available while it prepares.
  speech?.warm();
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
