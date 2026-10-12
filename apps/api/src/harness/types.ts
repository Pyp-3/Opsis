import type { HarnessProgress } from './progress.js';

/** CLI harnesses audited for use as local LLM providers. */
export type HarnessProvider = 'claude' | 'codex' | 'agy' | 'kimi' | 'grok';

/** Validated, non-secret configuration for one CLI harness. */
export type HarnessConfig = {
  provider: HarnessProvider;
  model: string;
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  executable: string;
  timeoutMs: number;
  maxBudgetUSD?: number;
  /** The chat thread's native CLI session for this run; see sessions.ts. */
  session?: { id?: string; resume: boolean };
  /**
   * Full access (Claude and Codex only): the CLI runs with the user's own settings, skills,
   * plugins and MCP servers, with every tool and no permission prompts.
   */
  access?: 'full';
  /** The CLI's fast mode (Claude and Codex only). */
  fast?: boolean;
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
  /** Called with each complete stdout line as it arrives, for live progress. */
  onStdoutLine?: (line: string) => void;
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
  onProgress?: (progress: HarnessProgress) => void,
) => Promise<string>;

/** One completion request; callers own parsing and validation. */
export type LLMRequest = {
  promptId: string;
  system: string;
  user: string;
  responseFormat: 'json' | 'text';
  temperature: number;
  maxOutputTokens: number;
  /**
   * The chat thread whose native CLI session this request continues, where the CLI supports it.
   * A resumed session already holds the instructions and earlier turns, so it is sent the
   * shorter `resumeSystem`/`resumeUser` instead.
   */
  session?: {
    key: string;
    resumeSystem: string;
    resumeUser: string;
    /** Start a new session for the thread rather than resuming its current one. */
    fresh?: boolean;
  };
};

export interface LLMClient {
  readonly model: string;
  complete(request: LLMRequest): Promise<string>;
}
