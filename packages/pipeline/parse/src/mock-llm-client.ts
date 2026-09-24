import type { LLMClient, LLMRequest } from './llm-client';

/** A scripted reply: raw completion text, an error to throw, or a function of the request. */
export type MockReply = string | Error | ((request: LLMRequest) => string);

/**
 * Deterministic in-memory LLMClient for tests and offline demos. Replies are consumed in order;
 * once exhausted the client throws, so tests notice unexpected extra calls.
 */
export class MockLLMClient implements LLMClient {
  readonly model: string;
  readonly calls: LLMRequest[] = [];
  private readonly replies: MockReply[];

  constructor(replies: readonly MockReply[], model = 'mock-model') {
    this.replies = [...replies];
    this.model = model;
  }

  /** Records the request and returns (or throws) the next scripted reply. */
  async complete(request: LLMRequest): Promise<string> {
    this.calls.push(request);
    const reply = this.replies.shift();
    if (reply === undefined) throw new Error('MockLLMClient: no scripted reply left');
    if (reply instanceof Error) throw reply;
    return typeof reply === 'function' ? reply(request) : reply;
  }
}
