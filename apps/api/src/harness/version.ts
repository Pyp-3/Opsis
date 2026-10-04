import { HarnessError } from './errors.js';
import type { HarnessProvider } from './types.js';

const VERSION_PATTERNS: Record<HarnessProvider, RegExp> = {
  claude: /(?:^|\s)2\.1\.\d+(?:\s|$)/u,
  codex: /(?:^|\s)0\.(?:156|157|159)\.\d+(?:\s|$)/u,
  agy: /(?:^|\s)1\.2\.\d+(?:\s|$)/u,
};

export function parseVersion(provider: HarnessProvider, output: string): string {
  const match = VERSION_PATTERNS[provider].exec(output);
  if (!match) throw new HarnessError('harness_config');
  return match[0].trim();
}
