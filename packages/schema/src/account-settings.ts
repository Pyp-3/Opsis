import { z } from 'zod';
import { BoardModelSettingsSchema } from './model-settings';
import { ReportedUsageSchema } from './provider-usage';

/**
 * Preferences that follow an account across browsers and devices. Each key has its own
 * bounded value schema; hosts store the validated JSON and never interpret it further.
 */
const ProviderAgentSchema = z.enum(['claude', 'codex']);
const capSchema = z.number().int().min(0).max(100_000);

export const ModelProfileSchema = z
  .object({
    id: z.string().max(100),
    name: z.string().trim().min(1).max(60),
    agent: ProviderAgentSchema,
    settings: BoardModelSettingsSchema,
  })
  .strict();
export type ModelProfile = z.infer<typeof ModelProfileSchema>;
export const MAX_MODEL_PROFILES = 30;

export const ACCOUNT_SETTING_SCHEMAS = {
  /** The default model and effort per agent. */
  'model-preferences': z
    .object({
      claude: BoardModelSettingsSchema.optional(),
      codex: BoardModelSettingsSchema.optional(),
    })
    .strict(),
  'model-profiles': z.array(ModelProfileSchema).max(MAX_MODEL_PROFILES),
  /** Self-imposed generation caps; 0 means no limit. */
  'provider-limits': z
    .object({
      enabled: z.boolean(),
      caps: z
        .object({
          claude: z.object({ fiveHour: capSchema, weekly: capSchema }).strict(),
          codex: z.object({ fiveHour: capSchema, weekly: capSchema }).strict(),
        })
        .strict(),
    })
    .strict(),
  /** When each counted generation started, for the rolling caps above. */
  'provider-events': z
    .object({
      claude: z.array(z.number().finite()).max(1000),
      codex: z.array(z.number().finite()).max(1000),
    })
    .strict(),
} as const;
export type AccountSettingKey = keyof typeof ACCOUNT_SETTING_SCHEMAS;
export const ACCOUNT_SETTING_KEYS = Object.keys(ACCOUNT_SETTING_SCHEMAS) as AccountSettingKey[];
export const AccountSettingKeySchema = z.enum(
  ACCOUNT_SETTING_KEYS as [AccountSettingKey, ...AccountSettingKey[]],
);

/** Validates one `{ key, value }` pair against that key's schema. */
export const AccountSettingSchema = z
  .object({ key: AccountSettingKeySchema, value: z.unknown() })
  .strict()
  .transform((setting, context) => {
    const parsed = ACCOUNT_SETTING_SCHEMAS[setting.key].safeParse(setting.value);
    if (!parsed.success) {
      context.addIssue({ code: 'custom', message: 'Invalid value for this setting.' });
      return z.NEVER;
    }
    return { key: setting.key, value: parsed.data };
  });
export const AccountSettingRequestSchema = z.object({ value: z.unknown() }).strict();

/** One generation's provider-reported usage; measurements stay nullable, never zero-filled. */
export const UsageRecordSchema = z
  .object({
    id: z.string().uuid(),
    at: z.number().int().nonnegative(),
    agent: ProviderAgentSchema,
    model: z.string().min(1).max(80),
    effort: z.string().min(1).max(20),
    purpose: z.enum(['diagram', 'illustration']),
    /** The board the generation was for, when it had been saved. */
    boardId: z.string().uuid().optional(),
    attempts: z.array(ReportedUsageSchema).max(10),
  })
  .strict();
export type UsageRecord = z.infer<typeof UsageRecordSchema>;
/** Each account keeps its most recent records; older ones are discarded. */
export const MAX_USAGE_RECORDS = 1000;
