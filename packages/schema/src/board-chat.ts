import { z } from 'zod';
import { BoardAgentSchema } from './model-settings';

/** What happened to the diagram or proposal an assistant turn produced. */
export const CHAT_OUTCOMES = [
  /** A new diagram was placed on the canvas. */
  'applied',
  /** A follow-up proposal is waiting for the reader's review. */
  'review',
  /** The reader applied only some of the proposed changes. */
  'partial',
  /** The reader discarded the proposal. */
  'discarded',
  /** The agent failed or was stopped; nothing changed. */
  'failed',
] as const;
export type ChatOutcome = (typeof CHAT_OUTCOMES)[number];

export const MAX_CHAT_MESSAGES = 80;
/** The recent messages sent to an agent verbatim; earlier ones live in the thread memory. */
export const CHAT_CONVERSATION_WINDOW = 12;
export const MAX_CHAT_MEMORY = 2000;

export const ChatMessageSchema = z
  .object({
    role: z.enum(['user', 'assistant']),
    text: z.string().trim().min(1).max(4000),
    outcome: z.enum(CHAT_OUTCOMES).optional(),
  })
  .strict();
export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export const BoardChatThreadSchema = z
  .object({
    id: z.string().uuid(),
    agent: BoardAgentSchema,
    model: z.string().min(1).max(200),
    messages: z.array(ChatMessageSchema).min(1).max(MAX_CHAT_MESSAGES),
    /**
     * The agent's running notes for this conversation (goals, decisions, preferences, what was
     * accepted or rejected). Each reply rewrites it, so a long thread keeps its context after
     * its oldest messages are condensed away.
     */
    memory: z.string().max(MAX_CHAT_MEMORY).optional(),
    /** How many of the oldest messages were condensed into the memory to keep the thread going. */
    condensed: z.number().int().nonnegative().optional(),
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

/** One earlier message as an agent is shown it. */
export const ConversationMessageSchema = z
  .object({
    role: z.enum(['user', 'assistant']),
    text: z.string().max(4000),
    outcome: z.enum(CHAT_OUTCOMES).optional(),
  })
  .strict();
export type ConversationMessage = z.infer<typeof ConversationMessageSchema>;

const firstLine = (text: string, length: number) => {
  const line = text.split('\n')[0]!.trim();
  return line.length > length ? `${line.slice(0, length - 1)}…` : line;
};

/**
 * Keeps notes within the memory limit by dropping whole lines from the start, so the most
 * recent context survives.
 */
export function boundChatMemory(memory: string): string {
  let lines = memory.trim().split('\n');
  while (lines.length > 1 && lines.join('\n').length > MAX_CHAT_MEMORY) lines = lines.slice(1);
  return lines.join('\n').slice(-MAX_CHAT_MEMORY).trim();
}

/**
 * Adds `message`, condensing the oldest messages when the thread is full, so a conversation
 * can continue indefinitely. The agent has already seen condensed messages and folded them into
 * its memory. Without agent memory (the demo, or an agent that left it out) the condensed
 * requests are noted in the memory so their gist is kept.
 */
export function appendChatMessage<T extends BoardChatThread>(thread: T, message: ChatMessage): T {
  const messages = [...thread.messages];
  let dropped: ChatMessage[] = [];
  // Room for this message and the reply to it.
  const keep = MAX_CHAT_MESSAGES - (message.role === 'user' ? 2 : 1);
  if (messages.length > keep) {
    dropped = messages.splice(0, messages.length - keep);
    // Never leave a reply without the request it answers at the start.
    if (messages[0]?.role === 'assistant') dropped.push(messages.shift()!);
  }
  if (!dropped.length) return { ...thread, messages: [...messages, message] };
  const notes = dropped
    .filter((item) => item.role === 'user')
    .map((item) => `Earlier request: ${firstLine(item.text, 160)}`);
  const memory = thread.memory?.trim()
    ? thread.memory
    : boundChatMemory(notes.join('\n')) || undefined;
  return {
    ...thread,
    messages: [...messages, message],
    condensed: (thread.condensed ?? 0) + dropped.length,
    ...(memory ? { memory } : {}),
  };
}

/** The recent messages an agent is shown verbatim, oldest first, excluding `pending`. */
export function chatConversation(
  messages: readonly ChatMessage[],
  pending = 1,
): ConversationMessage[] {
  return messages
    .slice(0, Math.max(0, messages.length - pending))
    .slice(-CHAT_CONVERSATION_WINDOW)
    .map((message) => ({
      role: message.role,
      text: message.text,
      ...(message.outcome ? { outcome: message.outcome } : {}),
    }));
}

/** Records what the reader did with the latest proposal on its assistant message. */
export function withChatOutcome<T extends BoardChatThread>(thread: T, outcome: ChatOutcome): T {
  const index = thread.messages.map((message) => message.role).lastIndexOf('assistant');
  if (index < 0) return thread;
  const messages = thread.messages.map((message, at) =>
    at === index ? { ...message, outcome } : message,
  );
  return { ...thread, messages };
}
