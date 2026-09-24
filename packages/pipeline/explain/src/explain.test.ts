import { MockLLMClient } from '@opsis/parse';
import { ExplanationSchema } from '@opsis/schema';
import { describe, expect, it } from 'vitest';
import { buildNodeContext } from './context';
import { ExplainError } from './errors';
import { explain, explainNode } from './explain';
import { loadOsgFixture, reply } from './test-fixtures';

const sandwich = loadOsgFixture('sandwich');
const sun = loadOsgFixture('sun-east');

const identity = (nodeId: string, osgId: string, level: string, audience: string) => ({
  schemaVersion: 'exp/1',
  nodeId,
  osgId,
  level,
  audience,
});

/** Mocked model replies, one per audience, each written to that audience's wording rules. */
const AUDIENCE_REPLIES = {
  child: {
    osg: sun,
    nodeId: 'e_rises',
    body: {
      summary: 'The Sun looks like it rises in the east because Earth is spinning.',
      sections: {
        whatItIs: 'Rising is when the Sun first peeks over the land in the morning.',
        whyItMattersHere: 'Your sentence says the sun rises in the east. The arrow shows where.',
        commonMisconception: 'The Sun does not really climb up. Earth spins, so it looks that way.',
      },
      confidence: 'high',
    },
  },
  teen: {
    osg: sandwich,
    nodeId: 'e_tomato',
    body: {
      summary: 'Tomato is a juicy slice that can be one of the fillings in the sandwich.',
      sections: {
        whatItIs:
          'A tomato is the fleshy fruit of the tomato plant, mostly water inside a thin skin.',
        whyItMattersHere:
          'Your sentence says a sandwich can contain tomato, so it is an optional layer.',
        commonMisconception:
          'Botanically a tomato is a fruit, because it develops from the flower.',
      },
      confidence: 'high',
      suggestedDrillDown: ['Skin', 'the flesh', 'seeds'],
    },
  },
  adult: {
    osg: sun,
    nodeId: 'e_east',
    body: {
      summary:
        'East is the compass direction where sunrise is seen, roughly due east at the equinoxes.',
      sections: {
        whatItIs: 'East is the cardinal direction 90° clockwise from north.',
        whyItMattersHere:
          'The sentence places sunrise in the east; the compass marks that bearing relative to the horizon.',
        howItWorks:
          'Earth rotates west to east, so the eastern horizon turns towards the Sun first each morning.',
      },
      confidence: 'high',
    },
  },
} as const;

