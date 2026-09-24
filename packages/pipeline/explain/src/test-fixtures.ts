import { readFileSync } from 'node:fs';
import { OSGSchema, type OSG } from '@opsis/schema';

/** Loads a North Star OSG fixture from `fixtures/osg/`. */
export function loadOsgFixture(name: 'sandwich' | 'sun-east'): OSG {
  const url = new URL(`../../../../fixtures/osg/${name}.osg.json`, import.meta.url);
  return OSGSchema.parse(JSON.parse(readFileSync(url, 'utf8')));
}

/** A reply as the model would send it: a JSON object without identity fields filled in. */
export const reply = (value: Record<string, unknown>) => JSON.stringify(value);
