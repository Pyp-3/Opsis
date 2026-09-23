import { buildApp } from './app.js';

const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? 8000);

const app = buildApp({ logger: true });

try {
  await app.listen({ host, port });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
