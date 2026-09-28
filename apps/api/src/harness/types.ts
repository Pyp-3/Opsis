import type { LLMRequest } from '@opsis/parse';

/** CLI harnesses audited for use as local LLM providers. */
export type HarnessProvider = 'claude' | 'codex' | 'agy';

/** Validated, non-secret configuration for one CLI harness. */
export type HarnessConfig = {
  provider: HarnessProvider;
  model: string;
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  executable: string;
  timeoutMs: number;
};

/** A bounded child-process request. Implementations must never invoke a shell. */
export type ProcessRunRequest = {
  executable: string;
  args: readonly string[];
  stdin: string;
  cwd: string;
  env: Readonly<Record<string, string>>;
  timeoutMs: number;
  maxStdinBytes: number;
  maxStdoutBytes: number;
  maxStderrBytes: number;
  signal?: AbortSignal;
};

/** Sanitized child-process result. Callers must not include stderr in diagnostics. */
export type ProcessRunResult = { exitCode: number; stdout: string };

/** Injectable process boundary used by production spawn code and unit tests. */
export interface ProcessRunner {
  run(request: ProcessRunRequest): Promise<ProcessRunResult>;
}

/** An uploaded file staged in the private workspace for the agent to read itself. */
export type HarnessFile = { name: string; data: Buffer; kind: 'image' | 'pdf' };

/** Concrete client signature adds caller cancellation without changing the shared interface. */
export type HarnessComplete = (
  request: LLMRequest,
  signal?: AbortSignal,
  files?: readonly HarnessFile[],
) => Promise<string>;
