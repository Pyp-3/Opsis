import {
  BoardModelSettingsSchema,
  DEFAULT_BOARD_MODELS,
  type BoardModelSettings,
  type ProviderAgent,
  BOARD_PROVIDERS,
} from '@opsis/schema';
import { accountSetting, saveAccountSetting } from './account-settings';

export type ModelPreferences = Record<ProviderAgent, BoardModelSettings>;
/** The account's default model per agent, falling back to the economical defaults. */
export function readModelPreferences(): ModelPreferences {
  const value = accountSetting('model-preferences') ?? {};
  return {
    claude: value.claude ?? DEFAULT_BOARD_MODELS.claude,
    codex: value.codex ?? DEFAULT_BOARD_MODELS.codex,
    kimi: value.kimi ?? DEFAULT_BOARD_MODELS.kimi,
    grok: value.grok ?? DEFAULT_BOARD_MODELS.grok,
    antigravity: value.antigravity ?? DEFAULT_BOARD_MODELS.antigravity,
  };
}
/** Saves only valid choices; rejects if the account save fails. */
export function saveModelPreferences(value: ModelPreferences) {
  return saveAccountSetting(
    'model-preferences',
    Object.fromEntries(
      BOARD_PROVIDERS.filter(
        (agent) => BoardModelSettingsSchema.safeParse(value[agent]).success,
      ).map((agent) => [agent, value[agent]]),
    ),
  );
}
