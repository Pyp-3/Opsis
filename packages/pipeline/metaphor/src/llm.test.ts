import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MockLLMClient } from '@opsis/parse';
import { visualPlanSchemaFor, type SemanticGraph } from '@opsis/schema';
import { askLLM, buildPrimitiveRequest, PRIMITIVE_PROMPT_ID } from './llm';
import { selectMetaphor } from './select';

const fixture = (name: string) =>
  JSON.parse(
    readFileSync(new URL(`../fixtures/${name}.sg.json`, import.meta.url), 'utf8'),
  ) as SemanticGraph;

/** Two equal-degree entities, one known (sun) and one unknown (glorp). */
function tiedGraph(): SemanticGraph {
  return {
    schemaVersion: 'sg/1',
    utterance: 'The sun warms the glorp.',
    language: 'en',
    entities: [
      {
        id: 'e_sun',
        surface: 'sun',
        lemma: 'sun',
        kind: 'celestial_body',
        span: [4, 7],
        summary: 'The Sun is a star.',
      },
      {
        id: 'e_glorp',
        surface: 'glorp',
        lemma: 'glorp',
        kind: 'object',
        span: [18, 23],
        summary: 'A glorp.',
      },
    ],
    relations: [
      { id: 'r_1', type: 'causes', source: 'e_sun', target: 'e_glorp', modality: 'certain' },
    ],
  };
}

describe('LLM consultation', () => {
  it('is not called when rules settle everything', async () => {
    const llm = new MockLLMClient([]);
    const graph = fixture('01-sun-east');
    graph.entities = graph.entities.filter((e) => e.id !== 'e_rise');
    graph.relations = graph.relations.filter((r) => r.type === 'direction');
    graph.relations[0]!.source = 'e_sun';
    graph.notes = [];
    const result = await selectMetaphor(graph, { llm });
    expect(llm.calls).toHaveLength(0);
    expect(result.llm.consulted).toBe(false);
  });

  it('asks only about unknown entities and anchor ties, and applies valid answers', async () => {
    const llm = new MockLLMClient([
      JSON.stringify({ primitives: { e_glorp: 'mountain' }, anchor: 'e_glorp' }),
    ]);
    const graph = tiedGraph();
    const result = await selectMetaphor(graph, { llm });
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0]?.promptId).toBe(PRIMITIVE_PROMPT_ID);
    expect(JSON.parse(llm.calls[0]?.user ?? '{}')).toEqual({
      utterance: 'The sun warms the glorp.',
      entities: [{ id: 'e_glorp', lemma: 'glorp', kind: 'object' }],
      anchorCandidates: ['e_sun', 'e_glorp'],
    });
    expect(result.plan.anchor).toBe('e_glorp');
    const glorp = result.plan.scenes[0]?.nodes.find((n) => n.id === 'e_glorp');
    expect(glorp).toMatchObject({ primitive: 'mountain', role: 'anchor' });
    expect(result.primitives.e_glorp?.source).toBe('llm');
    expect(result.llm.accepted).toEqual(['e_glorp', 'anchor']);
    expect(visualPlanSchemaFor(graph).safeParse(result.plan).success).toBe(true);
  });

  it('rejects answers outside the registry, the question, or the candidates', async () => {
    const llm = new MockLLMClient([
      '```json\n' +
        JSON.stringify({
          primitives: { e_glorp: 'dragon', e_sun: 'moon' },
          anchor: 'e_nobody',
        }) +
        '\n```',
    ]);
    const result = await selectMetaphor(tiedGraph(), { llm });
    expect(result.llm.accepted).toEqual([]);
    expect(result.llm.rejected.map((r) => r.id)).toEqual(['e_glorp', 'e_sun', 'anchor']);
    expect(result.plan.anchor).toBe('e_sun');
    expect(result.plan.scenes[0]?.nodes.find((n) => n.id === 'e_glorp')?.primitive).toBe(
      'labeled_card',
    );
  });

  it.each([
    ['throws', new Error('network down')],
    ['returns prose', 'I think a mountain would be nice.'],
    ['returns the wrong shape', '{"answer": 1}'],
  ])('keeps the rule result when the LLM %s', async (_label, reply) => {
    const offline = await selectMetaphor(tiedGraph());
    const result = await selectMetaphor(tiedGraph(), { llm: new MockLLMClient([reply]) });
    expect(result.plan).toEqual(offline.plan);
    expect(result.llm.consulted).toBe(true);
    expect(result.llm.error).toBeDefined();
  });

  it('validates tied keyword matches against the tied candidates only', async () => {
    const question = {
      utterance: 'A tomato.',
      entities: [
        {
          id: 'e_a',
          lemma: 'tomato',
          kind: 'object' as const,
          candidates: ['round_fruit' as const, 'slice' as const],
        },
        {
          id: 'e_b',
          lemma: 'tomato',
          kind: 'object' as const,
          candidates: ['round_fruit' as const, 'slice' as const],
        },
      ],
    };
    const llm = new MockLLMClient([JSON.stringify({ primitives: { e_a: 'slice', e_b: 'sun' } })]);
    const { answer, usage } = await askLLM(llm, question);
    expect([...answer.primitives]).toEqual([['e_a', 'slice']]);
    expect(usage.rejected).toEqual([
      { id: 'e_b', reason: '"sun" is not one of the tied candidates' },
    ]);
  });

  it('every golden plan still validates with an LLM that picks labeled_card for everything', async () => {
    const dir = new URL('../fixtures/', import.meta.url);
    for (const file of readdirSync(dir)) {
      const graph = fixture(file.replace(/\.sg\.json$/, ''));
      const llm = new MockLLMClient([
        (req) =>
          JSON.stringify({
            primitives: Object.fromEntries(
              (JSON.parse(req.user) as { entities: { id: string }[] }).entities.map((e) => [
                e.id,
                'labeled_card',
              ]),
            ),
          }),
      ]);
      const { plan } = await selectMetaphor(graph, { llm });
      expect(visualPlanSchemaFor(graph).safeParse(plan).success).toBe(true);
    }
  });
});

describe('primitive-choice prompt (PROMPT.md §15)', () => {
  it('states the schema, JSON-only rule, library and examples', () => {
    const { system } = buildPrimitiveRequest({ utterance: 'x', entities: [] });
    expect(system).toContain('JSON only');
    expect(system).toContain('"primitives"');
    expect(system).toContain('- labeled_card: generic');
    expect(system.match(/^Input:/gm)).toHaveLength(3);
    expect(system).not.toMatch(/\{\{[A-Z_]+\}\}/);
    expect(system).toMatchSnapshot();
  });
});
