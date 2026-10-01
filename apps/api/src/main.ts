import { buildApp } from './app.js';
import { configuredLLMClientFromEnvironment } from './llm.js';
import { kokoroEngine } from './speech.js';

const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? 8000);

const llm = await configuredLLMClientFromEnvironment(process.env, {
  onWarning: (message) => process.stderr.write(`${message}\n`),
});
const speech = process.env.OPSIS_SPEECH === 'off' ? null : kokoroEngine();
const app = buildApp({ logger: true, llm, speech });

try {
  await app.listen({ host, port });
  // Start the download/load in the background; the API remains available while it prepares.
  speech?.warm();
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