describe('explain with a mocked LLM', () => {
  it.each(['child', 'teen', 'adult'] as const)(
    'returns a valid %s explanation from the first reply',
    async (audience) => {
      const { osg, nodeId, body } = AUDIENCE_REPLIES[audience];
      const llm = new MockLLMClient([reply(body)]);
      const result = await explainNode(nodeId, osg, 'explanation', audience, llm);

      expect(result.source).toBe('llm');
      expect(result.llmCalls).toBe(1);
      expect(ExplanationSchema.safeParse(result.explanation).success).toBe(true);
      expect(result.explanation).toMatchObject({
        ...identity(nodeId, osg.id, 'explanation', audience),
        confidence: 'high',
      });
      expect(llm.calls[0]?.promptId).toBe('explain/v1');
      expect(llm.calls[0]?.system).toContain(`Current audience: \`${audience}\``);
      expect(result.explanation).toMatchSnapshot();
    },
  );

  it('uses different reading-level rules per audience', async () => {
    const systems = await Promise.all(
      (['child', 'teen', 'adult'] as const).map(async (audience) => {
        const llm = new MockLLMClient([reply(AUDIENCE_REPLIES.teen.body)]);
        await explain('e_tomato', sandwich, 'explanation', audience, llm);
        return llm.calls[0]?.system ?? '';
      }),
    );
    expect(systems[0]).toContain('a child aged about 8 to 11');
    expect(systems[1]).toContain('a student aged about 12 to 16');
    expect(systems[2]).toContain('a curious adult');
    expect(new Set(systems).size).toBe(3);
  });

  it('forces identity fields to the request, whatever the model wrote', async () => {
    const llm = new MockLLMClient([
      reply({
        ...identity('e_ham', '00000000-0000-4000-8000-000000000000', 'summary', 'adult'),
        ...AUDIENCE_REPLIES.teen.body,
      }),
    ]);
    const result = await explain('e_tomato', sandwich, 'explanation', 'teen', llm);
    expect(result).toMatchObject(identity('e_tomato', sandwich.id, 'explanation', 'teen'));
  });

  it('cleans drill-down suggestions', async () => {
    const llm = new MockLLMClient([reply(AUDIENCE_REPLIES.teen.body)]);
    const result = await explainNode('e_tomato', sandwich, 'explanation', 'teen', llm);
    expect(result.explanation.suggestedDrillDown).toEqual(['skin', 'flesh', 'seeds']);
  });

  it('drops sections from a summary-level reply', async () => {
    const llm = new MockLLMClient([reply(AUDIENCE_REPLIES.teen.body)]);
    const result = await explainNode('e_tomato', sandwich, 'summary', 'teen', llm);
    expect(result.explanation.sections).toBeUndefined();
    expect(result.explanation.level).toBe('summary');
    expect(result.diagnostics).toContain('dropped sections from a summary-level reply');
  });

  it('strips code fences around the JSON', async () => {
    const llm = new MockLLMClient(['```json\n' + reply(AUDIENCE_REPLIES.teen.body) + '\n```']);
    expect((await explainNode('e_tomato', sandwich, 'explanation', 'teen', llm)).source).toBe(
      'llm',
    );
  });

  it('caps confidence when the parser was unsure about the node', async () => {
    const unsure = structuredClone(sandwich);
    const tomato = unsure.sg.entities.find((entity) => entity.id === 'e_tomato');
    if (tomato) tomato.attributes = { confidence: 'low' };
    const llm = new MockLLMClient([reply(AUDIENCE_REPLIES.teen.body)]);
    const result = await explainNode('e_tomato', unsure, 'explanation', 'teen', llm);
    expect(result.explanation.confidence).toBe('medium');
  });
});

describe('repair and grounding checks', () => {
  const teen = AUDIENCE_REPLIES.teen.body;

  it('repairs an ungrounded whyItMattersHere once', async () => {
    const ungrounded = reply({
      ...teen,
      sections: { ...teen.sections, whyItMattersHere: 'It is a popular food around the world.' },
    });
    const llm = new MockLLMClient([ungrounded, reply(teen)]);
    const result = await explainNode('e_tomato', sandwich, 'explanation', 'teen', llm);

    expect(result.source).toBe('llm_repaired');
    expect(result.llmCalls).toBe(2);
    expect(llm.calls[1]?.promptId).toBe('explain-repair/v1');
    expect(llm.calls[1]?.user).toContain('sections.whyItMattersHere: must refer to');
    expect(llm.calls[1]?.user).toContain('It is a popular food around the world.');
  });

  it('rejects hedged wording at high confidence', async () => {
    const hedged = reply({ ...teen, summary: 'Tomato is probably a filling in the sandwich.' });
    const llm = new MockLLMClient([hedged, reply({ ...teen, confidence: 'medium' })]);
    const result = await explainNode('e_tomato', sandwich, 'explanation', 'teen', llm);
    expect(result.diagnostics[0]).toMatch(/confidence: the text hedges \("probably"\)/);
    expect(result.explanation.confidence).toBe('medium');
  });

  it('accepts hedged wording when confidence is not high', async () => {
    const llm = new MockLLMClient([
      reply({ ...teen, summary: 'Tomato is probably a filling here.', confidence: 'low' }),
    ]);
    expect((await explainNode('e_tomato', sandwich, 'explanation', 'teen', llm)).source).toBe(
      'llm',
    );
  });

  it('requires sections at the explanation level', async () => {
    const bare: Record<string, unknown> = { ...teen };
    delete bare['sections'];
    const llm = new MockLLMClient([reply(bare), reply(teen)]);
    const result = await explainNode('e_tomato', sandwich, 'explanation', 'teen', llm);
    expect(result.diagnostics).toContain(
      'attempt 1: sections: required when level is "explanation"',
    );
  });

  it('rejects summaries over 25 words', async () => {
    const long = reply({ ...teen, summary: Array.from({ length: 26 }, () => 'word').join(' ') });
    const llm = new MockLLMClient([long, long]);
    const result = await explainNode('e_tomato', sandwich, 'explanation', 'teen', llm);
    expect(result.source).toBe('fallback');
    expect(result.fallbackReason).toBe('invalid_llm_output');
  });
});

