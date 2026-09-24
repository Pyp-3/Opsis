import type { Audience } from '@opsis/parse';

/** Reading-level contract for one audience; mirrored in docs/PEDAGOGY.md ("Audience wording"). */
export type AudienceRules = { reader: string; rules: readonly string[] };

/** Wording rules the explainer prompt enforces per audience (PROMPT.md §5.4, §12.1). */
export const AUDIENCE_RULES: Record<Audience, AudienceRules> = {
  child: {
    reader: 'a child aged about 8 to 11',
    rules: [
      'Use short sentences of about 12 words or fewer, in everyday words.',
      'Avoid technical terms; if one is unavoidable, explain it straight away with a familiar comparison.',
      'Describe one idea per sentence and speak to the reader as "you".',
      'Keep every simplification true: say "the Sun looks like it rises", never "the Sun rises up".',
    ],
  },
  teen: {
    reader: 'a student aged about 12 to 16',
    rules: [
      'Use clear sentences; give a one-clause definition the first time a key term appears.',
      'Explain cause and effect ("because", "so") rather than only naming things.',
      'Scientific names are fine when defined; avoid unexplained abbreviations.',
    ],
  },
  adult: {
    reader: 'a curious adult without specialist training',
    rules: [
      'Be precise and concise; standard terminology is fine.',
      'Mention important exceptions or nuance in a few words rather than over-simplifying.',
    ],
  },
};

/** Rules that apply to every audience. */
export const SHARED_WORDING_RULES: readonly string[] = [
  'Simplify truthfully: a simpler statement must still be correct.',
  'State only well-established facts. Never present a guess, rumour or opinion as fact.',
  'Do not use "just", "simply" or "obviously"; they make learners feel slow.',
  'Do not say "always" or "never" unless it is strictly true.',
  'Use neutral, kind language that is safe for students.',
];

/** Renders the audience block of the system prompt. */
export function renderAudienceGuidance(audience: Audience): string {
  const { reader, rules } = AUDIENCE_RULES[audience];
  return [
    `Write for ${reader}.`,
    ...rules.map((rule) => `- ${rule}`),
    ...SHARED_WORDING_RULES.map((rule) => `- ${rule}`),
  ].join('\n');
}
