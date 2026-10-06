import { z } from 'zod';
import { BoardAgentSchema } from './model-settings';

export const ChatMessageSchema = z
  .object({
    role: z.enum(['user', 'assistant']),
    text: z.string().trim().min(1).max(4000),
  })
  .strict();
export const BoardChatThreadSchema = z
  .object({
    id: z.string().uuid(),
    agent: BoardAgentSchema,
    model: z.string().min(1).max(200),
    messages: z.array(ChatMessageSchema).min(1).max(80),
  })
  .strict();
export const BoardChatWriteSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    thread: BoardChatThreadSchema,
  })
  .strict();
export const BoardChatEntrySchema = BoardChatThreadSchema.extend({
  revision: z.number().int().positive(),
  updatedAt: z.number(),
});
export type BoardChatThread = z.infer<typeof BoardChatThreadSchema>;
export type BoardChatEntry = z.infer<typeof BoardChatEntrySchema>;
