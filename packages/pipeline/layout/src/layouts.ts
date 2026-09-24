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

function semanticNodeOrder(sg: SemanticGraph, id: string): [number, number, string] {
  const relation = sg.relations.find((item) => item.target === id && item.order !== undefined);
  const entity = sg.entities.find((item) => item.id === id);
  return [relation?.order ?? Infinity, entity?.span[0] ?? Infinity, id];
}

function compareSemantic(sg: SemanticGraph, left: VisualNode, right: VisualNode): number {
  const a = semanticNodeOrder(sg, left.id);
  const b = semanticNodeOrder(sg, right.id);
  return a[0] - b[0] || a[1] - b[1] || a[2].localeCompare(b[2]);
}

/**
 * Assigns a stable longest-path rank to each strongly connected component. Cycles stay together,
 * while every edge between components advances left-to-right. Sorting by semantic spans and ids
 * makes the result independent of incidental VP array order (important after canvas edits).
 */
export function semanticRanks(scene: SceneIntent, sg: SemanticGraph): ReadonlyMap<string, number> {
  const ids = [...scene.nodes]
    .sort((left, right) => compareSemantic(sg, left, right))
    .map((node) => node.id);
  const present = new Set(ids);
  const outgoing = new Map(ids.map((id) => [id, [] as string[]]));
  for (const edge of scene.edges) {
    if (present.has(edge.from) && present.has(edge.to) && edge.from !== edge.to)
      outgoing.get(edge.from)?.push(edge.to);
  }
  for (const targets of outgoing.values()) targets.sort();

  let nextIndex = 0;
  const indices = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];
  const visit = (id: string): void => {
    const index = nextIndex++;
    indices.set(id, index);
    low.set(id, index);
    stack.push(id);
    onStack.add(id);
    for (const target of outgoing.get(id) ?? []) {
      if (!indices.has(target)) {
        visit(target);
        low.set(id, Math.min(low.get(id)!, low.get(target)!));
      } else if (onStack.has(target)) low.set(id, Math.min(low.get(id)!, indices.get(target)!));
    }
    if (low.get(id) !== indices.get(id)) return;
    const component: string[] = [];
    let member: string;
    do {
      member = stack.pop()!;
      onStack.delete(member);
      component.push(member);
    } while (member !== id);
    components.push(component.sort());
  };
  ids.forEach((id) => {
    if (!indices.has(id)) visit(id);
  });

  const componentOf = new Map<string, number>();
  components.forEach((component, index) => component.forEach((id) => componentOf.set(id, index)));
  const componentEdges = new Map(components.map((_, index) => [index, new Set<number>()]));
  const indegree = new Map(components.map((_, index) => [index, 0]));
  for (const [source, targets] of outgoing) {
    const from = componentOf.get(source)!;
    for (const target of targets) {
      const to = componentOf.get(target)!;
      if (from === to || componentEdges.get(from)!.has(to)) continue;
      componentEdges.get(from)!.add(to);
      indegree.set(to, indegree.get(to)! + 1);
    }
  }
  const componentKey = (index: number) => components[index]![0]!;
  const queue = components
    .map((_, index) => index)
    .filter((index) => indegree.get(index) === 0)
    .sort((a, b) => componentKey(a).localeCompare(componentKey(b)));
  const componentRank = new Map(components.map((_, index) => [index, 0]));
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const target of [...componentEdges.get(current)!].sort((a, b) =>
      componentKey(a).localeCompare(componentKey(b)),
    )) {
      componentRank.set(
        target,
        Math.max(componentRank.get(target)!, componentRank.get(current)! + 1),
      );
      indegree.set(target, indegree.get(target)! - 1);
      if (indegree.get(target) === 0) {
        queue.push(target);
        queue.sort((a, b) => componentKey(a).localeCompare(componentKey(b)));
      }
    }
  }
  return new Map(ids.map((id) => [id, componentRank.get(componentOf.get(id)!) ?? 0]));
}

