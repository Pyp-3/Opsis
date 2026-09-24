import {
  OSGSchema,
  SemanticGraphSchema,
  visualPlanSchemaFor,
  type OSG,
  type PositionedScene,
  type SemanticGraph,
  type VisualPlan,
} from '@opsis/schema';
import { computeBounds } from './geometry';
import { layoutLabels } from './labels';
import { layoutScene } from './layouts';
import { timestampFromSeed, uuidFromSeed } from './random';
import type { AssembleOSGInput, LayoutOptions } from './types';

function titleFrom(utterance: string): string {
  const text = utterance.trim().replace(/[.!?]+$/u, '');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function breadcrumbLabel(title: string): string {
  return title.trim().split(/\s+/u).slice(0, 4).join(' ');
}

/** VP + SG → a complete, schema-validated OSG. */
export async function layoutVisualPlan(
  plan: VisualPlan,
  sg: SemanticGraph,
  options: LayoutOptions = {},
): Promise<OSG> {
  const parsedGraph = SemanticGraphSchema.parse(sg);
  const parsedPlan = visualPlanSchemaFor(parsedGraph).parse(plan);
  const seed = options.seed ?? 0;
  const id = uuidFromSeed(seed, `${parsedPlan.sgRef}:${parsedGraph.utterance}`);
  const scenes: PositionedScene[] = [];
  for (let index = 0; index < parsedPlan.scenes.length; index += 1) {
    const intent = parsedPlan.scenes[index];
    if (!intent) continue;
    const layout = await layoutScene(intent, parsedGraph, seed + index * 0x9e3779b9);
    const shell = { ...intent, nodes: layout.nodes, edges: layout.edges };
    scenes.push({
      ...shell,
      bounds: computeBounds(layout.nodes, layoutLabels(shell), layoutLabels(shell, 'exploded')),
    });
  }
  const title = options.title ?? titleFrom(parsedGraph.utterance);
  const document: OSG = {
    schemaVersion: 'osg/1',
    id,
    title,
    utterance: parsedGraph.utterance,
    createdAt: options.createdAt ?? timestampFromSeed(seed),
    seed,
    sg: parsedGraph,
    scenes,
    breadcrumbs: options.breadcrumbs ?? [{ id, label: breadcrumbLabel(title) }],
    ...(options.parentId === undefined ? {} : { parentId: options.parentId }),
  };
  return OSGSchema.parse(document);
}

/** Object-argument form useful at API and pipeline boundaries. */
export function assembleOSG(input: AssembleOSGInput): Promise<OSG> {
  const { plan, sg, ...options } = input;
  return layoutVisualPlan(plan, sg, options);
}
