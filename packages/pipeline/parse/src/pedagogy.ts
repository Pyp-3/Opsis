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
        (relation.type === 'agent_of' || relation.type === 'moves') &&
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

const hasLemma = (graph: SemanticGraph, lemma: string) =>
  graph.entities.some((entity) => entity.lemma.toLowerCase() === lemma);

const entityNote =
  (lemma: string, requires: string, kind: PedagogyNote['kind'], text: string): NoteRule =>
  (graph) =>
    hasLemma(graph, requires)
      ? graph.entities
          .filter((entity) => entity.lemma.toLowerCase() === lemma)
          .map((entity) => ({ targetId: entity.id, kind, text }))
      : [];

/** P-008: clouds form from vapour but are liquid droplets or ice, not vapour. */
const cloudsAreDroplets = entityNote(
  'cloud',
  'evaporate',
  'nuance',
  'Water vapour is an invisible gas. It cools and condenses into the tiny droplets that make a cloud.',
);

/** P-009: a plant's mass comes mostly from carbon dioxide, not from soil. */
const plantMassFromAir = entityNote(
  'carbon dioxide',
  'plant',
  'misconception',
  "Plants do not eat soil: most of a plant's mass comes from carbon dioxide taken in from the air.",
);

/** P-012: melting is a change of state; nothing disappears. */
const meltingKeepsWater = entityNote(
  'melt',
  'ice',
  'misconception',
  'Melting ice does not disappear: the same water changes from solid to liquid.',
);

const RULES: readonly NoteRule[] = [
  cloudsAreDroplets,
  plantMassFromAir,
  meltingKeepsWater,
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
