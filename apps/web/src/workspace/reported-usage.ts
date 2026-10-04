import { z } from 'zod';
import { ReportedUsageSchema, type BoardModelSettings, type ReportedUsage } from '@opsis/schema';

const KEY = 'opsis:reported-usage:v1';
const EntrySchema = z.object({
  id: z.string(),
  at: z.number(),
  agent: z.enum(['claude', 'codex']),
  model: z.string(),
  effort: z.string(),
  purpose: z.enum(['diagram', 'illustration']),
  attempts: z.array(ReportedUsageSchema).max(10),
});
export type UsageEntry = z.infer<typeof EntrySchema>;
export function readReportedUsage(): UsageEntry[] {
  try {
    const parsed = z
      .array(EntrySchema)
      .max(100)
      .safeParse(JSON.parse(localStorage.getItem(KEY) ?? '[]'));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}
export function recordReportedUsage(
  agent: 'claude' | 'codex',
  settings: BoardModelSettings,
  attempts: ReportedUsage[],
  purpose: UsageEntry['purpose'],
) {
  const entry = {
    id: crypto.randomUUID(),
    at: Date.now(),
    agent,
    model: settings.model,
    effort: settings.effort,
    attempts: attempts.slice(0, 10),
    purpose,
  };
  try {
    localStorage.setItem(KEY, JSON.stringify([...readReportedUsage().slice(-99), entry]));
  } catch {
    /* Usage history is optional when browser storage is unavailable. */
  }
}
export function clearReportedUsage() {
  localStorage.removeItem(KEY);
}
