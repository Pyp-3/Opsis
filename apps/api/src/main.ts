import { listenHost } from './listen-host.js';
import { buildApp } from './app.js';
import { serverModeFromEnv } from './server-mode.js';
import { kokoroEngine } from './speech.js';

const serverMode = serverModeFromEnv();
const host = listenHost(process.env.HOST, !!serverMode);
const port = Number(process.env.PORT ?? 8000);

const speech = process.env.OPSIS_SPEECH === 'off' ? null : kokoroEngine();
const app = buildApp({ logger: true, speech, serverMode });

try {
  await app.listen({ host, port });
  if (serverMode) app.log.info(`Serving Opsis for ${serverMode.publicOrigin}`);
  // Start the download/load in the background; the API remains available while it prepares.
  speech?.warm();
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
