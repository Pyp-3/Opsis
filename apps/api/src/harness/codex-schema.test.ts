import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, onTestFinished } from 'vitest';
import {
  AgentDrawingSchema,
  BoardGraphSchema,
  EMAIL_DEMO,
  IllustrationSchema,
  ProcessStepSchema,
  boardOutputSchemaFor,
  illustrateOutputSchema,
} from '@opsis/schema';
import { codexOutput, codexOutputSchema } from './codex-schema';
import { HarnessLLMClient } from './client';
import { progressReader } from './progress';
import type { ProcessRunRequest } from './types';

// Check the provider's schema constraints recursively, including page references and unions.
function checkWireSchema(schema: Record<string, unknown>): void {
  expect(schema).not.toHaveProperty('$schema');
  expect(schema).not.toHaveProperty('const');
  expect(schema).not.toHaveProperty('minLength');
  expect(schema).not.toHaveProperty('maxLength');
  if (schema.type === 'object') {
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(Object.keys(schema.properties as object));
  }
  for (const key of ['properties', '$defs', 'definitions'])
    if (schema[key]) Object.values(schema[key] as object).forEach(checkWireSchema);
  if (schema.items) {
    expect(Array.isArray(schema.items)).toBe(false);
    checkWireSchema(schema.items as Record<string, unknown>);
  }
  if (schema.anyOf) (schema.anyOf as Record<string, unknown>[]).forEach(checkWireSchema);
}

