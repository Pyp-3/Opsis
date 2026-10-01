import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { HarnessError } from './errors.js';
import type { ProcessRunner, ProcessRunRequest, ProcessRunResult } from './types.js';
import { executableCommand } from '../cli-executable.js';

const KILL_GRACE_MS = 2_000;

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

/** Production process runner with bounded I/O, cancellation, deadlines and no shell. */
export class SpawnProcessRunner implements ProcessRunner {
  run(request: ProcessRunRequest): Promise<ProcessRunResult> {
    if (byteLength(request.stdin) > request.maxStdinBytes) {
      return Promise.reject(new HarnessError('harness_overflow'));
    }
    if (request.signal?.aborted) return Promise.reject(new HarnessError('harness_cancelled'));

    return new Promise((resolve, reject) => {
      const command = executableCommand(request.executable, request.args);
      const child = spawn(command.executable, command.args, {
        shell: false,
        windowsHide: true,
        cwd: request.cwd,
        env: { ...request.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let pending = '';
      let settled = false;
      let failure: HarnessError | undefined;
      let killTimer: NodeJS.Timeout | undefined;

      const terminate = (error: HarnessError) => {
        failure ??= error;
        child.kill('SIGTERM');
        killTimer ??= setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS);
        killTimer.unref();
      };
      const deadline = setTimeout(
        () => terminate(new HarnessError('harness_timeout')),
        request.timeoutMs,
      );
      deadline.unref();
      const cancel = () => terminate(new HarnessError('harness_cancelled'));
      request.signal?.addEventListener('abort', cancel, { once: true });

      child.stdout.on('data', (chunk: Buffer) => {
        stdoutBytes += chunk.length;
        if (stdoutBytes > request.maxStdoutBytes) {
          terminate(new HarnessError('harness_overflow'));
          return;
        }
        const text = chunk.toString('utf8');
        stdout += text;
        if (!request.onStdoutLine) return;
        const lines = (pending + text).split('\n');
        pending = lines.pop() ?? '';
        for (const line of lines) if (line.trim()) request.onStdoutLine(line);
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderrBytes += chunk.length;
        if (stderrBytes > request.maxStderrBytes) terminate(new HarnessError('harness_overflow'));
      });
      child.on('error', () => {
        failure ??= new HarnessError('harness_missing');
      });
      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        if (killTimer) clearTimeout(killTimer);
        request.signal?.removeEventListener('abort', cancel);
        if (failure) reject(failure);
        else if (code !== 0) reject(new HarnessError('harness_exit'));
        else resolve({ exitCode: 0, stdout });
      });
      child.stdin.on('error', () => undefined);
      child.stdin.end(request.stdin, 'utf8');
    });
  }
}
