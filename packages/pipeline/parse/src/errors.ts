import type { ErrorResponse } from '@opsis/schema';

export type ParseErrorCode = 'empty_utterance' | 'utterance_too_long' | 'unsafe_input';

/** A user-facing parse failure with a friendly, student-appropriate message. */
export class ParseError extends Error {
  readonly code: ParseErrorCode;

  constructor(code: ParseErrorCode, message: string) {
    super(message);
    this.name = 'ParseError';
    this.code = code;
  }

  /** Converts the error to the API error envelope (PROMPT.md §11). */
  toErrorResponse(): ErrorResponse {
    return { code: this.code, message: this.message, stage: 'parse', retryable: false };
  }
}
