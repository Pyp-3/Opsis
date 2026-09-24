import ELK from 'elkjs/lib/elk.bundled.js';
import type {
  PositionedNode,
  SceneIntent,
  SemanticGraph,
  VisualEdge,
  VisualNode,
} from '@opsis/schema';
import { nodesOverlap } from './geometry';
import { SeededRandom } from './random';
import type { MutablePositionedNode, Vector3 } from './types';

const elk = new ELK();
const PRIMITIVE_SIZE: Partial<Record<VisualNode['primitive'], Vector3>> = {
  compass: [2.8, 2.8, 0.25],
  cycle_ring: [2.2, 2.2, 0.2],
  timeline_axis: [1.8, 0.25, 0.2],
  scale_balance: [7, 0.3, 0.3],
  arrow: [1.4, 0.55, 0.2],
  curved_arrow: [1.4, 0.8, 0.2],
  bread_slice: [3.2, 0.7, 2.2],
  generic_layer: [3, 0.55, 2],
  stack_layer: [3, 0.55, 2],
  slice: [2.8, 0.5, 1.9],
  group_frame: [1.8, 1, 0.25],
  box: [1.8, 1.2, 0.25],
  bowl: [1.8, 1.2, 0.25],
  cell: [1.8, 1.8, 0.25],
  person: [1, 1.8, 0.6],
  sun: [1.2, 1.2, 1.2],
};

function sizeFor(node: VisualNode): Vector3 {
  const base = PRIMITIVE_SIZE[node.primitive];
  return base
    ? [...base]
    : [Math.max(1.25, Math.min(2.8, 0.32 * node.label.length + 0.7)), 0.9, 0.5];
}

function positioned(node: VisualNode, position: Vector3): MutablePositionedNode {
  return { ...node, position, size: sizeFor(node) };
}

function relationOrder(sg: SemanticGraph, id: string): number {
  return sg.relations.find((relation) => relation.target === id)?.order ?? Infinity;
}

function ensureSeparated(nodes: MutablePositionedNode[], state: 'assembled' | 'exploded'): void {
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (!node) continue;
    for (let attempt = 0; attempt < nodes.length * 4; attempt += 1) {
      const collision = nodes.slice(0, index).find((other) => nodesOverlap(node, other, state));
      if (!collision) break;
      const target =
        state === 'exploded' && node.explodedPosition ? node.explodedPosition : node.position;
      const other =
        state === 'exploded' && collision.explodedPosition
          ? collision.explodedPosition
          : collision.position;
      const rawDx = target[0] - other[0];
      const rawDy = target[1] - other[1];
      const dx = rawDx === 0 && rawDy === 0 ? 1 : rawDx;
      const dy = rawDx === 0 && rawDy === 0 ? 0 : rawDy;
      const magnitude = Math.hypot(dx, dy);
      const shift =
        Math.max(node.size[0], node.size[1], collision.size[0], collision.size[1]) * 0.6 + 0.2;
      const next: Vector3 = [
        target[0] + (dx / magnitude) * shift,
        target[1] + (dy / magnitude) * shift,
        target[2],
      ];
      if (state === 'exploded') node.explodedPosition = next;
      else node.position = next;
    }
  }
}

const BEARINGS: Record<string, number> = {
  north: Math.PI / 2,
  northeast: Math.PI / 4,
  east: 0,
  southeast: -Math.PI / 4,
  south: -Math.PI / 2,
  southwest: (-3 * Math.PI) / 4,
  west: Math.PI,
  northwest: (3 * Math.PI) / 4,
  n: Math.PI / 2,
  ne: Math.PI / 4,
  e: 0,
  se: -Math.PI / 4,
  s: -Math.PI / 2,
  sw: (-3 * Math.PI) / 4,
  w: Math.PI,
  nw: (3 * Math.PI) / 4,
};

function bearing(label: string): number | undefined {
  return BEARINGS[label.toLowerCase().replace(/[^a-z]/gu, '')];
}

function compass(scene: SceneIntent, random: SeededRandom): MutablePositionedNode[] {
  const anchor = scene.nodes.find((node) => node.role === 'anchor');
  const others = scene.nodes.filter((node) => node !== anchor);
  const radius = Math.max(4.2, others.length * 0.75);
  const used = new Map<number, number>();
  const fallbackPhase = random.angle();
  const result = anchor ? [positioned(anchor, [0, 0, -0.45])] : [];
  others.forEach((node, index) => {
    const base =
      bearing(node.label) ?? fallbackPhase + (index * Math.PI * 2) / Math.max(1, others.length);
    const duplicate = used.get(base) ?? 0;
    used.set(base, duplicate + 1);
    const angle = base + duplicate * 0.2;
    result.push(
      positioned(node, [
        Math.cos(angle) * (radius + duplicate * 1.6),
        Math.sin(angle) * (radius + duplicate * 1.6),
        0,
      ]),
    );
  });
  ensureSeparated(result, 'assembled');
  return result;
}

