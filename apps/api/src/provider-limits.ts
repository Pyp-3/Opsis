import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  LIMIT_PROVIDERS,
  LimitProviderSchema,
  mergeProviderLimits,
  type LimitProvider,
  type ProviderLimits,
  type ProviderLimitsResponse,
} from '@opsis/schema';
import { resolveAgentExecutable } from './cli-executable.js';
import { childEnvironment, validateExecutable, versionRunRequest } from './harness/client.js';
import { HarnessError } from './harness/errors.js';
import { isResponseLine, limitCheck, limitsFromCheckOutput } from './harness/limits.js';
import { SpawnProcessRunner } from './harness/runner.js';
import { parseVersion } from './harness/version.js';
import type { ProcessRunner } from './harness/types.js';
import type { BoardClientFactory } from './boards/client.js';

/** Runs one provider's no-call check; null when it reports no subscription windows. */
export type LimitChecker = (provider: LimitProvider) => Promise<ProviderLimits | null>;

/** Checks never run more often than this per provider, however many people ask. */
export const LIMIT_CHECK_INTERVAL_MS = 60_000;

const PROBLEMS = {
  missing: 'The CLI is not installed here, or its version is not supported.',
  none: 'The CLI reported no subscription limits. An API key may power it.',
  failed: 'Could not read the limits. Check the CLI’s login on this host.',
  off: 'Limit checks are turned off on this host.',
} as const;

/** Raised by a checker the operator turned off (`OPSIS_LIMIT_CHECKS=off`, as in browser QA). */
export class LimitChecksOff extends Error {}

type Entry = {
  limits: ProviderLimits | null;
  problem: string | null;
  /** When a check last started, or a request last reported limits. */
  freshAt: number;
  pending: Promise<void> | null;
};

/**
 * The instance's provider limits, shared by every account because the CLI logins are. It keeps
 * the latest report per provider in memory (a restart simply checks again), merges what
 * requests report, and runs at most one check per provider at a time and per interval.
 */
export class ProviderLimitsTracker {
  private readonly entries = new Map<LimitProvider, Entry>();

  constructor(
    private readonly check: LimitChecker,
    private readonly clock: () => number = Date.now,
    private readonly intervalMs = LIMIT_CHECK_INTERVAL_MS,
  ) {}

  private entry(provider: LimitProvider): Entry {
    let entry = this.entries.get(provider);
    if (!entry) {
      entry = { limits: null, problem: null, freshAt: -Infinity, pending: null };
      this.entries.set(provider, entry);
    }
    return entry;
  }

  /** Records what a request's stream reported. */
  observe(limits: ProviderLimits) {
    const entry = this.entry(limits.provider);
    entry.limits = mergeProviderLimits(entry.limits, limits);
    entry.problem = null;
    entry.freshAt = this.clock();
  }

  /** Checks the providers whose report is older than the interval, waiting for every check. */
  async refresh(providers: readonly LimitProvider[] = LIMIT_PROVIDERS) {
    await Promise.all(
      providers.map((provider) => {
        const entry = this.entry(provider);
        if (entry.pending) return entry.pending;
        if (this.clock() - entry.freshAt < this.intervalMs) return;
        entry.freshAt = this.clock();
        entry.pending = this.check(provider)
          .then(
            (limits) => {
              if (limits) entry.limits = mergeProviderLimits(entry.limits, limits);
              entry.problem = limits ? null : PROBLEMS.none;
            },
            (error: unknown) => {
              if (error instanceof LimitChecksOff) {
                entry.problem = PROBLEMS.off;
                return;
              }
              entry.problem =
                error instanceof HarnessError &&
                ['harness_missing', 'harness_config'].includes(error.code)
                  ? PROBLEMS.missing
                  : PROBLEMS.failed;
            },
          )
          .finally(() => {
            entry.pending = null;
          });
        return entry.pending;
      }),
    );
  }

  snapshot(): ProviderLimitsResponse {
    return {
      providers: LIMIT_PROVIDERS.map((provider) => {
        const entry = this.entry(provider);
        return {
          provider,
          limits: entry.limits,
          problem: entry.problem,
          checking: entry.pending !== null,
        };
      }),
    };
  }
}

/** Runs the shared no-call check with the CLI this host would use for a request. */
export function localLimitChecker(
  runner: ProcessRunner = new SpawnProcessRunner(),
  env: NodeJS.ProcessEnv = process.env,
  clock: () => Date = () => new Date(),
): LimitChecker {
  return async (provider) => {
    // Checks use the host's real CLI logins; test servers turn them off.
    if (env.OPSIS_LIMIT_CHECKS === 'off') throw new LimitChecksOff();
    const executable = await validateExecutable(await resolveAgentExecutable(provider, { env }), {
      allowedPaths: [await resolveAgentExecutable(provider, { env })],
    });
    const directory = await mkdtemp(join(tmpdir(), 'opsis-limits-'));
    try {
      await chmod(directory, 0o700);
      const version = await runner.run(versionRunRequest(executable, directory, env));
      parseVersion(provider, version.stdout);
      const check = limitCheck(provider);
      const result = await runner.run({
        executable,
        args: check.args,
        stdin: check.stdin,
        cwd: directory,
        env: { ...childEnvironment(env), ...check.environment },
        timeoutMs: check.timeoutMs,
        maxStdinBytes: 4096,
        maxStdoutBytes: 2_000_000,
        maxStderrBytes: 2_000_000,
        ...(check.untilResponseId === null
          ? {}
          : { untilLine: (line: string) => isResponseLine(line, check.untilResponseId!) }),
      });
      return limitsFromCheckOutput(provider, result.stdout, clock());
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  };
}

/** Records the limits a provider reports while it works on any request. */
export function observingLimits(
  factory: BoardClientFactory,
  tracker: ProviderLimitsTracker,
): BoardClientFactory {
  return async (...args) => {
    const client = await factory(...args);
    return {
      ...client,
      complete: (
        request: Parameters<typeof client.complete>[0],
        signal?: AbortSignal,
        files?: Parameters<typeof client.complete>[2],
        progress?: Parameters<typeof client.complete>[3],
      ) =>
        client.complete(request, signal, files, (value) => {
          if (value.type === 'limits') tracker.observe(value.limits);
          progress?.(value);
        }),
    };
  };
}

export function registerProviderLimits(app: FastifyInstance, tracker: ProviderLimitsTracker) {
  // The limits describe the instance's shared logins: members only, never agent keys or guests.
  app.addHook('onRequest', async (request, reply) => {
    if (
      (request.routeOptions.url ?? '').startsWith('/v1/providers/limits') &&
      (!request.user || request.viaAgent || request.user.role === 'guest')
    )
      return reply.code(401).send({ message: 'Sign in to see provider limits.' });
  });
  app.get('/v1/providers/limits', async () => tracker.snapshot());
  app.post('/v1/providers/limits/refresh', { bodyLimit: 1024 }, async (request, reply) => {
    const body = z
      .object({ providers: z.array(LimitProviderSchema).min(1).max(LIMIT_PROVIDERS.length) })
      .strict()
      .safeParse(request.body ?? { providers: [...LIMIT_PROVIDERS] });
    if (!body.success) return reply.code(400).send({ message: 'Choose Claude or Codex.' });
    await tracker.refresh([...new Set(body.data.providers)]);
    return tracker.snapshot();
  });
}
