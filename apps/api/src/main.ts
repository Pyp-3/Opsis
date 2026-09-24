import { buildApp } from './app.js';
import { configuredLLMClientFromEnvironment } from './llm.js';

const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? 8000);

const llm = await configuredLLMClientFromEnvironment(process.env, {
  onWarning: (message) => process.stderr.write(`${message}\n`),
});
const app = buildApp({ logger: true, llm });

try {
  await app.listen({ host, port });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
