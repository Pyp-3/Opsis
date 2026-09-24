import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { OSGSchema, type OSG } from '../../packages/schema/src/index';
import { describe, expect, it, vi } from 'vitest';
import { loadGoldenCases } from './fixtures';
import { reportGoldenSuite, runGoldenSuite, type GoldenPipeline } from './runner';
import type { NamedGoldenCase } from './schema';

const osgFixtureDirectory = fileURLToPath(new URL('../../fixtures/osg/', import.meta.url));

async function loadOsg(filename: string): Promise<OSG> {
  return OSGSchema.parse(JSON.parse(await readFile(`${osgFixtureDirectory}/${filename}`, 'utf8')));
}

async function northStarSetup(): Promise<{
  cases: NamedGoldenCase[];
  pipeline: GoldenPipeline;
}> {
  const allCases = await loadGoldenCases();
  const cases = allCases.filter(
    (testCase) => testCase.id === '01-sun-east' || testCase.id === '02-sandwich-parts',
  );
  const outputs = new Map([
    [cases[0]?.utterance, await loadOsg('sun-east.osg.json')],
    [cases[1]?.utterance, await loadOsg('sandwich.osg.json')],
  ]);
  return {
    cases,
    pipeline: (utterance) => {
      const output = outputs.get(utterance);
      if (output === undefined) throw new Error(`No stub output for: ${utterance}`);
      return output;
    },
  };
}

describe('golden runner', () => {
  it('passes cases 1 and 2 through the North Star stub pipeline', async () => {
    const { cases, pipeline } = await northStarSetup();
    const report = await runGoldenSuite(cases, pipeline);

    expect(report).toMatchObject({ passed: 2, total: 2, passRate: 1 });
    expect(report.cases.every((result) => result.passed)).toBe(true);
    reportGoldenSuite(report);
  });

  it('reports unmet structural expectations as a failed case', async () => {
    const { cases, pipeline } = await northStarSetup();
    const source = cases[0];
    if (source === undefined) throw new Error('Missing sun/east golden fixture');
    const impossible: NamedGoldenCase = {
      ...source,
      expectations: {
        ...source.expectations,
        requiredEntityLemmas: [...source.expectations.requiredEntityLemmas, 'moon'],
      },
    };

    const report = await runGoldenSuite([impossible], pipeline);

    expect(report).toMatchObject({ passed: 0, total: 1, passRate: 0 });
    expect(report.cases[0]?.failures).toContain('missing entity lemma: moon');
  });

  it('turns a pipeline crash into a failed case and continues', async () => {
    const { cases, pipeline } = await northStarSetup();
    const crashingPipeline: GoldenPipeline = (utterance) => {
      if (utterance === cases[0]?.utterance) throw new Error('synthetic failure');
      return pipeline(utterance);
    };

    const report = await runGoldenSuite(cases, crashingPipeline);

    expect(report).toMatchObject({ passed: 1, total: 2, passRate: 0.5 });
    expect(report.cases[0]?.failures[0]).toContain('synthetic failure');
    expect(report.cases[1]?.passed).toBe(true);
  });

  it('reports the suite as JSON and a console table', async () => {
    const { cases, pipeline } = await northStarSetup();
    const report = await runGoldenSuite(cases, pipeline);
    const reporter = { log: vi.fn(), table: vi.fn() };

    reportGoldenSuite(report, reporter);

    expect(JSON.parse(String(reporter.log.mock.calls[0]?.[0]))).toEqual(report);
    expect(reporter.table).toHaveBeenCalledOnce();
    expect(reporter.log).toHaveBeenLastCalledWith('Golden pass rate: 2/2 (100.0%)');
  });
});
