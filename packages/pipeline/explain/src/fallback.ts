import type { Audience } from '@opsis/parse';
import { countWords, ExplanationSchema, type Explanation } from '@opsis/schema';
import type { NodeContext } from './context';
import { KNOWN_PARTS, misconceptionFor } from './knowledge';
import type { ExplainRequestFields } from './prompt';
import { sanitizeParts } from './validate';

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Trims text to at most `max` words, ending with a full stop. */
export function clampWords(text: string, max = 25): string {
  const words = text.trim().split(/\s+/u);
  if (words.length <= max) return text.trim();
  return `${words
    .slice(0, max)
    .join(' ')
    .replace(/[,;:.]+$/u, '')}.`;
}

function whatItIs(context: NodeContext): string {
  if (context.entity) return context.entity.summary;
  if (context.relation) return `${capitalise(context.facts[0] ?? context.label)}.`;
  return `The ${context.label.toLowerCase()} is part of the picture Opsis drew for your sentence.`;
}

const PART_OF = new Set(['has_part', 'contains']);

function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** Ends a sentence after a quotation without doubling its punctuation. */
function closeQuote(quoted: string): string {
  return /[.!?]"$/u.test(quoted) ? quoted : `${quoted}.`;
}

/** "the tomato is one possible part of the sandwich", when the SG says so. */
function partOfPhrase(context: NodeContext, audience: Audience): string | undefined {
  const link = context.relations.find(
    (relation) => relation.target === context.nodeId && PART_OF.has(relation.type),
  );
  if (!link) return undefined;
  const whole = context.wholeName ?? 'whole';
  const it = `the ${context.name}`;
  switch (link.modality) {
    case 'possible':
      return audience === 'child'
        ? `${it} is one thing a ${whole} can have. "Can" means it is a choice, not a must.`
        : `${it} is an optional part of the ${whole}: "can" means it may be there, not that it must.`;
    case 'negated':
      return `${it} is named as something the ${whole} does not have.`;
    case 'typical':
      return `${it} is usually part of the ${whole}.`;
    default:
      return `${it} is one part of the ${whole}.`;
  }
}

/** Ties the node to the student's own sentence using only what the SG says. */
function whyItMattersHere(context: NodeContext, audience: Audience): string {
  const quoted = `"${context.utterance}"`;
  const lead = `In your sentence, ${quoted},`;
  const part = partOfPhrase(context, audience);
  if (part) return `${lead} ${part}`;
  if (context.entity) {
    const word = `the word "${context.entity.surface}"`;
    const linked = context.linkedNames;
    if (linked.length === 0) return `${lead} ${word} names something to picture on its own.`;
    return `${lead} ${word} is linked to ${joinNames(linked)}; the diagram shows how they connect.`;
  }
  if (context.relation)
    return `${lead} Opsis read this link: ${context.facts[0] ?? context.label}.`;
  return `Opsis added the ${context.label.toLowerCase()} to help picture your sentence ${closeQuote(quoted)}`;
}

function misconception(context: NodeContext, audience: Audience): string | undefined {
  const note = context.notes.find(
    (item) => item.kind === 'misconception' || item.kind === 'nuance',
  );
  return note?.text ?? misconceptionFor(context.name, audience);
}

/** Drill-down candidates known without an LLM: parts named in the SG, else curated parts. */
export function offlineParts(context: NodeContext): string[] {
  const parts = context.parts.length > 0 ? context.parts : (KNOWN_PARTS[context.name] ?? []);
  return sanitizeParts(parts, context.name);
}

/**
 * Offline explanation built only from the SG and curated pedagogy notes. It never adds facts of
 * its own, and it is always `confidence: "low"` so the UI shows the "unsure" indicator (§12.1).
 */
export function fallbackExplanation(
  context: NodeContext,
  request: ExplainRequestFields,
): Explanation {
  const { audience } = request;
  const summarySource = context.entity?.summary ?? whatItIs(context);
  const summary = countWords(summarySource) <= 25 ? summarySource : clampWords(summarySource);
  const commonMisconception = misconception(context, audience);
  const parts = offlineParts(context);
  return ExplanationSchema.parse({
    schemaVersion: 'exp/1',
    ...request,
    summary,
    ...(request.level === 'explanation'
      ? {
          sections: {
            whatItIs: whatItIs(context),
            whyItMattersHere: whyItMattersHere(context, audience),
            ...(commonMisconception ? { commonMisconception } : {}),
          },
        }
      : {}),
    confidence: 'low',
    ...(parts.length > 0 ? { suggestedDrillDown: parts } : {}),
  });
}
