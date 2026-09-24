import type { Audience } from '@opsis/parse';

/**
 * A curated misconception from docs/PEDAGOGY.md. `id` matches the `### P-0xx` heading there; a
 * test keeps the two in sync. Text is reviewed wording, so the offline fallback may quote it.
 */
export type Misconception = {
  id: string;
  /** Lemmas that trigger the note when the explained node carries one of them. */
  lemmas: readonly string[];
  child: string;
  /** Wording for teen and adult readers. */
  general: string;
};

export const MISCONCEPTIONS: readonly Misconception[] = [
  {
    id: 'P-001',
    lemmas: ['rise', 'set', 'sunrise', 'sunset'],
    child: 'The Sun does not really climb up. Earth spins, so the Sun looks like it rises.',
    general:
      'The Sun only appears to rise: Earth rotates from west to east, turning our horizon towards it.',
  },
  {
    id: 'P-002',
    lemmas: ['orbit', 'revolve'],
    child: 'Earth travels around the Sun. The Sun does not go around Earth.',
    general: 'Earth orbits the Sun; the Sun crossing our sky each day is caused by Earth rotating.',
  },
  {
    id: 'P-003',
    lemmas: ['whale', 'dolphin'],
    child: 'Whales and dolphins live in water, but they are mammals, not fish. They breathe air.',
    general:
      'Whales and dolphins are mammals, not fish: they breathe air with lungs and feed their young milk.',
  },
  {
    id: 'P-004',
    lemmas: ['bat'],
    child: 'Bats can fly, but they are mammals, not birds. They have fur.',
    general: 'Bats fly but are mammals, not birds: they have fur and feed their young milk.',
  },
  {
    id: 'P-005',
    lemmas: ['spider'],
    child: 'Spiders are not insects. They have eight legs, and insects have six.',
    general: 'Spiders are arachnids, not insects: they have eight legs and two body parts.',
  },
  {
    id: 'P-006',
    lemmas: ['tomato'],
    child:
      'Cooks call a tomato a vegetable, but it is a fruit: it grows from a flower and holds seeds.',
    general:
      'Botanically a tomato is a fruit (it develops from the flower and holds seeds), though cooks treat it as a vegetable.',
  },
  {
    id: 'P-007',
    lemmas: ['bird', 'fly'],
    child: 'Most birds can fly, but some, like penguins and ostriches, cannot.',
    general: 'Most birds fly, but flightless birds such as penguins, ostriches and kiwis do not.',
  },
  {
    id: 'P-008',
    lemmas: ['cloud'],
    child: 'Clouds are not steam. They are made of tiny drops of water or bits of ice.',
    general:
      'Clouds are not water vapour, which is invisible; they are tiny liquid droplets or ice crystals.',
  },
  {
    id: 'P-009',
    lemmas: ['plant', 'photosynthesis'],
    child: 'Plants do not eat soil. They make their own food from air, water and sunlight.',
    general:
      'Plants do not get their food from soil: most of their mass comes from carbon dioxide in the air.',
  },
  {
    id: 'P-010',
    lemmas: ['blood', 'vein'],
    child: 'Blood is never blue. It is dark red when it has less oxygen.',
    general:
      'Blood is always red; oxygen-poor blood is darker red, and veins only look blue through skin.',
  },
  {
    id: 'P-011',
    lemmas: ['electron', 'atom'],
    child: 'Electrons do not circle the middle of an atom like tiny planets.',
    general:
      'Electrons do not follow planet-like orbits; they occupy fuzzy regions called orbitals around the nucleus.',
  },
  {
    id: 'P-012',
    lemmas: ['melt', 'ice'],
    child: 'Melting ice turns into water. Nothing disappears; the water only changes form.',
    general:
      'Melting is a change of state, not dissolving: ice stays at 0 °C while it melts, as the heat loosens bonds between molecules.',
  },
];

/** Returns the first curated misconception for a lemma, worded for the audience. */
export function misconceptionFor(lemma: string, audience: Audience): string | undefined {
  const key = lemma.toLowerCase();
  const entry = MISCONCEPTIONS.find((item) => item.lemmas.includes(key));
  if (!entry) return undefined;
  return audience === 'child' ? entry.child : entry.general;
}

/**
 * Curated, textbook-level parts used to suggest and build drill-downs offline. Only well-known
 * structure belongs here; anything else must come from the LLM or the user's own sentence.
 */
export const KNOWN_PARTS: Readonly<Record<string, readonly string[]>> = {
  tomato: ['skin', 'flesh', 'seeds'],
  apple: ['skin', 'flesh', 'core', 'seeds'],
  egg: ['shell', 'white', 'yolk'],
  bread: ['crust', 'crumb'],
  sandwich: ['bread', 'filling'],
  atom: ['nucleus', 'electrons'],
  nucleus: ['protons', 'neutrons'],
  cell: ['membrane', 'cytoplasm', 'nucleus'],
  plant: ['roots', 'stem', 'leaves', 'flowers'],
  tree: ['roots', 'trunk', 'branches', 'leaves'],
  flower: ['petals', 'sepals', 'stamens', 'pistil'],
  leaf: ['blade', 'veins', 'stalk'],
  heart: ['atria', 'ventricles', 'valves'],
  earth: ['crust', 'mantle', 'core'],
  sun: ['core', 'photosphere', 'corona'],
  bicycle: ['wheels', 'frame', 'pedals', 'chain'],
};
