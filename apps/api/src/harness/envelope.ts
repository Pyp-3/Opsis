import { HarnessError } from './errors.js';
import type { HarnessProvider } from './types.js';

function jsonObject(text: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new HarnessError('harness_malformed');
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new HarnessError('harness_schema');
  }
  return value as Record<string, unknown>;
}

function resultText(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return JSON.stringify(value);
  }
  return null;
}

/** Streamed output is one event per line, ending with the same result envelope. */
function claudeEnvelope(stdout: string): Record<string, unknown> {
  try {
    return jsonObject(stdout);
  } catch (error) {
    if (!stdout.includes('"type":"result"')) throw error;
  }
  const lines = stdout.split(/\r?\n/u).filter((line) => line.trim());
  for (const line of lines.reverse()) {
    if (!line.includes('"result"')) continue;
    try {
      const event = jsonObject(line);
      if (event.type === 'result') return event;
    } catch {
      // Not the envelope; keep looking.
    }
  }
  throw new HarnessError('harness_malformed');
}

function extractClaudeLike(stdout: string): string {
  const envelope = claudeEnvelope(stdout);
  if (envelope.is_error === true) throw new HarnessError('harness_exit');
  const text = resultText(envelope.structured_output) ?? resultText(envelope.result);
  if (text === null) throw new HarnessError('harness_malformed');
  return text;
}

function extractCodex(stdout: string): string {
  let final: string | null = null;
  for (const line of stdout.split(/\r?\n/u)) {
    if (line.trim() === '') continue;
    const event = jsonObject(line);
    if (event.type !== 'item.completed') continue;
    const item = event.item;
    if (item === null || typeof item !== 'object' || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    if (record.type === 'agent_message' && typeof record.text === 'string') final = record.text;
  }
  if (final === null) throw new HarnessError('harness_malformed');
  return final;
}

/** Extracts and canonicalizes the JSON-only final result from a sanitized CLI envelope. */
export function extractHarnessResult(provider: HarnessProvider, stdout: string): string {
  if (provider === 'agy') {
    const events = stdout
      .split(/\r?\n/u)
      .filter((line) => line.trim())
      .map(jsonObject);
    const envelope = events.filter((event) => event.event === 'result').at(-1)?.result;
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope))
      throw new HarnessError('harness_malformed');
    const result = envelope as Record<string, unknown>;
    if (result.status !== 'SUCCESS') throw new HarnessError('harness_exit');
    const text = resultText(result.structured_output) ?? resultText(result.response);
    if (text === null) throw new HarnessError('harness_malformed');
    return JSON.stringify(jsonObject(text));
  }
  if (provider === 'kimi' || provider === 'grok') return JSON.stringify(jsonObject(stdout));
  const text = provider === 'codex' ? extractCodex(stdout) : extractClaudeLike(stdout);
  return JSON.stringify(jsonObject(text));
}
