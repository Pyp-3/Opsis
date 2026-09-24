import type {
  Entity,
  EntityKind,
  PedagogyNote,
  Relation,
  RelationType,
  SemanticGraph,
} from '@opsis/schema';
import {
  ACTION_VERBS,
  DETERMINERS,
  DIRECTIONS,
  KIND_BY_LEMMA,
  MOTION_VERBS,
  NUMBER_WORDS,
  PRONOUNS,
  QUANTIFIERS,
  STATE_CHANGE_VERBS,
  SUMMARY_BY_LEMMA,
  nounLemma,
  verbLemma,
} from './lexicon';
import { attachKnownNotes } from './pedagogy';

type Modality = Relation['modality'];
type Attributes = NonNullable<Entity['attributes']>;

/** A piece of the utterance with its absolute start offset. */
type Phrase = { text: string; start: number };

/** A validated noun phrase ready to become an entity. */
type NounPhrase = { surface: string; start: number; attributes: Attributes; negated: boolean };

const NP = String.raw`([A-Za-z][A-Za-z' -]*?)`;
const MODAL = String.raw`(can(?:not| not)?|can't|may(?: not)?|might(?: not)?|could(?: not)?|sometimes|usually|often|typically|normally|generally|always|never|must|will|do not|does not|don't|doesn't|did not|didn't)`;
const DIR = `(${[...DIRECTIONS].sort((a, b) => b.length - a.length).join('|')})`;
const BLOCKED_NP_WORDS = new Set([
  'is',
  'are',
  'was',
  'were',
  'can',
  'cannot',
  "can't",
  'not',
  'never',
  'then',
  'than',
  'because',
  'and',
  'or',
  'but',
  'will',
  'must',
  'may',
  'might',
  'could',
  'do',
  'does',
  "don't",
  "doesn't",
]);

/** Maps modal words to SG modality: "can" → possible, "usually" → typical, "cannot/never" → negated. */
export function modalityOf(modal: string | undefined, negated = false): Modality {
  if (negated) return 'negated';
  const word = modal?.toLowerCase().replace(/\s+/gu, ' ').trim();
  if (!word) return 'certain';
  if (/\bnot\b|n't|never|cannot/u.test(word)) return 'negated';
  if (['can', 'may', 'might', 'could', 'sometimes'].includes(word)) return 'possible';
  if (['usually', 'often', 'typically', 'normally', 'generally'].includes(word)) return 'typical';
  return 'certain';
}

const slug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '_')
    .replace(/^_+|_+$/gu, '') || 'x';

const capitalise = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

