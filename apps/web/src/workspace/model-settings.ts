import {
  BoardModelSettingsSchema,
  DEFAULT_BOARD_MODELS,
  type BoardModelSettings,
} from '@opsis/schema';
import { accountSetting, saveAccountSetting } from './account-settings';

export type ModelPreferences = Record<'claude' | 'codex', BoardModelSettings>;
/** The account's default model per agent, falling back to the economical defaults. */
export function readModelPreferences(): ModelPreferences {
  const value = accountSetting('model-preferences') ?? {};
  return {
    claude: value.claude ?? DEFAULT_BOARD_MODELS.claude,
    codex: value.codex ?? DEFAULT_BOARD_MODELS.codex,
  };
}
/** Saves only valid choices; rejects if the account save fails. */
export function saveModelPreferences(value: ModelPreferences) {
  return saveAccountSetting('model-preferences', {
    ...(BoardModelSettingsSchema.safeParse(value.claude).success ? { claude: value.claude } : {}),
    ...(BoardModelSettingsSchema.safeParse(value.codex).success ? { codex: value.codex } : {}),
  });
}
