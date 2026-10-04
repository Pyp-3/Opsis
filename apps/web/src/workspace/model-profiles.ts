import { z } from 'zod';
import { BoardModelSettingsSchema } from '@opsis/schema';
export const MODEL_PROFILES_KEY = 'opsis:model-profiles:v1';
const ProfileSchema = z
  .object({
    id: z.string().max(100),
    name: z.string().trim().min(1).max(60),
    agent: z.enum(['claude', 'codex']),
    settings: BoardModelSettingsSchema,
  })
  .strict();
export type ModelProfile = z.infer<typeof ProfileSchema>;
export function readModelProfiles(): ModelProfile[] {
  try {
    const parsed = z
      .array(ProfileSchema)
      .max(30)
      .safeParse(JSON.parse(localStorage.getItem(MODEL_PROFILES_KEY) ?? '[]'));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}
export function writeModelProfiles(profiles: ModelProfile[]) {
  localStorage.setItem(
    MODEL_PROFILES_KEY,
    JSON.stringify(z.array(ProfileSchema).max(30).parse(profiles)),
  );
}
