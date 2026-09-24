import { ExplanationSchema } from '@opsis/schema';
import { describe, expect, it } from 'vitest';
import { buildNodeContext } from './context';
import {
  buildExplainRequest,
  buildExplainSystemPrompt,
  loadExplainExamples,
  toPromptContext,
} from './prompt';
import { loadOsgFixture } from './test-fixtures';
import { mentionsAny } from './validate';

describe('explain/v1 prompt (PROMPT.md §15)', () => {
  const system = buildExplainSystemPrompt('teen');

  it('states the role, JSON-only output and the generated JSON Schema', () => {
    expect(system).toContain('You are the Opsis Explainer');
    expect(system).toContain('Respond with JSON only');
    expect(system).toContain('no code fences');
    expect(system).toContain('"exp/1"');
    expect(system).toContain('"whyItMattersHere"');
    expect(system).not.toMatch(/\{\{[A-Z_]+\}\}/u);
  });

  it('asks for modality, order, misconceptions, low confidence and no speculation', () => {
    expect(system).toContain('**Modality and order.**');
    expect(system).toContain('**Misconceptions.**');
    expect(system).toContain('Use `"low"` rather than inventing facts');
    expect(system).toContain('**No speculation.**');
    expect(system).toContain('**Ground it in the sentence.**');
  });

  it('embeds three worked examples that validate and are grounded', () => {
    const examples = loadExplainExamples();
    expect(examples).toHaveLength(3);
    for (const example of examples) {
      expect(system).toContain(JSON.stringify(example.output));
      const output = ExplanationSchema.parse(example.output);
      expect(output).toMatchObject(example.request);
      if (output.sections) {
        const terms = example.context.utterance.toLowerCase().match(/\p{L}+/gu) ?? [];
        expect(mentionsAny(output.sections.whyItMattersHere, terms)).toBe(true);
      }
    }
    expect(examples.map((example) => example.request.audience)).toEqual(['teen', 'child', 'adult']);
    expect(examples.some((example) => example.output.confidence === 'low')).toBe(true);
  });

  it('matches the example contexts to the North Star fixtures', () => {
    const [tomato, rises] = loadExplainExamples();
    const sandwich = loadOsgFixture('sandwich');
    const sun = loadOsgFixture('sun-east');
    expect(toPromptContext(buildNodeContext(sandwich, 'e_tomato'))).toMatchObject({
      ...tomato?.context,
      path: sandwich.breadcrumbs.map((crumb) => crumb.label),
    });
    expect(toPromptContext(buildNodeContext(sun, 'e_rises')).facts).toEqual(rises?.context.facts);
  });

  it('sends the request and context as data in the user message', () => {
    const sandwich = loadOsgFixture('sandwich');
    const request = buildExplainRequest(buildNodeContext(sandwich, 'e_tomato'), {
      nodeId: 'e_tomato',
      osgId: sandwich.id,
      level: 'explanation',
      audience: 'child',
    });
    expect(request).toMatchObject({ promptId: 'explain/v1', responseFormat: 'json' });
    expect(request.user).toMatchSnapshot();
  });
});