describe('low-confidence offline fallback', () => {
  it.each(['child', 'teen', 'adult'] as const)(
    'builds a valid low-confidence %s explanation from the SG without an LLM',
    async (audience) => {
      const result = await explainNode('e_tomato', sandwich, 'explanation', audience);
      expect(result).toMatchObject({ source: 'fallback', fallbackReason: 'no_llm_client' });
      expect(ExplanationSchema.safeParse(result.explanation).success).toBe(true);
      expect(result.explanation.confidence).toBe('low');
      expect(result.explanation.summary).toBe(
        'Tomato adds a juicy vegetable layer to the sandwich.',
      );
      expect(result.explanation.sections?.whyItMattersHere).toContain(sandwich.utterance);
      expect(result.explanation.suggestedDrillDown).toEqual(['skin', 'flesh', 'seeds']);
      expect(result.explanation).toMatchSnapshot();
    },
  );

  it('falls back when the provider errors', async () => {
    const llm = new MockLLMClient([new Error('rate limited')]);
    const result = await explainNode('e_rises', sun, 'explanation', 'teen', llm);
    expect(result).toMatchObject({ source: 'fallback', fallbackReason: 'llm_error', llmCalls: 1 });
    expect(result.explanation.confidence).toBe('low');
    expect(result.explanation.sections?.commonMisconception).toBe(
      'The Sun only appears to rise because Earth rotates from west to east.',
    );
  });

  it('falls back when the repair call errors', async () => {
    const llm = new MockLLMClient(['not json', new Error('timeout')]);
    const result = await explainNode('e_rises', sun, 'summary', 'teen', llm);
    expect(result).toMatchObject({ source: 'fallback', fallbackReason: 'llm_error', llmCalls: 2 });
    expect(result.explanation.sections).toBeUndefined();
  });

  it('falls back after two invalid replies and flags low confidence', async () => {
    const llm = new MockLLMClient(['not json', '{"summary": 3}']);
    const result = await explainNode('e_tomato', sandwich, 'explanation', 'child', llm);
    expect(result).toMatchObject({
      source: 'fallback',
      fallbackReason: 'invalid_llm_output',
      llmCalls: 2,
    });
    expect(result.explanation.confidence).toBe('low');
    expect(result.diagnostics.some((line) => line.startsWith('attempt 2:'))).toBe(true);
  });

  it('uses curated misconception wording for the audience', async () => {
    const child = await explain('e_tomato', sandwich, 'explanation', 'child');
    const adult = await explain('e_tomato', sandwich, 'explanation', 'adult');
    expect(child.sections?.commonMisconception).toMatch(/^Cooks call a tomato a vegetable/);
    expect(adult.sections?.commonMisconception).toMatch(/^Botanically a tomato is a fruit/);
  });

  it('explains diagram-only nodes and relations, grounded in the utterance', async () => {
    for (const nodeId of ['v_compass', 'r_sun_moves', 'e_sun', 'e_east']) {
      const explanation = await explain(nodeId, sun, 'explanation', 'teen');
      expect(ExplanationSchema.safeParse(explanation).success).toBe(true);
      expect(explanation.sections?.whyItMattersHere).toContain(sun.utterance);
    }
  });

  it('keeps every fallback grounded according to its own validator', async () => {
    for (const osg of [sandwich, sun]) {
      const ids = osg.scenes.flatMap((scene) => scene.nodes.map((node) => node.id));
      for (const nodeId of ids) {
        const context = buildNodeContext(osg, nodeId);
        const explanation = await explain(nodeId, osg, 'explanation', 'adult');
        const why = explanation.sections?.whyItMattersHere.toLowerCase() ?? '';
        expect(context.groundingTerms.some((term) => why.includes(term))).toBe(true);
      }
    }
  });

  it('rejects unknown nodes with a friendly error', async () => {
    await expect(explain('e_missing', sandwich, 'summary', 'teen')).rejects.toBeInstanceOf(
      ExplainError,
    );
    await expect(explain('e_missing', sandwich, 'summary', 'teen')).rejects.toMatchObject({
      code: 'node_not_found',
    });
  });
});
