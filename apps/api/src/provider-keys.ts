import { mkdirSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ProviderApiKeySchema, type ProviderAgent } from '@opsis/schema';

const providers = ['kimi', 'grok', 'antigravity'] as const;
const KeysSchema = z.record(z.enum(providers), ProviderApiKeySchema);
/** Instance secrets live outside SQLite, backups, account settings and exports. */
export class ProviderKeys {
  private keys: Partial<Record<ProviderAgent, string>> = {};
  private readonly path: string | undefined;
  constructor(
    database: string,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {
    this.path = database === ':memory:' ? undefined : `${database}.provider-keys.json`;
    if (this.path) {
      try {
        this.keys = KeysSchema.parse(JSON.parse(readFileSync(this.path, 'utf8')));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
          throw new Error('Could not read instance provider keys.');
      }
    }
  }
  get(provider: ProviderAgent) {
    return this.env[`OPSIS_${provider.toUpperCase()}_API_KEY`] || this.keys[provider];
  }
  status() {
    return providers.map((id) => ({
      id,
      configured: !!this.get(id),
      source: this.env[`OPSIS_${id.toUpperCase()}_API_KEY`]
        ? 'environment'
        : this.keys[id]
          ? 'instance'
          : 'none',
    }));
  }
  set(provider: ProviderAgent, key?: string) {
    const next = { ...this.keys };
    if (key === undefined) delete next[provider];
    else next[provider] = ProviderApiKeySchema.parse(key);
    if (this.path) {
      mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
      const temporary = `${this.path}.${randomUUID()}.tmp`;
      try {
        writeFileSync(temporary, JSON.stringify(next), { mode: 0o600, flag: 'wx' });
        renameSync(temporary, this.path);
      } catch {
        throw new Error('Could not save instance provider keys.');
      } finally {
        rmSync(temporary, { force: true });
      }
    }
    this.keys = next;
  }
}

export function registerProviderKeys(app: FastifyInstance, keys: ProviderKeys) {
  app.addHook('onRequest', async (request, reply) => {
    if (request.url.startsWith('/v1/instance/provider-keys') && (!request.user || request.viaAgent))
      return reply
        .code(401)
        .send({ message: 'Sign in locally to manage this instance’s API keys.' });
  });
  app.get('/v1/instance/provider-keys', async () => keys.status());
  app.put('/v1/instance/provider-keys/:provider', { bodyLimit: 8192 }, async (request, reply) => {
    const provider = z.enum(providers).safeParse((request.params as { provider: string }).provider);
    const body = z.object({ key: ProviderApiKeySchema }).strict().safeParse(request.body);
    if (!provider.success || !body.success)
      return reply.code(400).send({ message: 'Choose a provider and enter a valid API key.' });
    keys.set(provider.data, body.data.key);
    return reply.code(204).send();
  });
  app.delete('/v1/instance/provider-keys/:provider', async (request, reply) => {
    const provider = z.enum(providers).safeParse((request.params as { provider: string }).provider);
    if (!provider.success) return reply.code(400).send({ message: 'Unknown provider.' });
    keys.set(provider.data);
    return reply.code(204).send();
  });
}
