import { readFileSync, readdirSync } from 'node:fs';
import { SemanticGraphSchema, type SemanticGraph } from '@opsis/schema';
import { describe, expect, it } from 'vitest';
import { modalityOf, ruleBasedParse } from './fallback';
import { parseUtterance } from './parse';

type Golden = {
  utterance: string;
  expectations: {
    requiredEntityLemmas: string[];
    requiredRelations: { type: string; modality: string; minimumCount?: number }[];
    requiredPedagogyNoteKinds: string[];
  };
};

const goldenDir = new URL('../../../../fixtures/golden/', import.meta.url);
const golden = new Map(
  readdirSync(goldenDir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => [
      Number(file.slice(0, 2)),
      JSON.parse(readFileSync(new URL(file, goldenDir), 'utf8')) as Golden,
    ]),
);

/** Checks the SG-level (stage 1) part of a golden case's structural expectations. */
function sgFailures(sg: SemanticGraph, expectations: Golden['expectations']): string[] {
  const failures: string[] = [];
  const lemmas = new Set(sg.entities.map((entity) => entity.lemma.toLowerCase()));
  for (const lemma of expectations.requiredEntityLemmas) {
    if (!lemmas.has(lemma.toLowerCase())) failures.push(`missing lemma ${lemma}`);
  }
  for (const required of expectations.requiredRelations) {
    const count = sg.relations.filter(
      (relation) => relation.type === required.type && relation.modality === required.modality,
    ).length;
    if (count < (required.minimumCount ?? 1))
      failures.push(`missing ${required.type}/${required.modality}`);
  }
  const noteKinds = new Set(sg.notes?.map((note) => note.kind));
  for (const kind of expectations.requiredPedagogyNoteKinds) {
    if (!noteKinds.has(kind as never)) failures.push(`missing note ${kind}`);
  }
  return failures;
}

describe('offline rule-based fallback on golden cases', () => {
  it.each([1, 2, 4, 5, 8, 10, 14, 15])('golden case %i yields a schema-valid SG', async (id) => {
    const testCase = golden.get(id);
    if (!testCase) throw new Error(`golden case ${id} missing`);
    const result = await parseUtterance(testCase.utterance);
    expect(result.source).toBe('rule_fallback');
    expect(result.flagged).toBe(true);
    expect(result.fallbackReason).toBe('no_llm_client');
    expect(SemanticGraphSchema.safeParse(result.sg).success).toBe(true);
    expect(sgFailures(result.sg, testCase.expectations)).toEqual([]);
    expect(result.sg).toMatchSnapshot();
  });

  it('is deterministic', () => {
    for (const testCase of golden.values()) {
      expect(ruleBasedParse(testCase.utterance)).toEqual(ruleBasedParse(testCase.utterance));
    }
  });

  it('never produces an invalid SG for any golden utterance', () => {
    for (const testCase of golden.values()) {
      expect(SemanticGraphSchema.safeParse(ruleBasedParse(testCase.utterance).sg).success).toBe(
        true,
      );
    }
  });

  it('keeps spans pointing at the written words', () => {
    for (const testCase of golden.values()) {
      const { sg } = ruleBasedParse(testCase.utterance);
      for (const entity of sg.entities) {
        expect(sg.utterance.slice(...entity.span)).toBe(entity.surface);
      }
    }
  });
});

const relationsOf = (utterance: string) =>
  ruleBasedParse(utterance).sg.relations.map((relation) => `${relation.type}/${relation.modality}`);

