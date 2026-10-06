import type { ReportedUsage, UsageRecord } from '@opsis/schema';

/** A measured total plus how many attempts did not report it; never zero-filled. */
export type Measured = { total: number; unreported: number };
export type UsageGroup = {
  /** A collection id, `unfiled`, or `unknown` for boards no longer (or never) in the library. */
  key: string;
  name: string;
  requests: number;
  attempts: number;
  inputTokens: Measured;
  outputTokens: Measured;
  estimatedCostUSD: Measured;
};

const measure = (attempts: ReportedUsage[], field: keyof ReportedUsage): Measured =>
  attempts.reduce<Measured>(
    (sum, attempt) =>
      attempt[field] === null
        ? { ...sum, unreported: sum.unreported + 1 }
        : { ...sum, total: sum.total + attempt[field] },
    { total: 0, unreported: 0 },
  );
const add = (a: Measured, b: Measured): Measured => ({
  total: a.total + b.total,
  unreported: a.unreported + b.unreported,
});

/**
 * Groups reported usage by each board's current collection. Moving a board later moves its
 * history with it; deleted boards and generations before a first save count as unknown.
 */
export function usageByCollection(
  records: UsageRecord[],
  boards: { id: string; collectionId?: string | null | undefined }[],
  collections: { id: string; name: string }[],
): UsageGroup[] {
  const collectionOf = new Map(boards.map((board) => [board.id, board.collectionId ?? null]));
  const names = new Map(collections.map((collection) => [collection.id, collection.name]));
  const groups = new Map<string, UsageGroup>();
  for (const record of records) {
    const known = record.boardId !== undefined && collectionOf.has(record.boardId);
    const collectionId = known ? collectionOf.get(record.boardId!) : undefined;
    const key = !known
      ? 'unknown'
      : collectionId && names.has(collectionId)
        ? collectionId
        : 'unfiled';
    const name =
      key === 'unknown'
        ? 'Other or deleted boards'
        : key === 'unfiled'
          ? 'Unfiled'
          : names.get(key)!;
    const group = groups.get(key) ?? {
      key,
      name,
      requests: 0,
      attempts: 0,
      inputTokens: { total: 0, unreported: 0 },
      outputTokens: { total: 0, unreported: 0 },
      estimatedCostUSD: { total: 0, unreported: 0 },
    };
    groups.set(key, {
      ...group,
      requests: group.requests + 1,
      attempts: group.attempts + record.attempts.length,
      inputTokens: add(group.inputTokens, measure(record.attempts, 'inputTokens')),
      outputTokens: add(group.outputTokens, measure(record.attempts, 'outputTokens')),
      estimatedCostUSD: add(group.estimatedCostUSD, measure(record.attempts, 'estimatedCostUSD')),
    });
  }
  const order = (group: UsageGroup) =>
    group.key === 'unknown' ? 2 : group.key === 'unfiled' ? 1 : 0;
  return [...groups.values()].sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name));
}

/** “1,234 (2 attempts unreported)”, or “Unavailable” when nothing was reported. */
export function measuredLabel(value: Measured, attempts: number, format: (n: number) => string) {
  if (attempts > 0 && value.unreported === attempts) return 'Unavailable';
  return value.unreported
    ? `${format(value.total)} (${value.unreported} unreported)`
    : format(value.total);
}
