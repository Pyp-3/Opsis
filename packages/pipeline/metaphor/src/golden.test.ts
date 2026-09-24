import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SemanticGraphSchema, visualPlanSchemaFor, type SemanticGraph } from '@opsis/schema';
import { selectMetaphor, selectMetaphorOffline } from './select';

const FIXTURES = new URL('../fixtures/', import.meta.url);
const GOLDEN = new URL('../../../../fixtures/golden/', import.meta.url);

/** Golden SGs frozen from the parser (case 3 hand-authored: the offline rules cannot parse it). */
function loadSg(name: string): SemanticGraph {
  return SemanticGraphSchema.parse(
    JSON.parse(readFileSync(new URL(`${name}.sg.json`, FIXTURES), 'utf8')),
  );
}

function expectedMetaphors(name: string): string[] {
  const golden = JSON.parse(readFileSync(new URL(`${name}.json`, GOLDEN), 'utf8')) as {
    utterance: string;
    expectations: { expectedMetaphors: string[] };
  };
  return golden.expectations.expectedMetaphors;
}

const CASES = readdirSync(FIXTURES)
  .filter((f) => f.endsWith('.sg.json'))
  .map((f) => f.replace(/\.sg\.json$/, ''))
  .sort();

describe('golden SG fixtures → metaphor (PROMPT.md §14.2)', () => {
  it('covers cases 1, 2, 3, 4, 5, 9, 10 and 13', () => {
    expect(CASES.map((c) => Number(c.slice(0, 2)))).toEqual([1, 2, 3, 4, 5, 9, 10, 13]);
  });

  it.each(CASES)('%s matches the golden utterance and expected metaphor', (name) => {
    const sg = loadSg(name);
    const golden = JSON.parse(readFileSync(new URL(`${name}.json`, GOLDEN), 'utf8')) as {
      utterance: string;
    };
    expect(sg.utterance).toBe(golden.utterance);
    const { plan } = selectMetaphorOffline(sg);
    expect(expectedMetaphors(name)).toContain(plan.scenes[0]?.metaphor);
    expect(visualPlanSchemaFor(sg).safeParse(plan).success).toBe(true);
  });

  it.each(CASES)('%s is deterministic and snapshot-stable', async (name) => {
    const sg = loadSg(name);
    const first = selectMetaphorOffline(sg);
    const second = selectMetaphorOffline(structuredClone(sg));
    const viaAsync = await selectMetaphor(sg);
    expect(second).toEqual(first);
    expect(viaAsync).toEqual(first);
    expect(first.plan).toMatchSnapshot();
  });

  it('sun-east: sun rises toward the E bearing of the compass', () => {
    const [scene] = selectMetaphorOffline(loadSg('01-sun-east')).plan.scenes;
    expect(scene?.nodes.find((n) => n.role === 'anchor')?.primitive).toBe('compass');
    expect(scene?.edges.some((e) => e.from === 'v_compass' && e.to === 'e_east')).toBe(true);
  });

  it('sandwich: three optional, explodable, drillable parts', () => {
    const parts = selectMetaphorOffline(loadSg('02-sandwich-parts')).plan.scenes[0]?.nodes.filter(
      (n) => n.role === 'part',
    );
    expect(parts?.map((n) => n.id)).toEqual(['e_bread', 'e_tomato', 'e_ham']);
    expect(parts?.every((n) => n.optional && n.explodable && n.drillable)).toBe(true);
  });

  it('atom: nucleus and electrons are parts of the container', () => {
    const { plan } = selectMetaphorOffline(loadSg('09-atom-parts'));
    expect(plan.anchor).toBe('e_atom');
    expect(plan.scenes[0]?.nodes.filter((n) => n.role === 'part').map((n) => n.id)).toEqual([
      'e_nucleus',
      'e_electron',
    ]);
  });

  it('every plan carries the SG hash as sgRef', async () => {
    const { createSgRef } = await import('@opsis/schema');
    for (const name of CASES) {
      const sg = loadSg(name);
      expect(selectMetaphorOffline(sg).plan.sgRef).toBe(createSgRef(sg));
    }
  });
});
