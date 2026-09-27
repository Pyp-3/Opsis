import {
  BoardModelSettingsSchema,
  DEFAULT_BOARD_MODELS,
  type BoardModelSettings,
} from '@opsis/schema';

export const MODEL_SETTINGS_KEY = 'opsis:model-settings:v1';
export type ModelPreferences = Record<'claude' | 'codex', BoardModelSettings>;
export function readModelPreferences(): ModelPreferences {
  try {
    const value = JSON.parse(
      localStorage.getItem(MODEL_SETTINGS_KEY) ?? '{}',
    ) as Partial<ModelPreferences>;
    return {
      claude: BoardModelSettingsSchema.safeParse(value.claude).success
        ? BoardModelSettingsSchema.parse(value.claude)
        : DEFAULT_BOARD_MODELS.claude,
      codex: BoardModelSettingsSchema.safeParse(value.codex).success
        ? BoardModelSettingsSchema.parse(value.codex)
        : DEFAULT_BOARD_MODELS.codex,
    };
  } catch {
    return { ...DEFAULT_BOARD_MODELS };
  }
}
