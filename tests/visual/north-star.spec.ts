import type { Page } from '@playwright/test';
import { layoutVisualPlan } from '../../packages/pipeline/layout/src/index';
import {
  createSgRef,
  type MetaphorId,
  type OSG,
  type SemanticGraph,
  type VisualPlan,
} from '../../packages/schema/src/index';
import { expect, test } from '../browser-fixture';

async function openSample(page: Page, sentence: string): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await page.getByRole('button', { name: sentence }).click();
  await expect(page.getByRole('navigation', { name: 'Diagram as list' })).toBeVisible();
  await page.waitForTimeout(500);
}

type FlowCase = {
  utterance: string;
  metaphor: Extract<MetaphorId, 'cycle' | 'timeline'>;
  labels: readonly string[];
};

async function flowOsg(testCase: FlowCase): Promise<OSG> {
  const entities = testCase.labels.map((label, index) => ({
    id: `e_${label.toLocaleLowerCase().replaceAll(/[^a-z]+/gu, '_')}`,
    surface: label,
    lemma: label.toLocaleLowerCase(),
    kind: 'process' as const,
    span: [index * 2, index * 2 + 1] as [number, number],
    summary: `${label} is step ${index + 1} in this process.`,
  }));
  const relations = entities.map((entity, index) => ({
    id: `r_${index}`,
    type: testCase.metaphor === 'cycle' ? ('cycle' as const) : ('precedes' as const),
    source: entity.id,
    target:
      entities[
        testCase.metaphor === 'cycle'
          ? (index + 1) % entities.length
          : Math.min(index + 1, entities.length - 1)
      ]!.id,
    modality: 'certain' as const,
    order: index,
  }));
  if (testCase.metaphor === 'timeline') relations.pop();
  const sg: SemanticGraph = {
    schemaVersion: 'sg/1',
    utterance: testCase.utterance,
    language: 'en',
    entities,
    relations,
  };
  const anchorId = testCase.metaphor === 'cycle' ? 'v_cycle' : 'v_timeline';
  const plan: VisualPlan = {
    schemaVersion: 'vp/1',
    sgRef: createSgRef(sg),
    anchor: anchorId,
    scenes: [
      {
        id: `scene_${testCase.metaphor}`,
        metaphor: testCase.metaphor,
        dimension: '2d',
        nodes: [
          {
            id: anchorId,
            primitive: testCase.metaphor === 'cycle' ? 'cycle_ring' : 'timeline_axis',
            label: testCase.metaphor === 'cycle' ? 'Water cycle' : 'Pasta timeline',
            role: 'anchor',
          },
          ...entities.map((entity) => ({
            id: entity.id,
            primitive: 'labeled_card' as const,
            label: entity.surface,
            role: 'context' as const,
          })),
        ],
        edges: relations.map((relation) => ({
          id: `ve_${relation.id}`,
          from: relation.source,
          to: relation.target,
          kind: 'arrow' as const,
          animated: true,
        })),
      },
    ],
  };
  return layoutVisualPlan(plan, sg, { seed: 7 });
}

async function openInjectedDiagram(page: Page, osg: OSG): Promise<void> {
  await page.route('**/v1/visualize', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: `event: done\ndata: ${JSON.stringify({ stage: 'done', osg })}\n\n`,
    });
  });
  await page.goto('/');
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await page.getByLabel(/type a sentence/i).fill(osg.utterance);
  await page.getByRole('button', { name: 'Draw it' }).click();
  await expect(page.locator('.opsis-editor__flow')).toBeVisible();
  await page.waitForTimeout(500);
}

async function expectRenderedNodesNotToOverlap(page: Page): Promise<void> {
  const overlaps = await page.locator('.react-flow__node:visible').evaluateAll((elements) => {
    const nodes = elements.map((element) => ({
      id: element.getAttribute('data-id') ?? 'unknown',
      bounds: element.getBoundingClientRect(),
    }));
    return nodes.flatMap((left, index) =>
      nodes.slice(index + 1).flatMap((right) => {
        const width =
          Math.min(left.bounds.right, right.bounds.right) -
          Math.max(left.bounds.left, right.bounds.left);
        const height =
          Math.min(left.bounds.bottom, right.bounds.bottom) -
          Math.max(left.bounds.top, right.bounds.top);
        return width > 0.5 && height > 0.5
          ? [`${left.id}/${right.id}: ${width.toFixed(1)}×${height.toFixed(1)}px`]
          : [];
      }),
    );
  });
  expect(overlaps, 'rendered React Flow node bounds must not overlap').toEqual([]);
}

test.use({ reducedMotion: 'reduce', viewport: { width: 1280, height: 900 } });

test('sun/east North Star scene', async ({ page }) => {
  await openSample(page, 'The sun rises in the east.');
  await expect(page.locator('.opsis-editor__flow')).toBeVisible();
  await expectRenderedNodesNotToOverlap(page);
  const compass = page.locator('[data-primitive="compass"]');
  await expect(compass).toHaveAttribute('data-highlight-anchors', /(^| )E( |$)/u);
  await expect(compass.getByRole('img', { name: /compass rose; east highlighted/i })).toBeVisible();
  await expect(page.locator('[data-primitive="sun"] .opsis-flow-primitive__horizon')).toBeVisible();
  await expect(page.locator('.opsis-app')).toHaveScreenshot('sun-east.png');
});

test('sandwich North Star assembled and exploded', async ({ page }) => {
  await openSample(page, 'A sandwich can contain bread, tomato, ham.');
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.locator('.opsis-app')).toHaveScreenshot('sandwich-assembled.png');
  await page.getByRole('button', { name: 'Explode' }).click();
  await expect(page.getByRole('button', { name: 'Assemble' })).toBeVisible();
  await expect(page.locator('.opsis-app')).toHaveScreenshot('sandwich-exploded.png');
});

test('cycle flow', async ({ page }) => {
  const osg = await flowOsg({
    utterance: 'Water evaporates, forms clouds, and falls as rain.',
    metaphor: 'cycle',
    labels: ['Evaporate', 'Clouds form', 'Rain falls', 'Water collects'],
  });
  await openInjectedDiagram(page, osg);
  await expectRenderedNodesNotToOverlap(page);
  await expect(page.locator('.opsis-app')).toHaveScreenshot('cycle-flow.png');
});

test('timeline flow', async ({ page }) => {
  const osg = await flowOsg({
    utterance: 'First you boil water, then add pasta, then drain it.',
    metaphor: 'timeline',
    labels: ['Boil water', 'Add pasta', 'Drain pasta'],
  });
  await openInjectedDiagram(page, osg);
  await expectRenderedNodesNotToOverlap(page);
  await expect(page.locator('.opsis-app')).toHaveScreenshot('timeline-flow.png');
});
