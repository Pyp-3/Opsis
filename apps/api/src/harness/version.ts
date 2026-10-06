import { HarnessError } from './errors.js';
import type { HarnessProvider } from './types.js';

const VERSION_PATTERNS: Record<HarnessProvider, RegExp> = {
  claude: /(?:^|\s)2\.1\.\d+(?:\s|$)/u,
  codex: /(?:^|\s)0\.(?:156|157|159)\.\d+(?:\s|$)/u,
  agy: /(?:^|\s)1\.3\.0(?:\s|$)/u,
  kimi: /(?:^|\s)1\.52\.\d+(?:\s|$)/u,
  grok: /(?:^|\s)1\.0\.46(?:\s|$)/u,
};

export function parseVersion(provider: HarnessProvider, output: string): string {
  const match = VERSION_PATTERNS[provider].exec(output);
  if (!match) throw new HarnessError('harness_config');
  return match[0].trim();
}
