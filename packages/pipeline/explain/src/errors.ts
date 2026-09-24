import type { ErrorResponse } from '@opsis/schema';

export type ExplainErrorCode = 'osg_not_found' | 'node_not_found' | 'not_drillable' | 'no_parts';

/** A user-facing explain/drill-down failure with a friendly, student-appropriate message. */
export class ExplainError extends Error {
  readonly code: ExplainErrorCode;
  readonly stage: 'explain' | 'drilldown';

  constructor(code: ExplainErrorCode, message: string, stage: 'explain' | 'drilldown') {
    super(message);
    this.name = 'ExplainError';
    this.code = code;
    this.stage = stage;
  }

  /** Converts the error to the API error envelope (PROMPT.md §11). */
  toErrorResponse(): ErrorResponse {
    return { code: this.code, message: this.message, stage: this.stage, retryable: false };
  }
}