describe('Codex Structured Outputs compatibility', () => {
  it('adapts every board schema combination and animated illustrations without changing contracts', () => {
    for (let flags = 0; flags < 16; flags++) {
      const original = boardOutputSchemaFor({
        focus: Boolean(flags & 1),
        sketch: Boolean(flags & 2),
        pages: Boolean(flags & 4),
        readPages: Boolean(flags & 8),
      });
      checkWireSchema(JSON.parse(codexOutputSchema(original)));
      expect(JSON.parse(original)).toHaveProperty('$schema');
    }
    checkWireSchema(JSON.parse(codexOutputSchema(illustrateOutputSchema)));
  });

  it('keeps coordinate bounds and exactly two items, and refuses mixed tuples', () => {
    const schema = JSON.parse(codexOutputSchema(boardOutputSchemaFor({})));
    const points = schema.properties.drawings.anyOf[0].items.properties.points.anyOf[0];
    expect(points.items).toEqual({
      type: 'array',
      minItems: 2,
      maxItems: 2,
      items: { type: 'number', minimum: -100000, maximum: 100000 },
    });
    expect(() =>
      codexOutputSchema('{"type":"array","items":[{"type":"number"},{"type":"string"}]}'),
    ).toThrow('harness_schema');
    expect(
      AgentDrawingSchema.safeParse({
        id: 'arrow',
        shape: 'arrow',
        ink: 'ink',
        strokeWidth: 2,
        line: 'solid',
        points: [
          [0, 0, 1],
          [10, 10],
        ],
      }).success,
    ).toBe(false);
  });

  it('restores optional omissions in drawings, page references and focus/sketch edits', () => {
    const original = boardOutputSchemaFor({
      focus: true,
      sketch: true,
      pages: true,
      readPages: true,
    });
    const drawing = {
      id: 'arrow',
      shape: 'arrow',
      ink: 'ink',
      strokeWidth: 2,
      line: 'solid',
      points: [
        [0, 0],
        [10, 10],
      ],
      x: null,
      d: null,
    };
    const value = {
      ...EMAIL_DEMO,
      drawings: [drawing],
      morePages: [
        {
          title: 'More',
          summary: 'More detail',
          nodes: EMAIL_DEMO.nodes,
          edges: [],
          drawings: [drawing],
        },
      ],
      focusEdits: null,
      sketchEdits: null,
      readPages: null,
    };
    const output = JSON.parse(codexOutput(JSON.stringify(value), original));
    expect(output).not.toHaveProperty('focusEdits');
    expect(output).not.toHaveProperty('sketchEdits');
    expect(output).not.toHaveProperty('readPages');
    expect(output.drawings[0]).not.toHaveProperty('x');
    expect(output.morePages[0].drawings[0]).not.toHaveProperty('d');
    const { morePages, ...graph } = output;
    expect(BoardGraphSchema.safeParse(graph).success).toBe(true);
    expect(morePages).toHaveLength(1);
    expect(AgentDrawingSchema.safeParse(output.morePages[0].drawings[0]).success).toBe(true);
    // Required and unknown nulls must reach the original validator as invalid data.
    const invalid = JSON.parse(
      codexOutput(JSON.stringify({ ...value, title: null, unknown: null }), original),
    );
    expect(invalid.title).toBeNull();
    expect(invalid.unknown).toBeNull();
    expect(BoardGraphSchema.safeParse(invalid).success).toBe(false);
  });

  it('restores animated illustration omissions while retaining coordinate pairs', () => {
    const illustration = {
      layers: [
        {
          shape: 'circle',
          cx: 50,
          cy: 50,
          r: 10,
          stroke: 'ink',
          fill: 'gold',
          d: null,
          motions: [
            {
              type: 'move',
              duration: 1,
              repeat: 'loop',
              values: [
                [0, 0],
                [5, 5],
              ],
              origin: null,
            },
          ],
        },
      ],
    };
    const output = JSON.parse(
      codexOutput(
        JSON.stringify({ illustrations: [{ id: 'sun', illustration }] }),
        illustrateOutputSchema,
      ),
    );
    expect(output.illustrations[0].illustration.layers[0]).not.toHaveProperty('d');
    expect(output.illustrations[0].illustration.layers[0].motions[0].values).toEqual([
      [0, 0],
      [5, 5],
    ]);
    expect(IllustrationSchema.safeParse(output.illustrations[0].illustration).success).toBe(true);
  });

  it('restores optional process flags in the selected operation and preserves required nulls', () => {
    const original = boardOutputSchemaFor({});
    const value = {
      nodes: [
        { process: { op: 'sort', from: 'sample', order: 'asc', numeric: null, ignoreCase: null } },
      ],
    };
    const output = JSON.parse(codexOutput(JSON.stringify(value), original));
    expect(output.nodes[0].process).toEqual({ op: 'sort', from: 'sample', order: 'asc' });
    expect(ProcessStepSchema.safeParse(output.nodes[0].process).success).toBe(true);
    value.nodes[0].process.order = null as unknown as string;
    const invalid = JSON.parse(codexOutput(JSON.stringify(value), original));
    expect(ProcessStepSchema.safeParse(invalid.nodes[0].process).success).toBe(false);
  });

  it('keeps validated provisional nodes with optional nulls and rejects malformed ones', () => {
    const read = progressReader('codex', boardOutputSchemaFor({}));
    const node = EMAIL_DEMO.nodes[0]!;
    const events = read(
      JSON.stringify({
        type: 'item.completed',
        item: {
          type: 'agent_message',
          text: JSON.stringify({
            nodes: [
              { ...node, process: null },
              { ...EMAIL_DEMO.nodes[1], label: null },
            ],
          }),
        },
      }),
    );
    expect(events.filter((event) => event.type === 'node')).toEqual([{ type: 'node', node }]);
  });

  it.each([false, true])(
    'writes the adapted schema and decodes Codex output with session=%s',
    async (session) => {
      const root = await mkdtemp(join(tmpdir(), 'opsis-codex-schema-test-'));
      onTestFinished(() => rm(root, { recursive: true, force: true }));
      const original = boardOutputSchemaFor({});
      const client = new HarnessLLMClient(
        { provider: 'codex', model: 'gpt-6.1-sol', executable: '/fake/codex', timeoutMs: 1000 },
        '0.159.0',
        {
          async run(request: ProcessRunRequest) {
            const path = request.args[request.args.indexOf('--output-schema') + 1]!;
            checkWireSchema(JSON.parse(await readFile(path, 'utf8')));
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                type: 'item.completed',
                item: {
                  type: 'agent_message',
                  text: JSON.stringify({ ...EMAIL_DEMO, drawings: null }),
                },
              }),
            };
          },
        },
        {},
        undefined,
        original,
        session
          ? {
              root,
              store: {
                read: async () => null,
                write: async () => undefined,
                clear: async () => undefined,
              },
            }
          : undefined,
      );
      const output = JSON.parse(
        await client.complete({
          promptId: 'test',
          system: 'Return JSON',
          user: 'Explain email',
          responseFormat: 'json',
          temperature: 0,
          maxOutputTokens: 100,
          ...(session
            ? {
                session: {
                  key: 'test-account/test-thread',
                  resumeSystem: '',
                  resumeUser: '',
                },
              }
            : {}),
        }),
      );
      expect(output).not.toHaveProperty('drawings');
      expect(BoardGraphSchema.safeParse(output).success).toBe(true);
    },
  );
});