/** Strips determiners, quantifiers and numbers from a phrase; returns null if it is not a simple noun phrase. */
function nounPhrase(phrase: Phrase): NounPhrase | null {
  const leading = phrase.text.length - phrase.text.trimStart().length;
  let text = phrase.text.trim().replace(/[.,;:!?"]+$/u, '');
  let start = phrase.start + leading;
  const attributes: Attributes = {};
  let negated = false;
  for (;;) {
    const match = /^([A-Za-z]+)\s+/u.exec(text);
    const word = match?.[1]?.toLowerCase();
    if (!match || word === undefined) break;
    if (DETERMINERS.has(word)) {
      // plain determiner: drop it
    } else if (QUANTIFIERS.has(word)) {
      attributes.quantifier = word;
    } else if (NUMBER_WORDS[word] !== undefined) {
      attributes.count = NUMBER_WORDS[word];
    } else if (word === 'no') {
      negated = true;
    } else {
      break;
    }
    text = text.slice(match[0].length);
    start += match[0].length;
  }
  const words = text.split(/\s+/u);
  if (!/^[A-Za-z][A-Za-z' -]*$/u.test(text) || words.length > 4) return null;
  if (words.some((word) => BLOCKED_NP_WORDS.has(word.toLowerCase()))) return null;
  if (words.length === 1 && DETERMINERS.has(text.toLowerCase())) return null;
  return { surface: text, start, attributes, negated };
}

/** Accumulates entities and relations with stable, de-duplicated ids. */
class GraphBuilder {
  readonly entities: Entity[] = [];
  readonly relations: Relation[] = [];
  private readonly byKey = new Map<string, Entity>();

  constructor(readonly utterance: string) {}

  /** Adds (or reuses, by lemma) an entity for a noun phrase. */
  noun(np: NounPhrase, hint?: EntityKind): string {
    const words = np.surface.split(/\s+/u);
    const lowerLemma = [
      ...words.slice(0, -1).map((word) => word.toLowerCase()),
      nounLemma(words.at(-1) ?? np.surface),
    ].join(' ');
    const isProperName =
      /^[A-Z]/u.test(np.surface) &&
      KIND_BY_LEMMA[lowerLemma] === undefined &&
      KIND_BY_LEMMA[np.surface.toLowerCase()] === undefined;
    const lemma = isProperName ? np.surface : lowerLemma;
    const kind =
      KIND_BY_LEMMA[lowerLemma] ??
      (DIRECTIONS.includes(lowerLemma) ? 'direction' : undefined) ??
      hint ??
      (isProperName ? 'place' : 'object');
    return this.add(`n:${lemma.toLowerCase()}`, {
      surface: np.surface,
      lemma,
      kind,
      span: [np.start, np.start + np.surface.length],
      attributes: np.attributes,
    });
  }

  /** Adds an action entity for a verb; `unique` keeps repeated steps apart in sequences. */
  verb(phrase: Phrase, unique = false, attributes: Attributes = {}): string {
    const lemma = verbLemma(phrase.text);
    const key = unique ? `v:${lemma}:${this.entities.length}` : `v:${lemma}`;
    return this.add(key, {
      surface: phrase.text,
      lemma,
      kind: 'action',
      span: [phrase.start, phrase.start + phrase.text.length],
      attributes,
    });
  }

  /** Adds an entity for a whole clause, used for "A because B". */
  event(phrase: Phrase): string {
    const text = phrase.text.trim();
    const start = phrase.start + phrase.text.indexOf(text);
    return this.add(`e:${text.toLowerCase()}`, {
      surface: text,
      lemma: text.toLowerCase(),
      kind: 'event',
      span: [start, start + text.length],
      attributes: {},
    });
  }

  /** Merges attributes into an existing entity. */
  annotate(id: string, attributes: Attributes): void {
    const entity = this.entities.find((candidate) => candidate.id === id);
    if (entity) entity.attributes = { ...entity.attributes, ...attributes };
  }

  /** Adds a relation between two known entities. */
  relate(
    type: RelationType,
    source: string,
    target: string,
    modality: Modality,
    extra: { order?: number; evidence?: [number, number] } = {},
  ): string {
    const base = `r_${source.replace(/^e_/u, '')}_${type}_${target.replace(/^e_/u, '')}`;
    let id = base;
    for (let n = 2; this.relations.some((relation) => relation.id === id); n += 1)
      id = `${base}_${n}`;
    this.relations.push({
      id,
      type,
      source,
      target,
      modality,
      ...(extra.order !== undefined ? { order: extra.order } : {}),
      ...(extra.evidence ? { evidenceSpan: extra.evidence } : {}),
    });
    return id;
  }

  private add(key: string, draft: Omit<Entity, 'id' | 'summary'>): string {
    const existing = this.byKey.get(key);
    if (existing) {
      if (draft.attributes && Object.keys(draft.attributes).length > 0) {
        existing.attributes = { ...existing.attributes, ...draft.attributes };
      }
      return existing.id;
    }
    const baseId = `e_${slug(draft.lemma)}`;
    let id = baseId;
    for (let n = 2; this.entities.some((entity) => entity.id === id); n += 1) id = `${baseId}_${n}`;
    const known = SUMMARY_BY_LEMMA[draft.lemma.toLowerCase()];
    const attributes = { ...draft.attributes, ...(known ? {} : { confidence: 'low' }) };
    const entity: Entity = {
      id,
      surface: draft.surface,
      lemma: draft.lemma,
      kind: draft.kind,
      span: draft.span,
      summary: known ?? genericSummary(draft),
      ...(Object.keys(attributes).length > 0 ? { attributes } : {}),
    };
    this.entities.push(entity);
    this.byKey.set(key, entity);
    return id;
  }
}

function genericSummary(draft: Omit<Entity, 'id' | 'summary'>): string {
  switch (draft.kind) {
    case 'action':
      return `To ${draft.lemma} is an action in your sentence.`;
    case 'direction':
      return `${capitalise(draft.lemma)} is a direction.`;
    case 'place':
      return `${draft.surface} is a place named in your sentence.`;
    case 'event':
      return 'An event described in your sentence.';
    default:
      return `“${capitalise(draft.surface)}” appears in your sentence; Opsis has no offline summary for it yet.`;
  }
}

type Groups = (Phrase | undefined)[];

/** Runs an anchored, case-insensitive pattern and returns each capture group with absolute offsets. */
function match(pattern: string, clause: Phrase): Groups | null {
  const result = new RegExp(`^${pattern}$`, 'iud').exec(clause.text);
  if (!result?.indices) return null;
  return result.map((text, index) => {
    const range = result.indices?.[index];
    return text === undefined || range === undefined
      ? undefined
      : { text, start: clause.start + range[0] };
  });
}

const spanOf = (from: Phrase, to: Phrase): [number, number] => [
  from.start,
  to.start + to.text.length,
];

type Rule = (clause: Phrase, builder: GraphBuilder) => boolean;

/** "An elephant is heavier than a mouse." */
const compareRule: Rule = (clause, builder) => {
  const groups = match(
    `${NP}\\s+(?:is|are|was|were)\\s+(not\\s+)?((?:more|less)\\s+[a-z]+|[a-z]+er)\\s+than\\s+${NP}`,
    clause,
  );
  const [, left, not, comparative, right] = groups ?? [];
  const a = left && nounPhrase(left);
  const b = right && nounPhrase(right);
  if (!a || !b || !comparative || !right || !left) return false;
  const source = builder.noun(a);
  const target = builder.noun(b);
  builder.annotate(source, { comparative: comparative.text.toLowerCase() });
  builder.relate('compares', source, target, modalityOf(undefined, not !== undefined), {
    evidence: spanOf(left, right),
  });
  return true;
};

/** "Nairobi is north of Mombasa." */
const directionOfRule: Rule = (clause, builder) => {
  const groups = match(
    `${NP}\\s+(?:is|are|lies|lie)\\s+(not\\s+)?(?:(?:located|situated)\\s+)?(?:to\\s+the\\s+|directly\\s+|due\\s+)?${DIR}\\s+of\\s+${NP}`,
    clause,
  );
  const [, left, not, direction, right] = groups ?? [];
  const a = left && nounPhrase(left);
  const b = right && nounPhrase(right);
  if (!a || !b || !direction || !left || !right) return false;
  const modality = modalityOf(undefined, not !== undefined);
  const source = builder.noun(a, 'place');
  const bearing = builder.noun(
    { surface: direction.text, start: direction.start, attributes: {}, negated: false },
    'direction',
  );
  const reference = builder.noun(b, 'place');
  builder.annotate(source, { bearing: direction.text.toLowerCase(), relativeTo: reference });
  builder.relate('direction', source, bearing, modality, { evidence: spanOf(left, direction) });
  builder.relate('located_at', source, reference, modality, { evidence: spanOf(left, right) });
  return true;
};

/** "The sun rises in the east." / "Nairobi is in the north." */
const motionDirectionRule: Rule = (clause, builder) => {
  const groups = match(
    `${NP}\\s+(?:${MODAL}\\s+)?([a-z]+)\\s+(?:in|to|towards|toward|into)\\s+(?:the\\s+)?${DIR}`,
    clause,
  );
  const [, subject, modal, verb, direction] = groups ?? [];
  const np = subject && nounPhrase(subject);
  if (!np || !verb || !direction || !subject) return false;
  const modality = modalityOf(modal?.text);
  const source = builder.noun(np);
  const target = builder.noun(
    { surface: direction.text, start: direction.start, attributes: {}, negated: false },
    'direction',
  );
  if (verbLemma(verb.text) === 'be') {
    builder.relate('direction', source, target, modality, { evidence: spanOf(subject, direction) });
    return true;
  }
  const action = builder.verb(verb);
  builder.relate(
    MOTION_VERBS.has(verbLemma(verb.text)) ? 'moves' : 'agent_of',
    source,
    action,
    modality,
    {
      evidence: spanOf(subject, verb),
    },
  );
  builder.relate('direction', action, target, modality, { evidence: spanOf(verb, direction) });
  return true;
};

/** Splits "bread, tomato, and ham" into item phrases with absolute offsets. */
function listItems(list: Phrase): Phrase[] {
  const items: Phrase[] = [];
  const separator = /\s*,\s*(?:and\s+|or\s+)?|\s+(?:and|or)\s+/giu;
  let last = 0;
  for (const found of list.text.matchAll(separator)) {
    items.push({ text: list.text.slice(last, found.index), start: list.start + last });
    last = found.index + found[0].length;
  }
  items.push({ text: list.text.slice(last), start: list.start + last });
  return items.filter((item) => item.text.trim() !== '');
}

/** "A sandwich can contain bread, tomato, ham." / "An atom has a nucleus and electrons." */
const containsRule: Rule = (clause, builder) => {
  const groups = match(
    `${NP}\\s+(?:${MODAL}\\s+)?(contains?|contained|has|have|had|includes?|included|holds?|(?:is|are)\\s+made\\s+(?:up\\s+)?of|consists?\\s+of)\\s+(.+)`,
    clause,
  );
  const [, whole, modal, verb, list] = groups ?? [];
  const np = whole && nounPhrase(whole);
  if (!np || !verb || !list || !whole) return false;
  const parts = listItems(list).map((item) => ({ item, np: nounPhrase(item) }));
  if (parts.length === 0 || parts.some((part) => part.np === null)) return false;
  const type: RelationType = /^(contain|hold)/iu.test(verb.text) ? 'contains' : 'has_part';
  const source = builder.noun(np);
  parts.forEach(({ item, np: partNp }, index) => {
    if (!partNp) return;
    const target = builder.noun(partNp);
    builder.relate(type, source, target, modalityOf(modal?.text, partNp.negated), {
      order: index + 1,
      evidence: spanOf(whole, { text: item.text.trimEnd(), start: item.start }),
    });
  });
  return true;
};

/** "Heat causes ice to melt." / "The ice melted because the sun came out." */
const causesRule: Rule = (clause, builder) => {
  const direct = match(
    `${NP}\\s+(?:${MODAL}\\s+)?(?:causes?|caused|leads?\\s+to|led\\s+to|results?\\s+in|resulted\\s+in|produces?|produced)\\s+${NP}`,
    clause,
  );
  if (direct) {
    const [, cause, modal, effect] = direct;
    const a = cause && nounPhrase(cause);
    const b = effect && nounPhrase(effect);
    if (a && b && cause && effect) {
      builder.relate('causes', builder.noun(a), builder.noun(b), modalityOf(modal?.text), {
        evidence: spanOf(cause, effect),
      });
      return true;
    }
  }
  const because = match(`(.+?),?\\s+because\\s+(?:of\\s+)?(.+)`, clause);
  const [, effect, cause] = because ?? [];
  if (!effect || !cause) return false;
  // Both sides of "because" are clauses, so they become events rather than objects.
  const effectId = builder.event(effect);
  builder.relate('causes', builder.event(cause), effectId, 'certain', {
    evidence: spanOf(effect, cause),
  });
  return true;
};

/** "The cat is on the mat." */
const locationRule: Rule = (clause, builder) => {
  const groups = match(
    `${NP}\\s+(?:is|are|was|were|lives?|sits?|stays?|grows?)\\s+(not\\s+)?(in|on|at|inside|under|above|below|near|within|beside|behind)\\s+${NP}`,
    clause,
  );
  const [, subject, not, preposition, place] = groups ?? [];
  const a = subject && nounPhrase(subject);
  const b = place && nounPhrase(place);
  if (!a || !b || !preposition || !subject || !place) return false;
  const source = builder.noun(a);
  builder.annotate(source, { preposition: preposition.text.toLowerCase() });
  builder.relate(
    'located_at',
    source,
    builder.noun(b, 'place'),
    modalityOf(undefined, not !== undefined),
    {
      evidence: spanOf(subject, place),
    },
  );
  return true;
};

/** "A cat is a mammal." / "The sky is blue." (property) / "A whale is not a fish." */
const isARule: Rule = (clause, builder) => {
  const groups = match(
    `${NP}\\s+(is|are|was|were)\\s+(not\\s+)?(an?\\s+kind\\s+of\\s+|an?\\s+type\\s+of\\s+|an?\\s+|the\\s+)?${NP}`,
    clause,
  );
  const [, subject, copula, not, article, category] = groups ?? [];
  const a = subject && nounPhrase(subject);
  const b = category && nounPhrase(category);
  if (!a || !b || !copula || !subject || !category) return false;
  const modality = modalityOf(undefined, not !== undefined);
  const source = builder.noun(a);
  const singular = /^(is|was)$/iu.test(copula.text);
  const isProperty =
    article === undefined &&
    singular &&
    !b.surface.includes(' ') &&
    KIND_BY_LEMMA[nounLemma(b.surface)] === undefined;
  if (isProperty) {
    const property = builder.noun(b, 'abstract_concept');
    builder.relate('property_of', property, source, modality, {
      evidence: spanOf(subject, category),
    });
  } else {
    builder.relate('is_a', source, builder.noun(b, 'abstract_concept'), modality, {
      evidence: spanOf(subject, category),
    });
  }
  return true;
};

/** "Some birds cannot fly." / "Fish swim." */
const abilityRule: Rule = (clause, builder) => {
  const groups = match(`${NP}\\s+(?:${MODAL}\\s+)?([a-z]+)`, clause);
  const [, subject, modal, verb] = groups ?? [];
  const np = subject && nounPhrase(subject);
  if (!np || !verb || !subject) return false;
  const lemma = verbLemma(verb.text);
  if (!modal && !ACTION_VERBS.has(lemma)) return false;
  if (lemma === 'be' || DETERMINERS.has(lemma)) return false;
  const type: RelationType = MOTION_VERBS.has(lemma) ? 'moves' : 'agent_of';
  builder.relate(type, builder.noun(np), builder.verb(verb), modalityOf(modal?.text, np.negated), {
    evidence: spanOf(subject, verb),
  });
  return true;
};

/** "The heart pumps blood to the lungs." / "The Earth orbits the Sun." */
const subjectVerbObjectRule: Rule = (clause, builder) => {
  // Scan for a known verb rather than trusting a lazy regex to pick the right word.
  for (const word of clause.text.matchAll(/[A-Za-z]+/gu)) {
    const lemma = verbLemma(word[0]);
    if (word.index === 0 || !ACTION_VERBS.has(lemma)) continue;
    const verb: Phrase = { text: word[0], start: clause.start + word.index };
    const before = match(`${NP}(?:\\s+${MODAL})?\\s*`, {
      text: clause.text.slice(0, word.index),
      start: clause.start,
    });
    const after = match(`\\s+${NP}(?:\\s+(?:to|into|through|towards|toward)\\s+${NP})?`, {
      text: clause.text.slice(word.index + word[0].length),
      start: verb.start + verb.text.length,
    });
    const [, subject, modal] = before ?? [];
    const [, object, destination] = after ?? [];
    const a = subject && nounPhrase(subject);
    const b = object && nounPhrase(object);
    const c = destination ? nounPhrase(destination) : null;
    if (!a || !b || !subject || !object || (destination && !c)) continue;
    const modality = modalityOf(modal?.text, b.negated);
    const agent = builder.noun(a);
    const action = builder.verb(verb);
    builder.relate(MOTION_VERBS.has(lemma) ? 'moves' : 'agent_of', agent, action, modality, {
      evidence: spanOf(subject, verb),
    });
    const objectId = builder.noun(b);
    builder.relate('acts_on', action, objectId, modality, { evidence: spanOf(verb, object) });
    if (c && destination) {
      builder.relate('moves', objectId, builder.noun(c, 'place'), modality, {
        evidence: spanOf(object, destination),
      });
    }
    return true;
  }
  return false;
};

/** "Ice melts into water when it gets warm." */
const transformsRule: Rule = (clause, builder) => {
  const groups = match(
    `${NP}\\s+(?:${MODAL}\\s+)?(melts?|melted|freezes?|froze|turns?|turned|changes?|changed|becomes?|became|evaporates?|condenses?)\\s+(?:into|to)\\s+${NP}(?:,?\\s+(?:when|if|as)\\s+(.+))?`,
    clause,
  );
  const [, before, modal, verb, after, condition] = groups ?? [];
  const a = before && nounPhrase(before);
  const b = after && nounPhrase(after);
  if (!a || !b || !verb || !before || !after) return false;
  const modality = modalityOf(modal?.text);
  const lemma = verbLemma(verb.text);
  const source = builder.noun(a);
  builder.annotate(source, { process: lemma });
  const target = builder.noun(b);
  builder.relate('transforms_into', source, target, modality, { evidence: spanOf(before, after) });
  // A named physical process ("melts") becomes its own node so the condition can point at it.
  const process = STATE_CHANGE_VERBS.has(lemma) ? builder.verb(verb) : undefined;
  if (process) {
    builder.relate('agent_of', source, process, modality, { evidence: spanOf(before, verb) });
  }
  if (condition) {
    const state = match(
      `(?:it|they|this|that)\\s+(?:gets?|got|becomes?|became|is|are|was|were|turns?|turned)\\s+(?:too\\s+|very\\s+)?([a-z]+)`,
      condition,
    )?.[1];
    const cause = state
      ? builder.noun(
          { surface: state.text, start: state.start, attributes: {}, negated: false },
          'abstract_concept',
        )
      : builder.event(condition);
    builder.relate('causes', cause, process ?? target, modality, {
      evidence: spanOf(verb, condition),
    });
  }
  return true;
};

/** Ingredients that supply energy rather than matter: they are used, never turned into products. */
const ENERGY_INPUTS = new Set(['sunlight', 'light', 'energy', 'heat', 'sun']);

/** "Plants use sunlight, water and carbon dioxide to make sugar and oxygen." */
const inputsOutputsRule: Rule = (clause, builder) => {
  const groups = match(
    `${NP}\\s+(?:${MODAL}\\s+)?(?:uses?|used|takes?\\s+in|took\\s+in|needs?|needed|combines?|combined)\\s+(.+?)\\s+(?:in\\s+order\\s+)?to\\s+(?:make|produce|create|form|build)\\s+(.+)`,
    clause,
  );
  const [, subject, modal, inputList, outputList] = groups ?? [];
  const agent = subject && nounPhrase(subject);
  if (!agent || !subject || !inputList || !outputList) return false;
  const inputs = listItems(inputList).map((item) => ({ item, np: nounPhrase(item) }));
  const outputs = listItems(outputList).map((item) => ({ item, np: nounPhrase(item) }));
  const all = [...inputs, ...outputs];
  if (inputs.length === 0 || outputs.length === 0 || all.some((entry) => entry.np === null)) {
    return false;
  }
  const modality = modalityOf(modal?.text);
  const agentId = builder.noun(agent);
  const materials: string[] = [];
  inputs.forEach(({ item, np }, index) => {
    if (!np) return;
    const id = builder.noun(np);
    builder.relate('acts_on', agentId, id, modality, {
      order: index + 1,
      evidence: spanOf(subject, { text: item.text.trimEnd(), start: item.start }),
    });
    if (!ENERGY_INPUTS.has(nounLemma(np.surface))) materials.push(id);
  });
  // Reactants → products: only matter-carrying inputs become outputs; energy is only used.
  outputs.forEach(({ item, np }) => {
    if (!np) return;
    const product = builder.noun(np);
    for (const material of materials) {
      builder.relate('transforms_into', material, product, modality, {
        evidence: spanOf(inputList, { text: item.text.trimEnd(), start: item.start }),
      });
    }
  });
  return true;
};

/**
 * Curated, textbook cycles the offline parser may close: when a step chain names these processes
 * the last state returns to the first (the water cycle). Nothing else is ever closed into a loop.
 */
const KNOWN_CYCLES: readonly { requires: readonly string[]; oneOf: readonly string[] }[] = [
  { requires: ['evaporate'], oneOf: ['fall', 'rain', 'precipitate'] },
];

/** "Water evaporates, forms clouds, and falls as rain." → a chain of state-change steps. */
const stateChainRule: Rule = (clause, builder) => {
  const groups = match(`${NP}\\s+(?:${MODAL}\\s+)?([a-z]+(?:\\s*,\\s*|\\s+and\\s+).+)`, clause);
  const [, subject, modal, rest] = groups ?? [];
  const np = subject && nounPhrase(subject);
  if (!np || !subject || !rest) return false;
  const steps = listItems(rest).map((item) => {
    const step = match(`([a-z]+)(?:\\s+(?:(?:as|into|to)\\s+)?${NP})?`, item);
    const verb = step?.[1];
    const object = step?.[2];
    return {
      verb,
      object: object ? nounPhrase(object) : undefined,
      valid: verb !== undefined && STATE_CHANGE_VERBS.has(verbLemma(verb.text)),
      hasObjectText: object !== undefined,
    };
  });
  if (steps.length < 2 || steps.some((step) => !step.valid || (step.hasObjectText && !step.object)))
    return false;
  if (!steps.some((step) => step.object)) return false;
  const modality = modalityOf(modal?.text);
  const chain = [builder.noun(np)];
  const lemmas = new Set<string>();
  for (const step of steps) {
    if (!step.verb) continue;
    lemmas.add(verbLemma(step.verb.text));
    if (step.object) {
      lemmas.add(nounLemma(step.object.surface));
      chain.push(builder.noun(step.object));
    } else {
      chain.push(builder.verb(step.verb));
    }
  }
  chain.slice(1).forEach((id, index) => {
    builder.relate('precedes', chain[index] ?? id, id, modality, { order: index + 1 });
  });
  const first = chain[0];
  const last = chain.at(-1);
  const closes = KNOWN_CYCLES.some(
    (cycle) =>
      cycle.requires.every((lemma) => lemmas.has(lemma)) &&
      cycle.oneOf.some((lemma) => lemmas.has(lemma)),
  );
  if (closes && first && last && first !== last) builder.relate('cycle', last, first, modality);
  return true;
};

const CLAUSE_RULES: readonly Rule[] = [
  compareRule,
  transformsRule,
  inputsOutputsRule,
  stateChainRule,
  directionOfRule,
  motionDirectionRule,
  containsRule,
  causesRule,
  locationRule,
  isARule,
  abilityRule,
  subjectVerbObjectRule,
];

const SEQUENCE_SEPARATOR =
  /(?:\s*,\s*|\s+)(?:and\s+)?(?:then|next|after\s+that|afterwards|finally)\b\s*,?\s*/giu;

/** "First you boil water, then add pasta, then drain it." → actions linked by `precedes`. */
function sequenceRule(sentence: Phrase, builder: GraphBuilder): boolean {
  const separators = [...sentence.text.matchAll(SEQUENCE_SEPARATOR)];
  if (separators.length === 0) return false;
  const steps: Phrase[] = [];
  let last = 0;
  for (const found of separators) {
    steps.push({ text: sentence.text.slice(last, found.index), start: sentence.start + last });
    last = found.index + found[0].length;
  }
  steps.push({ text: sentence.text.slice(last), start: sentence.start + last });

  const parsed = steps.map((step) => {
    const groups = match(
      `\\s*(?:(?:first(?:ly)?|to\\s+start|start\\s+by)\\s*,?\\s+)?(?:(?:you|we|i|they)\\s+(?:should\\s+|must\\s+|can\\s+)?)?([a-z]+)(?:\\s+(.+?))?\\s*`,
      step,
    );
    return groups ? { verb: groups[1], rest: groups[2] } : null;
  });
  if (parsed.length < 2 || parsed.some((step) => !step?.verb)) return false;

  let previousAction: string | undefined;
  let lastObject: string | undefined;
  parsed.forEach((step, index) => {
    if (!step?.verb) return;
    const action = builder.verb(step.verb, true, { step: index + 1 });
    if (step.rest) {
      const objectText =
        step.rest.text.split(/\s+(?:to|into|in|on|from|with|for|until)\s+/iu)[0] ?? '';
      const trimmed = objectText.trim().replace(/[.,;:!?]+$/u, '');
      if (PRONOUNS.has(trimmed.toLowerCase()) && lastObject) {
        builder.relate('acts_on', action, lastObject, 'certain');
      } else {
        const np = nounPhrase({ text: objectText, start: step.rest.start });
        if (np) {
          lastObject = builder.noun(np);
          builder.relate('acts_on', action, lastObject, modalityOf(undefined, np.negated), {
            evidence: spanOf(step.verb, { text: np.surface, start: np.start }),
          });
        }
      }
    }
    if (previousAction)
      builder.relate('precedes', previousAction, action, 'certain', { order: index });
    previousAction = action;
  });
  return true;
}

/** Splits text into sentences (on . ! ? ;) keeping absolute offsets. */
function sentencesOf(utterance: string): Phrase[] {
  const sentences: Phrase[] = [];
  const pattern = /[^.!?;]+/gu;
  for (const found of utterance.matchAll(pattern)) {
    const text = found[0].trimEnd();
    const leading = text.length - text.trimStart().length;
    if (text.trim() !== '') sentences.push({ text: text.trim(), start: found.index + leading });
  }
  return sentences;
}

/** Splits a sentence into clauses joined by ", and" / ", but" / "while". */
function clausesOf(sentence: Phrase): Phrase[] {
  const clauses: Phrase[] = [];
  let last = 0;
  for (const found of sentence.text.matchAll(
    /\s*,\s*(?:and|but|while)\s+|\s+(?:but|while)\s+/giu,
  )) {
    clauses.push({ text: sentence.text.slice(last, found.index), start: sentence.start + last });
    last = found.index + found[0].length;
  }
  clauses.push({ text: sentence.text.slice(last), start: sentence.start + last });
  return clauses.map((clause) => ({ ...clause, text: clause.text.replace(/[,:]+$/u, '').trim() }));
}

function applyRules(clause: Phrase, builder: GraphBuilder): boolean {
  return CLAUSE_RULES.some((rule) => rule(clause, builder));
}

/** Result of the deterministic parser: the graph plus the clauses it could not interpret. */
export type RuleParse = { sg: SemanticGraph; unmatched: string[] };

/**
 * Deterministic, offline Utterance → SG parser for simple patterns (PROMPT.md §7.3). Unknown input
 * yields a single low-confidence card entity with an `ambiguity` note rather than an error.
 */
export function ruleBasedParse(utterance: string): RuleParse {
  const builder = new GraphBuilder(utterance);
  const unmatched: string[] = [];
  for (const sentence of sentencesOf(utterance)) {
    if (sequenceRule(sentence, builder) || applyRules(sentence, builder)) continue;
    for (const clause of clausesOf(sentence)) {
      if (!applyRules(clause, builder)) unmatched.push(clause.text);
    }
  }

  const notes: PedagogyNote[] = [];
  if (builder.entities.length === 0) {
    const id = 'e_statement';
    builder.entities.push({
      id,
      surface: utterance,
      lemma: utterance.toLowerCase(),
      kind: 'abstract_concept',
      span: [0, utterance.length],
      attributes: { confidence: 'low' },
      summary:
        'Opsis could not confidently understand this sentence, so it is shown as a simple card.',
    });
    notes.push({
      targetId: id,
      kind: 'ambiguity',
      text: "Opsis couldn't match this sentence to a pattern it knows. Try a simple sentence like 'A sandwich contains bread and ham.'",
    });
  } else if (unmatched.length > 0 && builder.entities[0]) {
    notes.push({
      targetId: builder.entities[0].id,
      kind: 'ambiguity',
      text: `Opsis could not understand part of this sentence: "${unmatched.join('", "')}".`,
    });
  }

  const sg: SemanticGraph = {
    schemaVersion: 'sg/1',
    utterance,
    language: 'en',
    entities: builder.entities,
    relations: builder.relations,
    ...(notes.length > 0 ? { notes } : {}),
  };
  return { sg: attachKnownNotes(sg), unmatched };
}
