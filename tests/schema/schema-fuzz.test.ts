import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BoardDocumentSchema,
  BoardSnapshotSchema,
  BoardRequestSchema,
  OSGSchema,
  SemanticGraphSchema,
  type OSG,
} from '../../packages/schema/src/index';

function boundaryValues(initialSeed: number) {
  let seed = initialSeed;
  function random(): number {
    seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
    return seed / 0x1_0000_0000;
  }

  function arbitrary(depth = 0): unknown {
    const leaves: unknown[] = [null, true, false, random(), `fuzz-${seed}`, '', Number.NaN];
    if (depth >= 3 || random() < 0.55) return leaves[Math.floor(random() * leaves.length)];
    if (random() < 0.5)
      return Array.from({ length: Math.floor(random() * 5) }, () => arbitrary(depth + 1));
    return Object.fromEntries(
      Array.from({ length: Math.floor(random() * 5) }, (_, index) => [
        `key_${index}_${seed}`,
        arbitrary(depth + 1),
      ]),
    );
  }
  return arbitrary;
}

describe('shared-schema fuzzing', () => {
  it('never throws while rejecting or accepting 2,500 arbitrary boundary values', () => {
    const arbitrary = boundaryValues(0x5eed1234);
    const schemas = [
      SemanticGraphSchema,
      BoardDocumentSchema,
      OSGSchema,
      BoardSnapshotSchema,
      BoardRequestSchema,
    ];
    for (const schema of schemas) {
      for (let index = 0; index < 500; index += 1) {
        expect(() => schema.safeParse(arbitrary())).not.toThrow();
      }
    }
  });

  it.each<{ reason: string; corrupt: (osg: OSG) => void }>([
    {
      reason: 'an unsupported schema version',
      corrupt: (osg) => Object.assign(osg, { schemaVersion: 'osg/999' }),
    },
    {
      reason: 'duplicate scene node ids',
      corrupt: (osg) =>
        Object.assign(osg.scenes[0]!.nodes[1]!, { id: osg.scenes[0]!.nodes[0]!.id }),
    },
    {
      reason: 'a missing connection endpoint',
      corrupt: (osg) => Object.assign(osg.scenes[0]!.edges[0]!, { from: 'missing-node' }),
    },
    {
      reason: 'inverted scene bounds',
      corrupt: (osg) => Object.assign(osg.scenes[0]!.bounds, { min: [2, 2, 2], max: [1, 1, 1] }),
    },
    {
      reason: 'an entity summary over the word limit',
      corrupt: (osg) => Object.assign(osg.sg.entities[0]!, { summary: 'word '.repeat(26) }),
    },
  ])('rejects an otherwise valid OSG with $reason', ({ corrupt }) => {
    const candidate = JSON.parse(
      readFileSync(resolve(import.meta.dirname, '../../fixtures/osg/sandwich.osg.json'), 'utf8'),
    ) as OSG;
    expect(OSGSchema.safeParse(candidate).success).toBe(true);
    corrupt(candidate);
    expect(OSGSchema.safeParse(candidate).success).toBe(false);
  });
});
