import type { BoardModelSettings, ReportedUsage, UsageRecord, ProviderAgent } from '@opsis/schema';
import { accountUsage, addAccountUsage, clearAccountUsage } from './account-settings';

export type UsageEntry = UsageRecord;
export function readReportedUsage(): UsageEntry[] {
  return accountUsage();
}
export function recordReportedUsage(
  agent: ProviderAgent,
  settings: BoardModelSettings,
  attempts: ReportedUsage[],
  purpose: UsageEntry['purpose'],
  boardId?: string,
) {
  void addAccountUsage({
    id: crypto.randomUUID(),
    at: Date.now(),
    agent,
    model: settings.model,
    effort: settings.effort,
    attempts: attempts.slice(0, 10),
    purpose,
    ...(boardId ? { boardId } : {}),
  }).catch(() => {
    /* Usage history is optional; a failed save never interrupts generation. */
  });
}
export function clearReportedUsage() {
  return clearAccountUsage();
}