describe('rule patterns', () => {
  it('maps modal words to modality', () => {
    expect(modalityOf(undefined)).toBe('certain');
    expect(modalityOf('can')).toBe('possible');
    expect(modalityOf('sometimes')).toBe('possible');
    expect(modalityOf('usually')).toBe('typical');
    expect(modalityOf('cannot')).toBe('negated');
    expect(modalityOf("can't")).toBe('negated');
    expect(modalityOf('never')).toBe('negated');
    expect(modalityOf('does not')).toBe('negated');
    expect(modalityOf('always')).toBe('certain');
    expect(modalityOf('can', true)).toBe('negated');
  });

  it('X contains/has A, B and C, keeping written order', () => {
    const { sg } = ruleBasedParse('A bicycle has two wheels, a frame, pedals and a chain.');
    expect(
      sg.relations.map((relation) => [relation.type, relation.target, relation.order]),
    ).toEqual([
      ['has_part', 'e_wheel', 1],
      ['has_part', 'e_frame', 2],
      ['has_part', 'e_pedal', 3],
      ['has_part', 'e_chain', 4],
    ]);
    expect(sg.entities.find((entity) => entity.id === 'e_wheel')?.attributes?.count).toBe(2);
    expect(relationsOf('A pizza contains cheese, and tomato.')).toEqual([
      'contains/certain',
      'contains/certain',
    ]);
  });

  it("'can' makes parts possible; 'never' and 'does not' negate them", () => {
    expect(relationsOf('A salad can contain egg and tuna.')).toEqual([
      'contains/possible',
      'contains/possible',
    ]);
    expect(relationsOf('A sandwich never contains glass.')).toEqual(['contains/negated']);
    expect(relationsOf('A sandwich does not contain glass.')).toEqual(['contains/negated']);
  });

  it('X is in Y and X is <direction> of Y', () => {
    expect(relationsOf('The cat is in the box.')).toEqual(['located_at/certain']);
    expect(relationsOf('Kisumu is west of Nairobi.')).toEqual([
      'direction/certain',
      'located_at/certain',
    ]);
    expect(relationsOf('Mombasa is not north of Nairobi.')).toEqual([
      'direction/negated',
      'located_at/negated',
    ]);
  });

  it('motion towards a direction', () => {
    const { sg } = ruleBasedParse('The sun sets in the west.');
    expect(sg.relations.map((relation) => relation.type)).toEqual(['moves', 'direction']);
    expect(sg.entities.find((entity) => entity.lemma === 'west')?.kind).toBe('direction');
  });

  it('X causes Y and Y because X', () => {
    const direct = ruleBasedParse('Friction causes heat.').sg;
    expect(direct.relations).toMatchObject([
      { type: 'causes', source: 'e_friction', target: 'e_heat', modality: 'certain' },
    ]);
    const because = ruleBasedParse('The road is wet because it rained.').sg;
    expect(because.relations[0]).toMatchObject({ type: 'causes', modality: 'certain' });
    expect(because.entities.map((entity) => entity.kind)).toEqual(['event', 'event']);
  });

  it('X is a Y, including negation and properties', () => {
    expect(relationsOf('A whale is not a fish.')).toEqual(['is_a/negated']);
    expect(relationsOf('Cats are mammals.')).toEqual(['is_a/certain']);
    expect(relationsOf('The sky is blue.')).toEqual(['property_of/certain']);
  });

  it('first/then sequences link steps with precedes and ordered steps', () => {
    const { sg } = ruleBasedParse('First you boil water, then add pasta, then drain it.');
    const precedes = sg.relations.filter((relation) => relation.type === 'precedes');
    expect(precedes.map((relation) => [relation.source, relation.target, relation.order])).toEqual([
      ['e_boil', 'e_add', 1],
      ['e_add', 'e_drain', 2],
    ]);
    // "it" resolves to the previous object rather than becoming an entity.
    expect(sg.relations).toContainEqual(
      expect.objectContaining({ type: 'acts_on', source: 'e_drain', target: 'e_pasta' }),
    );
    expect(sg.entities.some((entity) => entity.lemma === 'it')).toBe(false);
  });

  it('X is heavier than Y', () => {
    const { sg } = ruleBasedParse('An elephant is heavier than a mouse.');
    expect(sg.relations).toMatchObject([
      { type: 'compares', source: 'e_elephant', target: 'e_mouse' },
    ]);
    expect(sg.entities[0]?.attributes?.comparative).toBe('heavier');
    expect(relationsOf('Lead is more dense than water.')).toEqual(['compares/certain']);
  });

  it("'cannot' and 'never' negate abilities", () => {
    expect(relationsOf('Some birds cannot fly.')).toEqual(['moves/negated']);
    expect(relationsOf('Penguins never fly.')).toEqual(['moves/negated']);
    expect(relationsOf('Fish can swim.')).toEqual(['moves/possible']);
  });

  it('subject-verb-object with a destination and transformations', () => {
    expect(relationsOf('The heart pumps blood to the lungs.')).toEqual([
      'agent_of/certain',
      'acts_on/certain',
      'moves/certain',
    ]);
    expect(relationsOf('Ice melts into water when it gets warm.')).toEqual([
      'transforms_into/certain',
      'agent_of/certain',
      'causes/certain',
    ]);
    const melt = ruleBasedParse('Ice melts into water when it gets warm.').sg;
    expect(melt.entities.map((entity) => entity.lemma)).toEqual(['ice', 'water', 'melt', 'warm']);
    expect(melt.relations.find((relation) => relation.type === 'causes')).toMatchObject({
      source: 'e_warm',
      target: 'e_melt',
    });
    expect(melt.notes).toContainEqual(
      expect.objectContaining({ kind: 'misconception', targetId: 'e_melt' }),
    );
  });

  it('draws motion verbs in "X orbits Y" as moves', () => {
    expect(relationsOf('The Earth orbits the Sun.')).toEqual(['moves/certain', 'acts_on/certain']);
    const geocentric = ruleBasedParse('The sun orbits the earth.').sg;
    expect(geocentric.notes).toContainEqual(
      expect.objectContaining({ kind: 'misconception', targetId: 'e_orbit' }),
    );
  });

  it('chains state changes and closes only curated cycles', () => {
    const { sg } = ruleBasedParse('Water evaporates, forms clouds, and falls as rain.');
    expect(sg.entities.map((entity) => entity.id)).toEqual([
      'e_water',
      'e_evaporate',
      'e_cloud',
      'e_rain',
    ]);
    expect(sg.relations.map((r) => `${r.type}:${r.source}>${r.target}`)).toEqual([
      'precedes:e_water>e_evaporate',
      'precedes:e_evaporate>e_cloud',
      'precedes:e_cloud>e_rain',
      'cycle:e_rain>e_water',
    ]);
    expect(sg.notes).toContainEqual(
      expect.objectContaining({ kind: 'nuance', targetId: 'e_cloud' }),
    );
    const open = ruleBasedParse('Water cools, forms ice, and melts.').sg;
    expect(open.relations.some((relation) => relation.type === 'cycle')).toBe(false);
    expect(ruleBasedParse('Birds fly and swim.').unmatched).toEqual(['Birds fly and swim']);
  });

  it('maps inputs to outputs without turning energy into matter', () => {
    const { sg } = ruleBasedParse(
      'Plants use sunlight, water and carbon dioxide to make sugar and oxygen.',
    );
    const edges = sg.relations.map((r) => `${r.type}:${r.source}>${r.target}`);
    expect(edges.filter((edge) => edge.startsWith('acts_on'))).toEqual([
      'acts_on:e_plant>e_sunlight',
      'acts_on:e_plant>e_water',
      'acts_on:e_plant>e_carbon_dioxide',
    ]);
    expect(edges.filter((edge) => edge.includes('e_sunlight>'))).toEqual([]);
    expect(edges).toContain('transforms_into:e_carbon_dioxide>e_sugar');
    expect(sg.entities.every((entity) => entity.attributes?.confidence === undefined)).toBe(true);
    expect(sg.notes).toContainEqual(
      expect.objectContaining({ kind: 'misconception', targetId: 'e_carbon_dioxide' }),
    );
  });

  it('splits clauses joined by ", and" and reuses shared entities', () => {
    const { sg } = ruleBasedParse('A cat is a mammal, and a mammal is an animal.');
    expect(sg.entities.map((entity) => entity.id)).toEqual(['e_cat', 'e_mammal', 'e_animal']);
  });

  it('flags partly understood sentences with an ambiguity note', () => {
    const { sg, unmatched } = ruleBasedParse('A cat is a mammal, and zorp blick fnah.');
    expect(unmatched).toEqual(['zorp blick fnah']);
    expect(sg.notes).toContainEqual(
      expect.objectContaining({ kind: 'ambiguity', targetId: 'e_cat' }),
    );
  });

  it('marks entities without a curated summary as low confidence', () => {
    const { sg } = ruleBasedParse('A zebra has stripes.');
    expect(sg.entities.every((entity) => entity.attributes?.confidence === 'low')).toBe(true);
    const sun = ruleBasedParse('The sun rises in the east.').sg.entities[0];
    expect(sun?.attributes?.confidence).toBeUndefined();
    expect(sun?.summary).toBe('The Sun is the star at the centre of our solar system.');
  });
});

describe('known pedagogy notes', () => {
  it('attaches the sun-rising misconception to the rising action', () => {
    const { sg } = ruleBasedParse('The sun rises in the east.');
    expect(sg.notes).toEqual([
      {
        targetId: 'e_rise',
        kind: 'misconception',
        text: 'The Sun only appears to rise because Earth rotates from west to east.',
      },
    ]);
  });

  it('covers sunset, geocentrism, classification myths and flightless birds', () => {
    const kinds = (utterance: string) =>
      ruleBasedParse(utterance).sg.notes?.map((note) => note.kind);
    expect(kinds('The sun sets in the west.')).toEqual(['misconception']);
    expect(kinds('The sun orbits the earth.')).toEqual(['misconception']);
    expect(kinds('A whale is a fish.')).toEqual(['misconception']);
    expect(kinds('A whale is not a fish.')).toBeUndefined();
    expect(kinds('Some birds cannot fly.')).toEqual(['nuance']);
    expect(kinds('The Earth orbits the Sun.')).toBeUndefined();
  });
});