function placeRanks(
  scene: SceneIntent,
  sg: SemanticGraph,
  ranks: ReadonlyMap<string, number>,
): MutablePositionedNode[] {
  const groups = new Map<number, VisualNode[]>();
  for (const node of scene.nodes) {
    const rank = ranks.get(node.id) ?? 0;
    groups.set(rank, [...(groups.get(rank) ?? []), node]);
  }
  const rankIds = [...groups.keys()].sort((a, b) => a - b);
  const widths = new Map(
    rankIds.map((rank) => [rank, Math.max(...groups.get(rank)!.map((node) => sizeFor(node)[0]))]),
  );
  const centres = new Map<number, number>();
  let cursor = 0;
  for (const rank of rankIds) {
    const width = widths.get(rank)!;
    centres.set(rank, cursor + width / 2);
    cursor += width + 2.2;
  }
  const midpoint = Math.max(0, cursor - 2.2) / 2;
  const result: MutablePositionedNode[] = [];
  for (const rank of rankIds) {
    let lane = 0;
    for (const node of groups.get(rank)!.sort((a, b) => compareSemantic(sg, a, b))) {
      const output = positioned(node, [centres.get(rank)! - midpoint, 0, 0]);
      output.position[1] = -lane - output.size[1] / 2;
      lane += output.size[1] + 1.1;
      result.push(output);
    }
  }
  ensureSeparated(result, 'assembled');
  return result;
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
  if (!/^[a-z .-]+$/iu.test(label.trim())) return undefined;
  return BEARINGS[label.toLowerCase().replace(/[^a-z]/gu, '')];
}

