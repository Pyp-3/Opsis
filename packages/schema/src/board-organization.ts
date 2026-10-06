import { z } from 'zod';
import { BoardAgentSchema } from './model-settings';

/**
 * Owner-private organization for saved boards: tags (several per board) and smart
 * collections (saved rules). Neither is part of a board document, its revisions or undo.
 */
export const MAX_BOARD_TAGS = 10;
export const MAX_SMART_COLLECTIONS = 50;
const tag = z.string().trim().min(1).max(30);

/** Trimmed tags without case-insensitive duplicates, in first-seen order. */
export function normalizeTags(tags: string[]) {
  const seen = new Set<string>();
  return tags
    .map((value) => value.trim())
    .filter((value) => {
      const key = value.toLocaleLowerCase();
      if (!value || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
export const BoardTagsRequestSchema = z
  .object({ tags: z.array(tag).max(MAX_BOARD_TAGS) })
  .strict()
  .transform((body) => ({ tags: normalizeTags(body.tags) }));

export const SmartCollectionRuleSchema = z
  .object({
    /** Every listed tag must be present. */
    tagsAll: z.array(tag).max(MAX_BOARD_TAGS).optional(),
    /** At least one listed tag must be present. */
    tagsAny: z.array(tag).max(MAX_BOARD_TAGS).optional(),
    visibility: z.enum(['private', 'public']).optional(),
    /** A collection id, or `unfiled` for boards in none. */
    collection: z.union([z.literal('unfiled'), z.string().uuid()]).optional(),
    updatedWithinDays: z.number().int().min(1).max(3650).optional(),
    agent: BoardAgentSchema.optional(),
    titleIncludes: z.string().trim().min(1).max(100).optional(),
  })
  .strict()
  .refine(
    (rule) =>
      Object.values(rule).some((value) =>
        Array.isArray(value) ? value.length > 0 : value !== undefined,
      ),
    'Choose at least one condition.',
  );
export type SmartCollectionRule = z.infer<typeof SmartCollectionRuleSchema>;
export const SmartCollectionRequestSchema = z
  .object({ name: z.string().trim().min(1).max(60), rule: SmartCollectionRuleSchema })
  .strict();

export type OrganizedBoard = {
  title: string;
  updatedAt: number;
  visibility?: 'private' | 'public' | undefined;
  collectionId?: string | null | undefined;
  tags?: string[] | undefined;
  agent?: string | null | undefined;
};

const DAY = 86_400_000;
const lower = (value: string) => value.toLocaleLowerCase();

/** Whether a listed board satisfies every condition in a smart collection's rule. */
export function matchesSmartCollection(
  board: OrganizedBoard,
  rule: SmartCollectionRule,
  now = Date.now(),
) {
  const tags = new Set((board.tags ?? []).map(lower));
  if (rule.tagsAll?.some((value) => !tags.has(lower(value)))) return false;
  if (rule.tagsAny?.length && !rule.tagsAny.some((value) => tags.has(lower(value)))) return false;
  if (rule.visibility && (board.visibility ?? 'private') !== rule.visibility) return false;
  if (rule.collection === 'unfiled' && board.collectionId) return false;
  if (rule.collection && rule.collection !== 'unfiled' && board.collectionId !== rule.collection)
    return false;
  if (rule.updatedWithinDays && now - board.updatedAt > rule.updatedWithinDays * DAY) return false;
  if (rule.agent && board.agent !== rule.agent) return false;
  if (rule.titleIncludes && !lower(board.title).includes(lower(rule.titleIncludes))) return false;
  return true;
}
