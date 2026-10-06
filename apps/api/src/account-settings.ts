import type { FastifyInstance } from 'fastify';
import {
  AccountSettingRequestSchema,
  AccountSettingSchema,
  MAX_USAGE_RECORDS,
  UsageRecordSchema,
} from '@opsis/schema';
import type { ApiStore } from './storage.js';
import { requireUser } from './auth.js';

/** Preferences and usage history that belong to the signed-in account, not a browser. */
export function registerAccountSettings(app: FastifyInstance, store: ApiStore) {
  app.get('/v1/account/settings', async (request, reply) => {
    const user = requireUser(request, reply);
    return user ? { values: store.listAccountSettings(user.id) } : reply;
  });
  app.put('/v1/account/settings/:key', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;
    const body = AccountSettingRequestSchema.safeParse(request.body);
    const setting = AccountSettingSchema.safeParse({
      key: (request.params as { key: string }).key,
      value: body.success ? body.data.value : undefined,
    });
    if (!body.success || !setting.success)
      return reply.code(400).send({ message: 'Invalid setting.' });
    store.saveAccountSetting(user.id, setting.data.key, setting.data.value);
    return reply.code(204).send();
  });
  app.get('/v1/account/usage', async (request, reply) => {
    const user = requireUser(request, reply);
    return user ? store.listUsageRecords(user.id) : reply;
  });
  app.post('/v1/account/usage', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;
    const record = UsageRecordSchema.safeParse(request.body);
    if (!record.success) return reply.code(400).send({ message: 'Invalid usage record.' });
    store.addUsageRecord(user.id, record.data, MAX_USAGE_RECORDS);
    return reply.code(204).send();
  });
  app.delete('/v1/account/usage', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;
    store.clearUsageRecords(user.id);
    return reply.code(204).send();
  });
}
