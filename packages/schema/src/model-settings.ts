import { z } from 'zod';

export const BoardAgentSchema = z.enum(['claude', 'codex', 'demo']);
export type BoardAgent = z.infer<typeof BoardAgentSchema>;
export const BoardModelSettingsSchema = z
  .object({
    model: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/),
    effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']),
  })
  .strict();
export type BoardModelSettings = z.infer<typeof BoardModelSettingsSchema>;
export const DEFAULT_BOARD_MODELS: Record<'claude' | 'codex', BoardModelSettings> = {
  claude: { model: 'haiku', effort: 'low' },
  codex: { model: 'gpt-6-luna', effort: 'low' },
};
/**
 * Model picker choices, newest first. Checked against the catalogues shipped with
 * Claude Code 2.1.288 and Codex CLI 0.159 (October 2026). `efforts` lists the reasoning
 * levels a model accepts when it is narrower than the full range.
 */
export const BOARD_MODEL_CHOICES: Record<
  'claude' | 'codex',
  readonly {
    id: string;
    label: string;
    group: string;
    efforts?: readonly BoardModelSettings['effort'][];
  }[]
> = {
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
