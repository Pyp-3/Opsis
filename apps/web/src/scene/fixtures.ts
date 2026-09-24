import { OSGSchema, type OSG } from '@opsis/schema';
import sandwich from '../../../../fixtures/osg/sandwich.osg.json';
import sunEast from '../../../../fixtures/osg/sun-east.osg.json';

/** Hand-written North Star OSGs rendered in M1 (PROMPT.md §2, §13). */
export const FIXTURES = {
  'sun-east': sunEast,
  sandwich,
} as const;

/** Identifier of a bundled fixture. */
export type FixtureId = keyof typeof FIXTURES;

/** Loads a fixture, validating it at the boundary so the renderer only sees valid OSGs. */
export function loadFixture(id: FixtureId): OSG {
  return OSGSchema.parse(FIXTURES[id]);
}
