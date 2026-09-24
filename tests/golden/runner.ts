import { OSGSchema, type OSG } from '../../packages/schema/src/index';
import type { NamedGoldenCase } from './schema';

export type GoldenPipeline = (utterance: string) => OSG | Promise<OSG>;

export type GoldenCaseResult = {
  id: string;
  utterance: string;
  passed: boolean;
  failures: string[];
};

export type GoldenReport = {
  passed: number;
  total: number;
  passRate: number;
  cases: GoldenCaseResult[];
};

type GoldenReporter = Pick<Console, 'log' | 'table'>;

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase('en');
}

function evaluateCase(testCase: NamedGoldenCase, osg: OSG): string[] {
  const failures: string[] = [];
  const expectations = testCase.expectations;
  const metaphors = new Set(osg.scenes.map((scene) => scene.metaphor));
  if (!expectations.expectedMetaphors.some((metaphor) => metaphors.has(metaphor))) {
    failures.push(`expected metaphor: ${expectations.expectedMetaphors.join(' or ')}`);
  }

  const entityIdsByLemma = new Map<string, Set<string>>();
  for (const entity of osg.sg.entities) {
    const lemma = normalized(entity.lemma);
    const ids = entityIdsByLemma.get(lemma) ?? new Set<string>();
    ids.add(entity.id);
    entityIdsByLemma.set(lemma, ids);
  }
  for (const lemma of expectations.requiredEntityLemmas) {
    if (!entityIdsByLemma.has(normalized(lemma))) failures.push(`missing entity lemma: ${lemma}`);
  }

  for (const relation of expectations.requiredRelations) {
    const count = osg.sg.relations.filter(
      (candidate) => candidate.type === relation.type && candidate.modality === relation.modality,
    ).length;
    const minimum = relation.minimumCount ?? 1;
    if (count < minimum) {
      failures.push(
        `expected at least ${minimum} ${relation.type}/${relation.modality} relation(s), found ${count}`,
      );
    }
  }

  const explodableNodeIds = new Set(
    osg.scenes.flatMap((scene) =>
      scene.nodes.filter((node) => node.explodable === true).map((node) => node.id),
    ),
  );
  for (const lemma of expectations.explodableParts) {
    const entityIds = entityIdsByLemma.get(normalized(lemma));
    if (entityIds === undefined || ![...entityIds].some((id) => explodableNodeIds.has(id))) {
      failures.push(`part is not explodable: ${lemma}`);
    }
  }

  const noteKinds = new Set(osg.sg.notes?.map((note) => note.kind) ?? []);
  for (const kind of expectations.requiredPedagogyNoteKinds) {
    if (!noteKinds.has(kind)) failures.push(`missing pedagogy note kind: ${kind}`);
  }

  const primitives = new Set(
    osg.scenes.flatMap((scene) => scene.nodes.map((node) => node.primitive)),
  );
  for (const primitive of expectations.requiredPrimitives ?? []) {
    if (!primitives.has(primitive)) failures.push(`missing primitive: ${primitive}`);
  }

  return failures;
}

/** Runs structural golden assertions, treating pipeline errors as failed cases. */
export async function runGoldenSuite(
  cases: readonly NamedGoldenCase[],
  pipeline: GoldenPipeline,
): Promise<GoldenReport> {
  const results: GoldenCaseResult[] = [];
  for (const testCase of cases) {
    try {
      const osg = OSGSchema.parse(await pipeline(testCase.utterance));
      const failures = evaluateCase(testCase, osg);
      results.push({
        id: testCase.id,
        utterance: testCase.utterance,
        passed: failures.length === 0,
        failures,
      });
    } catch (error) {
      results.push({
        id: testCase.id,
        utterance: testCase.utterance,
        passed: false,
        failures: [`pipeline crashed or returned invalid OSG: ${String(error)}`],
      });
    }
  }

  const passed = results.filter((result) => result.passed).length;
  return {
    passed,
    total: results.length,
    passRate: results.length === 0 ? 0 : passed / results.length,
    cases: results,
  };
}

/** Prints the machine-readable report followed by a compact human-readable table. */
export function reportGoldenSuite(report: GoldenReport, reporter: GoldenReporter = console): void {
  reporter.log(JSON.stringify(report, null, 2));
  const rows = report.cases.map((result) => ({
    case: result.id,
    result: result.passed ? 'PASS' : 'FAIL',
    failures: result.failures.join('; '),
  }));
  rows.push({
    case: 'OVERALL',
    result: `${(report.passRate * 100).toFixed(1)}% (${report.passed}/${report.total})`,
    failures: '',
  });
  reporter.table(rows);
  reporter.log(
    `Golden pass rate: ${report.passed}/${report.total} (${(report.passRate * 100).toFixed(1)}%)`,
  );
}