function stack(scene: SceneIntent, sg: SemanticGraph): MutablePositionedNode[] {
  const anchor = scene.nodes.find((node) => node.role === 'anchor');
  const parts = scene.nodes
    .filter((node) => node !== anchor)
    .sort((a, b) => relationOrder(sg, a.id) - relationOrder(sg, b.id) || a.id.localeCompare(b.id));
  const partNodes = parts.map((node) => positioned(node, [0, 0, 0]));
  let top = partNodes.reduce((sum, node) => sum + node.size[1], 0) / 2;
  for (const node of partNodes) {
    node.position = [0, top - node.size[1] / 2, 0];
    top -= node.size[1];
  }
  let explodedTop = partNodes.reduce((sum, node) => sum + node.size[1] * 2.5, 0) / 2;
  for (const node of partNodes) {
    if (node.explodable) {
      node.explodedPosition = [0, explodedTop - node.size[1] / 2, 0];
      explodedTop -= node.size[1] * 2.5;
    }
  }
  const maxWidth = Math.max(1, ...partNodes.map((node) => node.size[0]));
  if (!anchor) return partNodes;
  const anchorNode = positioned(anchor, [0, 0, 0]);
  anchorNode.position = [-maxWidth / 2 - anchorNode.size[0] / 2 - 1, 0, 0];
  return [anchorNode, ...partNodes];
}

function packedPositions(count: number, radius: number, phase: number): Vector3[] {
  if (count === 0) return [];
  const result: Vector3[] = [[0, 0, 0]];
  for (let index = 1; index < count; index += 1) {
    const angle = phase + index * 2.399963229728653;
    const distance = radius * Math.sqrt(index / Math.max(1, count - 1));
    result.push([Math.cos(angle) * distance, Math.sin(angle) * distance, 0]);
  }
  return result;
}

function container(scene: SceneIntent, random: SeededRandom): MutablePositionedNode[] {
  const anchor = scene.nodes.find((node) => node.role === 'anchor');
  const children = scene.nodes.filter((node) => node !== anchor);
  const phase = random.angle();
  const cell = Math.max(
    1.3,
    ...children.map((node) => Math.max(...sizeFor(node).slice(0, 2)) + 0.3),
  );
  const packingRadius = Math.max(0, Math.ceil(Math.sqrt(children.length)) - 1) * cell;
  const locations = packedPositions(children.length, packingRadius, phase);
  const childNodes = children.map((node, index) => positioned(node, locations[index] ?? [0, 0, 0]));
  ensureSeparated(childNodes, 'assembled');
  const outerRadius = Math.max(3, packingRadius + cell);
  childNodes.forEach((node, index) => {
    if (!node.explodable) return;
    const angle = phase + (index * Math.PI * 2) / Math.max(1, childNodes.length);
    const orbit = Math.max(outerRadius + 2, (childNodes.length * cell) / (2 * Math.PI) + 1);
    node.explodedPosition = [Math.cos(angle) * orbit, Math.sin(angle) * orbit, 0];
  });
  ensureSeparated(childNodes, 'exploded');
  if (!anchor) return childNodes;
  const anchorNode = positioned(anchor, [0, 0, -0.7]);
  anchorNode.size = [outerRadius * 2, outerRadius * 2, 0.2];
  return [anchorNode, ...childNodes];
}

function cycle(scene: SceneIntent, random: SeededRandom): MutablePositionedNode[] {
  const anchor = scene.nodes.find((node) => node.role === 'anchor');
  const members = scene.nodes.filter((node) => node !== anchor);
  const radius = Math.max(3.4, members.length * 0.7);
  const phase = random.angle();
  const result = members.map((node, index) => {
    const angle = phase - (index * Math.PI * 2) / Math.max(1, members.length);
    return positioned(node, [Math.cos(angle) * radius, Math.sin(angle) * radius, 0]);
  });
  if (anchor) {
    const ring = positioned(anchor, [0, 0, -0.6]);
    ring.size = [radius * 1.45, radius * 1.45, 0.2];
    result.unshift(ring);
  }
  ensureSeparated(result, 'assembled');
  return result;
}

async function layered(
  scene: SceneIntent,
  direction: 'RIGHT' | 'DOWN',
): Promise<MutablePositionedNode[]> {
  const nodes = scene.nodes.map((node) => ({ node, size: sizeFor(node) }));
  const reverse = scene.metaphor === 'tree';
  const graph = await elk.layout({
    id: `elk_${scene.id}`,
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': direction,
      'elk.spacing.nodeNode': '90',
      'elk.layered.spacing.nodeNodeBetweenLayers': '130',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.randomSeed': '1',
    },
    children: nodes.map(({ node, size }) => ({
      id: node.id,
      width: size[0] * 100,
      height: size[1] * 100,
    })),
    edges: scene.edges.map((edge) => ({
      id: edge.id,
      sources: [reverse ? edge.to : edge.from],
      targets: [reverse ? edge.from : edge.to],
    })),
  });
  const output = new Map((graph.children ?? []).map((node) => [node.id, node]));
  const result = nodes.map(({ node, size }, index): MutablePositionedNode => {
    const laid = output.get(node.id);
    return {
      ...node,
      size,
      position: [
        ((laid?.x ?? index * 200) + (laid?.width ?? size[0] * 100) / 2) / 100,
        -((laid?.y ?? 0) + (laid?.height ?? size[1] * 100) / 2) / 100,
        0,
      ],
    };
  });
  ensureSeparated(result, 'assembled');
  return result;
}

