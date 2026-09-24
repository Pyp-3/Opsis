import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ExplanationSchema,
  OSGSchema,
  SemanticGraphSchema,
  VisualPlanSchema,
  VisualizeRequestSchema,
  type OSG,
} from '../../packages/schema/src/index';

let seed = 0x5eed1234;
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

describe('shared-schema fuzzing', () => {
  it('never throws while rejecting or accepting 2,500 arbitrary boundary values', () => {
    const schemas = [
      SemanticGraphSchema,
      VisualPlanSchema,
      OSGSchema,
      ExplanationSchema,
      VisualizeRequestSchema,
    ];
    for (const schema of schemas) {
      for (let index = 0; index < 500; index += 1) {
        expect(() => schema.safeParse(arbitrary())).not.toThrow();
      }
    }
  });

  it('rejects 500 deterministic corruptions of a valid OSG', () => {
    const fixture = JSON.parse(
      readFileSync(resolve(import.meta.dirname, '../../fixtures/osg/sandwich.osg.json'), 'utf8'),
    ) as OSG;
    const corruptions = [
      (osg: OSG) => Object.assign(osg, { schemaVersion: 'osg/999' }),
      (osg: OSG) => Object.assign(osg.scenes[0]!.nodes[1]!, { id: osg.scenes[0]!.nodes[0]!.id }),
      (osg: OSG) => Object.assign(osg.scenes[0]!.edges[0]!, { from: 'missing-node' }),
      (osg: OSG) => Object.assign(osg.scenes[0]!.bounds, { min: [2, 2, 2], max: [1, 1, 1] }),
      (osg: OSG) => Object.assign(osg.sg.entities[0]!, { summary: 'word '.repeat(26) }),
    ];
    for (let index = 0; index < 500; index += 1) {
      const candidate = structuredClone(fixture);
      corruptions[index % corruptions.length]!(candidate);
      expect(OSGSchema.safeParse(candidate).success).toBe(false);
    }
  });
});
