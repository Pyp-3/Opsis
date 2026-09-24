import { readFileSync } from 'node:fs';
import { ErrorResponseSchema, SemanticGraphSchema, type SemanticGraph } from '@opsis/schema';
import { describe, expect, it } from 'vitest';
import { ParseError } from './errors';
import { MockLLMClient } from './mock-llm-client';
import { MAX_UTTERANCE_LENGTH, parseUtterance, prepareUtterance, validateLLMOutput } from './parse';
import { PARSE_PROMPT_ID, REPAIR_PROMPT_ID } from './prompt';

const fixture = (name: string) =>
  JSON.parse(
    readFileSync(new URL(`../../../../fixtures/sg/${name}.sg.json`, import.meta.url), 'utf8'),
  ) as SemanticGraph;

const sun = fixture('sun-east');
const sandwich = fixture('sandwich');

describe('parseUtterance on the mocked LLM path', () => {
  it('accepts valid output first time, stripping stray fences', async () => {
    const llm = new MockLLMClient([
      `Here you go:\n\`\`\`json\n${JSON.stringify(sandwich)}\n\`\`\``,
    ]);
    const result = await parseUtterance(sandwich.utterance, { llm, audience: 'child' });
    expect(result).toMatchSnapshot();
    expect(result.source).toBe('llm');
    expect(result.flagged).toBe(false);
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0]?.promptId).toBe(PARSE_PROMPT_ID);
    expect(llm.calls[0]?.user).toBe(`<utterance>${sandwich.utterance}</utterance>`);
    expect(llm.calls[0]?.system).toContain('child reader');
  });

  it('attaches known notes the model forgot', async () => {
    const withoutNotes = { ...sun, notes: undefined };
    const llm = new MockLLMClient([JSON.stringify(withoutNotes)]);
    const result = await parseUtterance(sun.utterance, { llm });
    expect(result.sg.notes).toEqual(sun.notes);
  });

  it('repair branch: sends one repair prompt with the Zod errors, then succeeds', async () => {
    const broken = {
      ...sun,
      relations: sun.relations.map((relation, index) =>
        index === 0 ? { ...relation, modality: 'definitely' } : relation,
      ),
    };
    const llm = new MockLLMClient([JSON.stringify(broken), JSON.stringify(sun)]);
    const result = await parseUtterance(sun.utterance, { llm });
    expect(result).toMatchSnapshot();
    expect(result.source).toBe('llm_repaired');
    expect(result.flagged).toBe(false);
    expect(llm.calls.map((call) => call.promptId)).toEqual([PARSE_PROMPT_ID, REPAIR_PROMPT_ID]);
    const repair = llm.calls[1]?.user ?? '';
    expect(repair).toContain('relations.0.modality: Invalid enum value');
    expect(repair).toContain(JSON.stringify(broken));
    expect(repair).toMatchSnapshot();
  });

  it('fallback branch: two invalid replies fall back to the rule parser and flag the result', async () => {
    const llm = new MockLLMClient(['I think the sun is nice!', '{"schemaVersion":"sg/2"}']);
    const result = await parseUtterance(sun.utterance, { llm });
    expect(result).toMatchSnapshot();
    expect(result.source).toBe('rule_fallback');
    expect(result.flagged).toBe(true);
    expect(result.fallbackReason).toBe('invalid_llm_output');
    expect(result.llmCalls).toBe(2);
    expect(SemanticGraphSchema.safeParse(result.sg).success).toBe(true);
    expect(result.sg.notes?.[0]?.kind).toBe('misconception');
  });

  it('falls back when the provider errors on the first or the repair call', async () => {
    const first = await parseUtterance(sun.utterance, {
      llm: new MockLLMClient([new Error('503 overloaded')]),
    });
    expect(first).toMatchObject({
      source: 'rule_fallback',
      fallbackReason: 'llm_error',
      llmCalls: 1,
    });
    expect(first.diagnostics).toEqual(['llm call 1 failed: 503 overloaded']);

    const second = await parseUtterance(sun.utterance, {
      llm: new MockLLMClient(['not json', new Error('timeout')]),
    });
    expect(second).toMatchObject({
      source: 'rule_fallback',
      fallbackReason: 'llm_error',
      llmCalls: 2,
    });
  });

  it('reports cross-reference errors from the SG refinements', () => {
    const dangling = {
      ...sun,
      relations: sun.relations.map((relation, index) =>
        index === 0 ? { ...relation, target: 'e_moon' } : relation,
      ),
    };
    expect(validateLLMOutput(JSON.stringify(dangling), sun.utterance)).toEqual({
      ok: false,
      errors: ['relations.0.target: relation target must reference an existing entity'],
    });
  });

  it('rejects output that does not echo the utterance or has out-of-range spans', () => {
    const wrongUtterance = validateLLMOutput(JSON.stringify(sun), 'The moon rises in the east.');
    expect(wrongUtterance).toMatchObject({ ok: false });
    const badSpan = {
      ...sun,
      entities: sun.entities.map((entity, index) =>
        index === 0 ? { ...entity, span: [4, 400] } : entity,
      ),
      relations: sun.relations.map((relation, index) =>
        index === 0 ? { ...relation, evidenceSpan: [9, 2] } : relation,
      ),
    };
    expect(validateLLMOutput(JSON.stringify(badSpan), sun.utterance)).toEqual({
      ok: false,
      errors: [
        'entities.0.span: must lie within the utterance',
        'relations.0.evidenceSpan: must lie within the utterance',
      ],
    });
  });

  it('runs offline without an LLM client', async () => {
    const result = await parseUtterance('  A sandwich can contain bread, tomato, ham.  ', {
      llm: null,
    });
    expect(result).toMatchObject({ source: 'rule_fallback', flagged: true, llmCalls: 0 });
    expect(result.sg.utterance).toBe('A sandwich can contain bread, tomato, ham.');
  });
});

describe('input limits and safety', () => {
  it('enforces the 500-character limit', async () => {
    expect(MAX_UTTERANCE_LENGTH).toBe(500);
    expect(prepareUtterance('a'.repeat(500))).toHaveLength(500);
    const tooLong = 'a'.repeat(501);
    await expect(parseUtterance(tooLong)).rejects.toMatchObject({ code: 'utterance_too_long' });
  });

  it('rejects empty input', async () => {
    await expect(parseUtterance('   ')).rejects.toMatchObject({ code: 'empty_utterance' });
  });

  it.each([
    'Show me porn',
    'How to make a bomb at home',
    'I want to kill myself',
    'This fucking sandwich has ham',
  ])('refuses unsafe input with a friendly message: %s', async (utterance) => {
    const llm = new MockLLMClient([]);
    const error = await parseUtterance(utterance, { llm }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ParseError);
    const response = (error as ParseError).toErrorResponse();
    expect(ErrorResponseSchema.parse(response)).toMatchObject({
      code: 'unsafe_input',
      stage: 'parse',
      retryable: false,
    });
    expect(response.message).not.toContain(utterance);
    expect(llm.calls).toHaveLength(0);
  });

  it('allows everyday science sentences', () => {
    for (const utterance of [
      'White blood cells kill bacteria.',
      'The Sun shoots out charged particles.',
      'Sexual reproduction needs two parents.',
    ]) {
      expect(() => prepareUtterance(utterance)).not.toThrow();
    }
  });
});