function scale(scene: SceneIntent, sg: SemanticGraph): MutablePositionedNode[] {
  const anchor = scene.nodes.find((node) => node.role === 'anchor');
  const items = scene.nodes.filter((node) => node !== anchor);
  const left = items.filter((_, index) => index % 2 === 0);
  const right = items.filter((_, index) => index % 2 === 1);
  const place = (node: VisualNode, index: number, side: -1 | 1) =>
    positioned(node, [side * (2.7 + Math.floor(index / 2) * 1.8), 0.9 + (index % 2) * 1.3, 0]);
  const result = [
    ...left.map((node, index) => place(node, index, -1)),
    ...right.map((node, index) => place(node, index, 1)),
  ];
  if (anchor) {
    const balance = positioned(anchor, [0, 0, -0.55]);
    const comparison = sg.relations.find((relation) => relation.type === 'compares');
    const source = sg.entities.find((entity) => entity.id === comparison?.source);
    const target = sg.entities.find((entity) => entity.id === comparison?.target);
    const text =
      `${String(source?.attributes?.comparative ?? '')} ${source?.surface ?? ''}`.toLowerCase();
    const numeric = (entity: typeof source) =>
      Object.values(entity?.attributes ?? {}).find(
        (value): value is number => typeof value === 'number',
      );
    const leftValue = numeric(source);
    const rightValue = numeric(target);
    const direction = /lighter|less|smaller|shorter|lower/u.test(text) ? -1 : 1;
    const proportion =
      leftValue !== undefined && rightValue !== undefined
        ? Math.min(
            1,
            Math.abs(leftValue - rightValue) /
              Math.max(1, Math.abs(leftValue), Math.abs(rightValue)),
          )
        : 0.48;
    balance.rotation = [0, 0, direction * Math.max(0.04, proportion * 0.25)];
    result.unshift(balance);
  }
  ensureSeparated(result, 'assembled');
  return result;
}

function actorAction(scene: SceneIntent): MutablePositionedNode[] {
  const actors = scene.nodes.filter((node) => node.role === 'actor');
  const objects = scene.nodes.filter((node) => node.role === 'object');
  const actions = scene.nodes.filter((node) => node.role === 'anchor' || node.role === 'modifier');
  const remaining = scene.nodes.filter(
    (node) => !actors.includes(node) && !objects.includes(node) && !actions.includes(node),
  );
  const ordered = [...actors, ...actions, ...remaining, ...objects];
  let cursor = 0;
  const result = ordered.map((node) => {
    const next = positioned(node, [0, 0, 0]);
    next.position = [cursor + next.size[0] / 2, 0, 0];
    cursor += next.size[0] + 1.5;
    return next;
  });
  const midpoint = cursor / 2;
  result.forEach((node) => {
    node.position = [node.position[0] - midpoint, node.position[1], node.position[2]];
  });
  return result;
}

/** Runs the metaphor-specific deterministic layout from PROMPT.md §10.2. */
export async function layoutScene(
  scene: SceneIntent,
  sg: SemanticGraph,
  seed: number,
): Promise<{ nodes: PositionedNode[]; edges: VisualEdge[] }> {
  const random = new SeededRandom(seed);
  let nodes: MutablePositionedNode[];
  switch (scene.metaphor) {
    case 'compass':
    case 'map':
      nodes = compass(scene, random);
      break;
    case 'stack':
      nodes = stack(scene, sg);
      break;
    case 'container':
      nodes = container(scene, random);
      break;
    case 'cycle':
      nodes = cycle(scene, random);
      break;
    case 'timeline':
    case 'flow':
      nodes = await layered(scene, 'RIGHT');
      break;
    case 'tree':
      nodes = await layered(scene, 'DOWN');
      break;
    case 'scale':
      nodes = scale(scene, sg);
      break;
    case 'actor_action':
      nodes = actorAction(scene);
      break;
  }
  for (const node of nodes) {
    if (node.explodable && !node.explodedPosition) {
      node.explodedPosition = [node.position[0], node.position[1], node.position[2]];
    }
  }
  const anchor = nodes.find((node) => node.role === 'anchor');
  const leaders =
    scene.metaphor === 'stack' && anchor
      ? nodes
          .filter((node) => node.explodable)
          .map((node) => ({
            id: `layout_leader_${node.id}`,
            from: anchor.id,
            to: node.id,
            kind: 'leader' as const,
          }))
      : [];
  return { nodes, edges: [...scene.edges, ...leaders] };
}
