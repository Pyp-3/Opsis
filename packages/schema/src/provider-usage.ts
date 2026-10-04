import { z } from 'zod';

/** Provider fields stay nullable: missing measurements must never become zero. */
export const ReportedUsageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative().nullable(),
    outputTokens: z.number().int().nonnegative().nullable(),
    cachedInputTokens: z.number().int().nonnegative().nullable(),
    cacheWriteTokens: z.number().int().nonnegative().nullable(),
    estimatedCostUSD: z.number().finite().nonnegative().nullable(),
  })
  .strict();
export type ReportedUsage = z.infer<typeof ReportedUsageSchema>;
