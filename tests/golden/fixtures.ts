import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { GoldenCaseSchema, type NamedGoldenCase } from './schema';

const fixtureDirectory = fileURLToPath(new URL('../../fixtures/golden/', import.meta.url));

/** Loads and validates golden cases in stable filename order. */
export async function loadGoldenCases(): Promise<NamedGoldenCase[]> {
  const filenames = (await readdir(fixtureDirectory))
    .filter((filename) => filename.endsWith('.json'))
    .sort();

  return Promise.all(
    filenames.map(async (filename) => {
      const contents = await readFile(`${fixtureDirectory}/${filename}`, 'utf8');
      return {
        id: filename.replace(/\.json$/u, ''),
        ...GoldenCaseSchema.parse(JSON.parse(contents)),
      };
    }),
  );
}
