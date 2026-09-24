import type { PedagogyNote, SemanticGraph } from '@opsis/schema';

type NoteRule = (graph: SemanticGraph) => PedagogyNote[];

const lemmaOf = (graph: SemanticGraph, id: string) =>
  graph.entities.find((entity) => entity.id === id)?.lemma.toLowerCase();

/** "The sun rises/sets": the Sun only appears to move because Earth rotates. */
const sunApparentMotion: NoteRule = (graph) =>
  graph.relations
    .filter(
      (relation) =>
        relation.type === 'moves' &&
        lemmaOf(graph, relation.source) === 'sun' &&
        ['rise', 'set'].includes(lemmaOf(graph, relation.target) ?? ''),
    )
    .map((relation) => ({
      targetId: relation.target,
      kind: 'misconception' as const,
      text: `The Sun only appears to ${lemmaOf(graph, relation.target)} because Earth rotates from west to east.`,
    }));

/** "The sun orbits the earth": geocentric misconception. */
const sunOrbitsEarth: NoteRule = (graph) =>
  graph.relations
    .filter(
      (relation) =>
        relation.type === 'agent_of' &&
        lemmaOf(graph, relation.source) === 'sun' &&
        ['orbit', 'circle', 'revolve'].includes(lemmaOf(graph, relation.target) ?? ''),
    )
    .map((relation) => ({
      targetId: relation.target,
      kind: 'misconception' as const,
      text: 'Earth orbits the Sun, not the other way round; the Sun only appears to cross our sky.',
    }));

const CLASSIFICATION_MYTHS: Record<string, string> = {
  'whale>fish':
    'Whales live in water but are mammals, not fish: they breathe air and feed their young milk.',
  'dolphin>fish': 'Dolphins live in water but are mammals, not fish: they breathe air.',
  'bat>bird': 'Bats can fly but are mammals, not birds: they have fur and feed their young milk.',
  'spider>insect': 'Spiders are arachnids, not insects: they have eight legs, not six.',
  'tomato>vegetable':
    'Botanically a tomato is a fruit, though cooks often treat it as a vegetable.',
};

/** Common is-a mix-ups such as "a whale is a fish". */
const classificationMyths: NoteRule = (graph) =>
  graph.relations.flatMap((relation) => {
    if (relation.type !== 'is_a' || relation.modality === 'negated') return [];
    const text =
      CLASSIFICATION_MYTHS[`${lemmaOf(graph, relation.source)}>${lemmaOf(graph, relation.target)}`];
    return text ? [{ targetId: relation.id, kind: 'misconception' as const, text }] : [];
  });

/** "Birds cannot fly" (or "some birds…"): most birds can. */
const flightlessBirds: NoteRule = (graph) =>
  graph.relations
    .filter(
      (relation) =>
        relation.modality === 'negated' &&
        lemmaOf(graph, relation.source) === 'bird' &&
        lemmaOf(graph, relation.target) === 'fly',
    )
    .map((relation) => ({
      targetId: relation.id,
      kind: 'nuance' as const,
      text: 'Most birds can fly, but some, such as penguins, ostriches and kiwis, cannot.',
    }));

const RULES: readonly NoteRule[] = [
  sunApparentMotion,
  sunOrbitsEarth,
  classificationMyths,
  flightlessBirds,
];

/**
 * Adds known pedagogy notes (PROMPT.md §2.1, §12.1) the graph does not already carry. A note is
 * considered present when one of the same kind already targets the same id.
 */
export function attachKnownNotes(graph: SemanticGraph): SemanticGraph {
  const existing = graph.notes ?? [];
  const present = new Set(existing.map((note) => `${note.targetId}|${note.kind}`));
  const added = RULES.flatMap((rule) => rule(graph)).filter((note) => {
    const key = `${note.targetId}|${note.kind}`;
    if (present.has(key)) return false;
    present.add(key);
    return true;
  });
  if (added.length === 0) return graph;
  return { ...graph, notes: [...existing, ...added] };
}
