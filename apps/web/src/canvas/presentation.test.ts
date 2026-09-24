import type { MetaphorId, OSG, PositionedNode, VisualEdge } from '@opsis/schema';
import { describe, expect, it } from 'vitest';
import { loadFixture } from '../scene/fixtures';
import { clampPresentationStep, createPresentationPlan } from './presentation';

type TestNode = Pick<PositionedNode, 'id' | 'label' | 'position' | 'role'>;

function diagram(metaphor: MetaphorId, nodes: TestNode[], edges: VisualEdge[]): OSG {
  const positioned = nodes.map((node): PositionedNode => ({
    ...node,
    primitive: 'labeled_card',
    size: [1, 1, 0.2],
  }));
  return {
    schemaVersion: 'osg/1',
    id: '00000000-0000-4000-8000-000000000001',
    title: 'Test diagram',
    utterance: nodes.map((node) => node.label).join(' '),
    createdAt: '2026-09-24T00:00:00.000Z',
    seed: 7,
    sg: {
      schemaVersion: 'sg/1',
      utterance: nodes.map((node) => node.label).join(' '),
      language: 'en',
      entities: nodes
        .filter((node) => !node.id.startsWith('v_'))
        .map((node, index) => ({
          id: node.id,
          surface: node.label,
          lemma: node.label.toLocaleLowerCase(),
          kind: 'abstract_concept',
          span: [index * 2, index * 2 + 1] as [number, number],
          summary: node.label,
        })),
      relations: edges.map((edge, index) => ({
        id: `r_${index}`,
        type: metaphor === 'cycle' ? 'cycle' : metaphor === 'timeline' ? 'precedes' : 'causes',
        source: edge.from,
        target: edge.to,
        modality: 'certain',
        order: index,
      })),
    },
    scenes: [
      {
        id: `scene_${metaphor}`,
        metaphor,
        dimension: '2d',
        nodes: positioned,
        edges,
        bounds: { min: [-10, -10, -1], max: [10, 10, 1] },
      },
    ],
    breadcrumbs: [],
  };
}

const node = (
  id: string,
  label: string,
  x: number,
  y = 0,
  role: PositionedNode['role'] = 'context',
): TestNode => ({ id, label, position: [x, y, 0], role });

const arrow = (id: string, from: string, to: string, kind: VisualEdge['kind'] = 'arrow') => ({
  id,
  from,
  to,
  kind,
});

describe('OSG-derived canvas presentation', () => {
  it('presents the North Star in sentence order without mutating the canonical OSG', () => {
    const osg = loadFixture('sun-east');
    const before = structuredClone(osg);
    const plan = createPresentationPlan(osg);
    expect(plan.steps.map((step) => step.selectedNodeId)).toEqual(['e_sun', 'e_rises', 'e_east']);
    expect(plan.steps[0]?.visibleNodeIds).toEqual(['v_compass', 'v_horizon', 'e_sun']);
    expect(plan.steps[1]?.emphasizedEdgeIds).toEqual(['ve_motion']);
    expect(osg).toEqual(before);
  });

  it.each([
    {
      name: 'cycle',
      osg: diagram(
        'cycle',
        [
          node('v_cycle', 'Cycle', 0, 0, 'anchor'),
          node('a', 'Evaporate', 0),
          node('b', 'Clouds', 1),
          node('c', 'Rain', 2),
        ],
        [arrow('ab', 'a', 'b'), arrow('bc', 'b', 'c'), arrow('ca', 'c', 'a')],
      ),
      order: ['a', 'b', 'c'],
    },
    {
      name: 'timeline',
      osg: diagram(
        'timeline',
        [
          node('v_timeline', 'Timeline', 0, 0, 'anchor'),
          node('drain', 'Drain', 4),
          node('boil', 'Boil', 0),
          node('add', 'Add pasta', 2),
        ],
        [arrow('boil-add', 'boil', 'add'), arrow('add-drain', 'add', 'drain')],
      ),
      order: ['boil', 'add', 'drain'],
    },
    {
      name: 'transformation',
      osg: diagram(
        'flow',
        [node('water', 'Water', 3, 0, 'object'), node('ice', 'Ice', 0, 0, 'actor')],
        [arrow('melts', 'ice', 'water', 'path')],
      ),
      order: ['ice', 'water'],
    },
    {
      name: 'input/output flow',
      osg: diagram(
        'flow',
        [
          node('oxygen', 'Oxygen', 4, -1, 'object'),
          node('plant', 'Plant', 2, 0, 'anchor'),
          node('water', 'Water', 0, -1),
          node('sun', 'Sunlight', 0, 1),
          node('sugar', 'Sugar', 4, 1, 'object'),
        ],
        [
          arrow('water-plant', 'water', 'plant'),
          arrow('sun-plant', 'sun', 'plant'),
          arrow('plant-sugar', 'plant', 'sugar'),
          arrow('plant-oxygen', 'plant', 'oxygen'),
        ],
      ),
      order: ['sun', 'water', 'plant', 'sugar', 'oxygen'],
    },
  ])('reveals $name in a comprehensible oriented order', ({ osg, order }) => {
    const plan = createPresentationPlan(osg);
    expect(plan.steps.map((step) => step.selectedNodeId)).toEqual(order);
    for (let index = 1; index < plan.steps.length; index += 1) {
      expect(plan.steps[index]?.visibleNodeIds).toEqual(
        expect.arrayContaining(Array.from(plan.steps[index - 1]?.visibleNodeIds ?? [])),
      );
    }
    expect(plan.steps.at(-1)?.visibleEdgeIds).toHaveLength(osg.scenes[0]?.edges.length ?? 0);
  });

  it('is stable when scene arrays are reordered and clamps scrub input', () => {
    const osg = diagram(
      'flow',
      [node('a', 'A', 0, 0, 'anchor'), node('b', 'B', 1), node('c', 'C', 2)],
      [arrow('ab', 'a', 'b'), arrow('bc', 'b', 'c')],
    );
    const reordered: OSG = {
      ...osg,
      scenes: [
        {
          ...osg.scenes[0]!,
          nodes: [...osg.scenes[0]!.nodes].reverse(),
          edges: [...osg.scenes[0]!.edges].reverse(),
        },
      ],
    };
    expect(createPresentationPlan(reordered)).toEqual(createPresentationPlan(osg));
    expect(clampPresentationStep(-4, 3)).toBe(0);
    expect(clampPresentationStep(20, 3)).toBe(2);
  });
});
