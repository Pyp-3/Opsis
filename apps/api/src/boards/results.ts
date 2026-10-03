import {
  CustomIconSchema,
  IllustrationSchema,
  type BoardAgent,
  type Illustration,
} from '@opsis/schema';
import { HarnessError } from '../harness/index.js';

/** Only a malformed answer is repairable; provider failures retain their original handling. */
export function envelopeRepairPrompt(error: unknown, attempt: number): string {
  if (
    attempt === 0 &&
    error instanceof HarnessError &&
    ['harness_malformed', 'harness_schema'].includes(error.code)
  )
    return `\nYour previous response was invalid (${error.code}). Return only a complete JSON object matching the schema.`;
  throw error;
}

export const agentLabel = (agent: Exclude<BoardAgent, 'demo'>) =>
  agent === 'claude' ? 'Claude' : 'Codex';

/**
 * A custom icon is presentation with a library icon to fall back on, so a malformed drawing is
 * dropped rather than failing the whole diagram.
 */
export function withoutInvalidCustomIcons(output: unknown) {
  const nodes = (output as { nodes?: unknown } | null)?.nodes;
  if (!Array.isArray(nodes)) return output;
  for (const node of nodes as { customIcon?: unknown }[])
    if (node && 'customIcon' in node && !CustomIconSchema.safeParse(node.customIcon).success)
      delete node.customIcon;
  return output;
}

/** Keeps the drawings that are valid for requested objects; the rest keep their icons. */
export function acceptIllustrations(output: string, wanted: ReadonlySet<string>) {
  const parsed = JSON.parse(output) as { illustrations?: unknown };
  if (!Array.isArray(parsed.illustrations)) throw new Error('Missing an illustrations list.');
  const illustrations: Record<string, Illustration> = {};
  const problems: string[] = [];
  for (const item of parsed.illustrations as { id?: unknown; illustration?: unknown }[]) {
    if (typeof item?.id !== 'string' || !wanted.has(item.id) || illustrations[item.id]) continue;
    const result = IllustrationSchema.safeParse(item.illustration);
    if (result.success) illustrations[item.id] = result.data;
    else
      problems.push(
        `${item.id}: ${result.error.issues
          .slice(0, 3)
          .map((issue) => `${issue.path.join('.')} ${issue.message}`)
          .join('; ')}`,
      );
  }
  return {
    illustrations,
    skipped: [...wanted].filter((id) => !illustrations[id]),
    problems,
  };
}
