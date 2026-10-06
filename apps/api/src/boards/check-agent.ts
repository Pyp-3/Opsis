import { z } from 'zod';
import { BoardModelSettingsSchema, ProviderAgentSchema, modelSettingsProblem } from '@opsis/schema';
import type { BoardClientFactory } from './client';
import { HarnessError } from '../harness/errors';
import { outcome } from './transport';

export async function checkAgent(body: unknown, factory: BoardClientFactory) {
  const parsed = z
    .object({ agent: ProviderAgentSchema, settings: BoardModelSettingsSchema })
    .strict()
    .safeParse(body);
  if (!parsed.success) return outcome(400, { message: 'Invalid agent settings.' });
  const { agent, settings } = parsed.data;
  const problem = modelSettingsProblem(agent, settings);
  if (problem) return outcome(400, { message: problem });
  try {
    await factory(agent, settings);
    return outcome(200, {
      message:
        settings.connection === 'api'
          ? 'Instance API key and model settings are configured. This no-call check does not verify credentials, access or quota.'
          : 'CLI executable and version are ready. Account login, model access and remaining quota are not verified by this no-call check.',
    });
  } catch (error) {
    return outcome(400, {
      message:
        settings.connection === 'api'
          ? 'Configure this provider’s API key in Settings → API keys. This check makes no paid request.'
          : error instanceof HarnessError && error.code === 'harness_missing'
            ? 'Executable not found. Choose an installed CLI or leave the path blank for automatic discovery.'
            : 'CLI check failed. Check the absolute path, executable permissions and supported CLI version. Run the CLI login command in your terminal; this check never signs you in.',
    });
  }
}
