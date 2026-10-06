import { z } from 'zod';

export const BOARD_PROVIDERS = ['claude', 'codex', 'kimi', 'grok', 'antigravity'] as const;
export const ProviderAgentSchema = z.enum(BOARD_PROVIDERS);
export type ProviderAgent = z.infer<typeof ProviderAgentSchema>;
export const PROVIDER_LABELS: Record<ProviderAgent, string> = {
  claude: 'Claude',
  codex: 'Codex',
  kimi: 'Kimi',
  grok: 'Grok',
  antigravity: 'Antigravity',
};
export const BoardAgentSchema = z.enum([...BOARD_PROVIDERS, 'demo']);
/** Instance secret. Never put this in account preferences or saved board data. */
export const ProviderApiKeySchema = z
  .string()
  .min(1)
  .max(4096)
  .regex(/^[\x21-\x7e]+$/);
export type BoardAgent = z.infer<typeof BoardAgentSchema>;
export const BoardModelSettingsSchema = z
  .object({
    connection: z.enum(['cli', 'api']).optional(),
    maxOutputTokens: z.number().int().min(256).max(64000).optional(),
    model: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/),
    effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']),
    executablePath: z
      .string()
      .trim()
      .max(1024)
      .refine(
        (value) => !value || /^(?:\/|[A-Za-z]:[\\/])/.test(value),
        'Use an absolute executable path.',
      )
      .optional(),
    maxRequestCharacters: z.number().int().min(1000).max(768000).optional(),
    maxBudgetUSD: z.number().finite().min(0.01).max(100).optional(),
  })
  .strict();
export type BoardModelSettings = z.infer<typeof BoardModelSettingsSchema>;
export const DEFAULT_BOARD_MODELS: Record<ProviderAgent, BoardModelSettings> = {
  claude: { model: 'haiku', effort: 'low' },
  codex: { model: 'gpt-6-luna', effort: 'low' },
  kimi: { model: 'kimi-k3', effort: 'low', connection: 'api' },
  grok: { model: 'grok-4.7', effort: 'low', connection: 'api' },
  antigravity: { model: 'gemini-3.8-flash', effort: 'low', connection: 'api' },
};
/**
 * Model picker choices, newest first. Checked against the catalogues shipped with
 * Claude Code 2.1.288 and Codex CLI 0.159 (October 2026). `efforts` lists the reasoning
 * levels a model accepts when it is narrower than the full range.
 */
export const BOARD_MODEL_CHOICES: Record<
  ProviderAgent,
  readonly {
    id: string;
    label: string;
    group: string;
    efforts?: readonly BoardModelSettings['effort'][];
  }[]
> = {
  kimi: [{ id: 'kimi-k3', label: 'Kimi K3', group: 'Kimi', efforts: ['low', 'high', 'max'] }],
  grok: [{ id: 'grok-4.7', label: 'Grok 4.7', group: 'Grok', efforts: ['low'] }],
  antigravity: [
    {
      id: 'gemini-3.8-flash-medium',
      label: 'Gemini 3.8 Flash Medium · CLI',
      group: 'Antigravity CLI',
      efforts: ['low'],
    },
    { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', group: 'Antigravity', efforts: ['low'] },
  ],
  claude: [
    { id: 'claude-fable-5-1', label: 'Fable 5.1', group: 'Latest' },
    { id: 'claude-opus-5-5', label: 'Opus 5.5', group: 'Latest' },
    { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', group: 'Latest' },
    { id: 'claude-haiku-4-5', label: 'Haiku 4.5', group: 'Latest' },
    { id: 'claude-fable-5', label: 'Fable 5', group: 'Earlier versions' },
    { id: 'claude-opus-5', label: 'Opus 5', group: 'Earlier versions' },
    { id: 'claude-sonnet-5', label: 'Sonnet 5', group: 'Earlier versions' },
    { id: 'claude-opus-4-8', label: 'Opus 4.8', group: 'Earlier versions' },
    { id: 'claude-opus-4-7', label: 'Opus 4.7', group: 'Earlier versions' },
    { id: 'claude-opus-4-6', label: 'Opus 4.6', group: 'Earlier versions' },
    { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', group: 'Earlier versions' },
    { id: 'haiku', label: 'Haiku · CLI alias', group: 'CLI aliases' },
    { id: 'sonnet', label: 'Sonnet · CLI alias', group: 'CLI aliases' },
    { id: 'opus', label: 'Opus · CLI alias', group: 'CLI aliases' },
    { id: 'fable', label: 'Fable · CLI alias', group: 'CLI aliases' },
  ],
  codex: [
    { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol', group: 'GPT-6' },
    { id: 'gpt-6-astra', label: 'GPT-6 Astra', group: 'GPT-6' },
    { id: 'gpt-6-sol', label: 'GPT-6 Sol', group: 'GPT-6' },
    { id: 'gpt-6-luna', label: 'GPT-6 Luna', group: 'GPT-6' },
    { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', group: 'GPT-5' },
    { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', group: 'GPT-5' },
    { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', group: 'GPT-5' },
    {
      id: 'gpt-5.5',
      label: 'GPT-5.5',
      group: 'GPT-5',
      efforts: ['low', 'medium', 'high', 'xhigh'],
    },
    { id: 'gpt-daybreak-blue-latest', label: 'Daybreak Blue · rolling', group: 'Previews' },
  ],
};

/** Known incompatible effort choices fail before any provider request. Custom IDs remain explicit. */
export function modelSettingsProblem(
  agent: ProviderAgent,
  settings: BoardModelSettings,
): string | null {
  if (settings.model === 'default') return 'Choose an explicit model.';
  if (settings.connection === 'api' && (agent === 'claude' || agent === 'codex'))
    return 'This agent currently uses its CLI connection.';
  if (
    settings.maxOutputTokens !== undefined &&
    (settings.connection !== 'api' || agent === 'antigravity')
  )
    return 'This connection does not support an output-token cap.';
  if (['grok', 'antigravity'].includes(agent) && settings.effort !== 'low')
    return 'This connection uses the model’s built-in reasoning configuration.';
  if (agent === 'kimi' && settings.connection !== 'api' && settings.effort !== 'low')
    return 'Kimi CLI uses its built-in reasoning configuration.';
  if (
    agent === 'kimi' &&
    settings.connection === 'api' &&
    !['low', 'high', 'max'].includes(settings.effort)
  )
    return 'Kimi API supports low, high or max reasoning effort.';
  const allowed = BOARD_MODEL_CHOICES[agent].find(
    (choice) => choice.id === settings.model,
  )?.efforts;
  if (allowed && !allowed.includes(settings.effort))
    return 'This model does not support the selected effort.';
  if (agent !== 'claude' && settings.maxBudgetUSD !== undefined)
    return 'This CLI does not support a dollar budget. Remove the budget before continuing.';
  return null;
}
