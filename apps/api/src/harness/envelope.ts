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

function extractClaudeLike(stdout: string): string {
  const envelope = jsonObject(stdout);
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
  const text = provider === 'codex' ? extractCodex(stdout) : extractClaudeLike(stdout);
  return JSON.stringify(jsonObject(text));
}