function compass(
  scene: SceneIntent,
  sg: SemanticGraph,
  random: SeededRandom,
): MutablePositionedNode[] {
  const anchor = scene.nodes.find((node) => node.role === 'anchor');
  const others = scene.nodes.filter((node) => node !== anchor);
  const radius = Math.max(4.2, others.length * 0.75);
  const used = new Map<number, number>();
  const fallbackPhase = random.angle();
  const directBearing = (node: VisualNode): number | undefined => {
    const direct = bearing(node.label);
    if (direct !== undefined) return direct;
    for (const relation of sg.relations) {
      if (relation.type !== 'direction' || relation.source !== node.id) continue;
      const target = sg.entities.find((entity) => entity.id === relation.target);
      const inferred = target ? (bearing(target.lemma) ?? bearing(target.surface)) : undefined;
      if (inferred !== undefined) return inferred;
    }
    return undefined;
  };
  const byId = new Map(scene.nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, VisualEdge[]>();
  for (const edge of scene.edges)
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge]);
  const pathToBearing = (
    node: VisualNode,
    visited: ReadonlySet<string> = new Set(),
  ): { angle: number; distance: number } | undefined => {
    const direct = directBearing(node);
    if (direct !== undefined) return { angle: direct, distance: 0 };
    if (visited.has(node.id)) return undefined;
    const nextVisited = new Set(visited).add(node.id);
    return (outgoing.get(node.id) ?? [])
      .map((edge) => byId.get(edge.to))
      .filter((target): target is VisualNode => target !== undefined)
      .map((target) => pathToBearing(target, nextVisited))
      .filter((item): item is { angle: number; distance: number } => item !== undefined)
      .map((item) => ({ ...item, distance: item.distance + 1 }))
      .sort((left, right) => left.distance - right.distance)[0];
  };
  const resolved = new Map(others.map((node) => [node.id, pathToBearing(node)] as const));
  const bearingGroups = new Map<number, VisualNode[]>();
  for (const node of others) {
    const angle = resolved.get(node.id)?.angle;
    if (angle !== undefined) bearingGroups.set(angle, [...(bearingGroups.get(angle) ?? []), node]);
  }
  const result = anchor ? [positioned(anchor, [0, 0, -0.45])] : [];
  others.forEach((node, index) => {
    const path = resolved.get(node.id);
    const semanticBearing = path?.angle;
    let base =
      semanticBearing ?? fallbackPhase + (index * Math.PI * 2) / Math.max(1, others.length);
    if (semanticBearing === undefined) {
      const angularDistance = (left: number, right: number) =>
        Math.abs(Math.atan2(Math.sin(left - right), Math.cos(left - right)));
      for (let attempt = 0; attempt < others.length * 2; attempt += 1) {
        if (![...used.keys()].some((angle) => angularDistance(angle, base) < 0.45)) break;
        base += 0.45;
      }
    }
    used.set(base, (used.get(base) ?? 0) + 1);
    const group = semanticBearing === undefined ? [] : (bearingGroups.get(semanticBearing) ?? []);
    const orderedGroup = [...group].sort((left, right) => {
      const leftDistance = resolved.get(left.id)?.distance ?? 0;
      const rightDistance = resolved.get(right.id)?.distance ?? 0;
      return rightDistance - leftDistance || compareSemantic(sg, left, right);
    });
    const radialIndex = Math.max(
      0,
      orderedGroup.findIndex((item) => item.id === node.id),
    );
    const radialDistance = radius + radialIndex * 2.2;
    const perpendicularOffset = node.role === 'modifier' ? 1.7 : node.role === 'actor' ? 0.75 : 0;
    result.push(
      positioned(node, [
        Math.cos(base) * radialDistance - Math.sin(base) * perpendicularOffset,
        Math.sin(base) * radialDistance + Math.cos(base) * perpendicularOffset,
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
  // Non-explodable parts ride along in the exploded column so they never sit under a moved part.
  const gaps = partNodes.map((node, index) => {
    const below = partNodes[index + 1];
    return below && (node.explodable || below.explodable) ? node.size[1] * 1.5 : 0;
  });
  let explodedTop =
    partNodes.reduce((sum, node, index) => sum + node.size[1] + (gaps[index] ?? 0), 0) / 2;
  partNodes.forEach((node, index) => {
    node.explodedPosition = [0, explodedTop - node.size[1] / 2, 0];
    explodedTop -= node.size[1] + (gaps[index] ?? 0);
  });
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
  sg: SemanticGraph,
  direction: 'RIGHT' | 'DOWN',
): Promise<MutablePositionedNode[]> {
  if (direction === 'RIGHT') return placeRanks(scene, sg, semanticRanks(scene, sg));
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

function actorAction(scene: SceneIntent, sg: SemanticGraph): MutablePositionedNode[] {
  const graphRanks = semanticRanks(scene, sg);
  const ranks = new Map<string, number>();
  for (const node of scene.nodes) {
    // Roles are the grammar: actors approach actions from the left; objects receive them rightward.
    ranks.set(
      node.id,
      node.role === 'actor'
        ? 0
        : node.role === 'anchor' || node.role === 'modifier'
          ? 1
          : node.role === 'object'
            ? 2
            : (graphRanks.get(node.id) ?? 1),
    );
  }
  return placeRanks(scene, sg, ranks);
}

/** Runs the metaphor-specific deterministic layout from PROMPT.md §10.2. */
export async function layoutScene(
  input: SceneIntent,
  sg: SemanticGraph,
  seed: number,
): Promise<{ nodes: PositionedNode[]; edges: VisualEdge[] }> {
  const random = new SeededRandom(seed);
  // Every layout (including ELK model order and collision nudging) sees one semantic order, so
  // positions never depend on incidental VP array order after canvas edits.
  const semanticIndex = new Map(
    [...input.nodes]
      .sort((left, right) => compareSemantic(sg, left, right))
      .map((node, index) => [node.id, index]),
  );
  const edgeKey = (edge: VisualEdge): [number, number, string] => [
    semanticIndex.get(edge.from) ?? Infinity,
    semanticIndex.get(edge.to) ?? Infinity,
    edge.id,
  ];
  const scene: SceneIntent = {
    ...input,
    nodes: [...input.nodes].sort(
      (left, right) => semanticIndex.get(left.id)! - semanticIndex.get(right.id)!,
    ),
    edges: [...input.edges].sort((left, right) => {
      const a = edgeKey(left);
      const b = edgeKey(right);
      return a[0] - b[0] || a[1] - b[1] || a[2].localeCompare(b[2]);
    }),
  };
  let nodes: MutablePositionedNode[];
  switch (scene.metaphor) {
    case 'compass':
    case 'map':
      nodes = compass(scene, sg, random);
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
      nodes = await layered(scene, sg, 'RIGHT');
      break;
    case 'tree':
      nodes = await layered(scene, sg, 'DOWN');
      break;
    case 'scale':
      nodes = scale(scene, sg);
      break;
    case 'actor_action':
      nodes = actorAction(scene, sg);
      break;
  }
  for (const node of nodes) {
    if (node.explodable && !node.explodedPosition) {
      node.explodedPosition = [node.position[0], node.position[1], node.position[2]];
    }
  }
  // Output keeps the plan's array order; only the geometry is order-independent.
  const planIndex = new Map(input.nodes.map((node, index) => [node.id, index]));
  nodes.sort((left, right) => planIndex.get(left.id)! - planIndex.get(right.id)!);
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
  return { nodes, edges: [...input.edges, ...leaders] };
}
