import type { BoardAgent } from '@opsis/schema';
import { BrandMark } from './BrandMark';

/** Decorative provider identity; the adjacent picker supplies the accessible name. */
export function AgentLogo({ agent }: { agent: BoardAgent }) {
  return agent === 'demo' ? (
    <span className="agent-logo agent-logo-demo" aria-hidden="true">
      <BrandMark size={18} />
    </span>
  ) : (
    <span className={`agent-logo agent-logo-${agent}`} aria-hidden="true">
      {agent === 'kimi' ? 'K' : agent === 'grok' ? 'G' : agent === 'antigravity' ? 'A' : null}
    </span>
  );
}
