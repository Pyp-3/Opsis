import { readFileSync, readdirSync } from 'node:fs';
import { SemanticGraphSchema, generateJsonSchema } from '@opsis/schema';
import { describe, expect, it } from 'vitest';
import { MockLLMClient } from './mock-llm-client';
import { parseUtterance } from './parse';
import {
  buildParseRequest,
  buildRepairRequest,
  buildSystemPrompt,
  loadPromptExamples,
  renderTemplate,
} from './prompt';

const promptsDir = new URL('../prompts/', import.meta.url);
const fixture = (name: string) =>
  JSON.parse(
    readFileSync(new URL(`../../../../fixtures/sg/${name}.sg.json`, import.meta.url), 'utf8'),
  );

describe('prompt templates (PROMPT.md §15)', () => {
  const system = buildSystemPrompt('teen');

  it('states the role and embeds the generated JSON Schema', () => {
    expect(system).toContain('You are the Opsis Semantic Parser');
    expect(system).toContain(JSON.stringify(generateJsonSchema('semanticGraph')));
  });

  it('requires JSON only with no prose or fences', () => {
    expect(system).toContain('Respond with JSON only');
    expect(system).toContain('no code fences');
  });

  it('includes golden worked examples', () => {
    const examples = loadPromptExamples();
    expect(examples.length).toBeGreaterThanOrEqual(2);
    expect(examples.length).toBeLessThanOrEqual(3);
    for (const example of examples) {
      expect(system).toContain(`Utterance: ${example.utterance}`);
      expect(system).toContain(JSON.stringify(example.output));
    }
  });

  it('covers modality, order, misconceptions, low confidence and audience', () => {
    expect(system).toMatch(/Modality/u);
    expect(system).toContain('"possible"');
    expect(system).toContain('"negated"');
    expect(system).toMatch(/\*\*Order\.\*\*/u);
    expect(system).toMatch(/misconception/u);
    expect(system).toContain('Use `"confidence": "low"` rather than guessing');
    expect(buildSystemPrompt('child')).toContain('for a child reader');
    expect(buildSystemPrompt('adult')).toContain('curious adult');
  });

  it('leaves no unreplaced placeholders and strips the version header', () => {
    const request = buildParseRequest('The sun rises in the east.', 'teen');
    const repair = buildRepairRequest('The sun rises in the east.', 'teen', '{}', ['(root): bad']);
    for (const text of [request.system, request.user, repair.user]) {
      expect(text).not.toMatch(/\{\{[A-Z_]+\}\}/u);
      expect(text).not.toContain('<!--');
    }
    expect(request).toMatchObject({ responseFormat: 'json', temperature: 0 });
  });

  it('throws on a missing placeholder value', () => {
    expect(() => renderTemplate('Hello {{NAME}}', {})).toThrow('Missing prompt value for {{NAME}}');
  });

  it('templates are versioned files', () => {
    expect(readdirSync(promptsDir).sort()).toEqual([
      'examples.v1.json',
      'repair.v1.md',
      'semantic-parse-user.v1.md',
      'semantic-parse.v1.md',
    ]);
  });

  it('worked examples are schema-valid and match the North Star fixtures', () => {
    const examples = loadPromptExamples();
    for (const example of examples) {
      expect(SemanticGraphSchema.parse(example.output).utterance).toBe(example.utterance);
    }
    expect(examples[0]?.output).toEqual(fixture('sun-east'));
    expect(examples[1]?.output).toEqual(fixture('sandwich'));
  });
});

describe('golden snapshot through the mocked LLM path (§15.7)', () => {
  it.each(loadPromptExamples().map((example) => [example.utterance, example] as const))(
    '%s',
    async (_utterance, example) => {
      const llm = new MockLLMClient([JSON.stringify(example.output)]);
      const result = await parseUtterance(example.utterance, { llm });
      expect(result.source).toBe('llm');
      expect(result.sg).toMatchSnapshot();
    },
  );
});
