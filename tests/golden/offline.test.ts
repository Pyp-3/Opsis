import { layoutVisualPlan } from '../../packages/pipeline/layout/src/index';
import { selectMetaphor } from '../../packages/pipeline/metaphor/src/index';
import { parseUtterance } from '../../packages/pipeline/parse/src/index';
import { describe, expect, it } from 'vitest';
import { loadGoldenCases } from './fixtures';
import { reportGoldenSuite, runGoldenSuite } from './runner';

describe('complete offline golden pipeline', () => {
  it('reports all 15 cases and enforces the M2 threshold', async () => {
    const cases = await loadGoldenCases();
    const report = await runGoldenSuite(cases, async (utterance) => {
      const parsed = await parseUtterance(utterance, { llm: null });
      const metaphor = await selectMetaphor(parsed.sg, { llm: null });
      return layoutVisualPlan(metaphor.plan, parsed.sg, { seed: 0 });
    });
    reportGoldenSuite(report);
    expect(report.total).toBe(15);
    expect(report.passRate).toBeGreaterThanOrEqual(0.7);
  });
});
