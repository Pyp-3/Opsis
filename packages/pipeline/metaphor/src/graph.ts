import Graph from 'graphology';
import { connectedComponents, stronglyConnectedComponents } from 'graphology-components';
import { degreeCentrality } from 'graphology-metrics/centrality/degree';
import type { Relation, RelationType, SemanticGraph } from '@opsis/schema';

/** Relations that assert something structural; negated ones ("cannot contain") do not. */
export function assertedRelations(sg: SemanticGraph, types: readonly RelationType[]): Relation[] {
  return sg.relations.filter((r) => types.includes(r.type) && r.modality !== 'negated');
}

/** Directed multigraph over every SG entity, with one edge per given relation. */
export function relationGraph(sg: SemanticGraph, relations: readonly Relation[]): Graph {
  const graph = new Graph({ type: 'directed', multi: true, allowSelfLoops: true });
  for (const entity of sg.entities) graph.addNode(entity.id);
  for (const r of relations) {
    if (graph.hasNode(r.source) && graph.hasNode(r.target)) graph.addEdge(r.source, r.target);
  }
  return graph;
}

/** Entity id → position in the SG, used as the deterministic tie-break everywhere. */
export function entityOrder(sg: SemanticGraph): Map<string, number> {
  return new Map(sg.entities.map((e, i) => [e.id, i]));
}

function byEntityOrder(order: Map<string, number>) {
  return (a: string, b: string) => (order.get(a) ?? 0) - (order.get(b) ?? 0);
}

/**
 * Directed cycles over `relations` (strongly connected components with ≥ 2 members, or a
 * self-loop), largest first. Members are listed in walk order starting from the earliest entity.
 */
export function findCycles(sg: SemanticGraph, relations: readonly Relation[]): string[][] {
  const graph = relationGraph(sg, relations);
  const order = entityOrder(sg);
  const cycles: string[][] = [];
  for (const component of stronglyConnectedComponents(graph)) {
    const [only] = component;
    if (component.length === 1 && !(only !== undefined && graph.hasEdge(only, only))) continue;
    const members = new Set(component);
    const sorted = [...component].sort(byEntityOrder(order));
    const walk: string[] = [];
    let current = sorted[0];
    while (current !== undefined && !walk.includes(current)) {
      walk.push(current);
      current = graph
        .outNeighbors(current)
        .filter((n) => members.has(n) && !walk.includes(n))
        .sort(byEntityOrder(order))[0];
    }
    cycles.push([...walk, ...sorted.filter((n) => !walk.includes(n))]);
  }
  return cycles.sort((a, b) => b.length - a.length || byEntityOrder(order)(a[0] ?? '', b[0] ?? ''));
}

/** Longest directed path in an acyclic relation graph (ties: earliest entities win). */
export function longestPath(sg: SemanticGraph, relations: readonly Relation[]): string[] {
  const graph = relationGraph(sg, relations);
  const order = entityOrder(sg);
  const memo = new Map<string, string[]>();
  const visit = (node: string, stack: Set<string>): string[] => {
    const cached = memo.get(node);
    if (cached) return cached;
    stack.add(node);
    let best: string[] = [];
    for (const next of graph.outNeighbors(node).sort(byEntityOrder(order))) {
      if (stack.has(next)) continue;
      const tail = visit(next, stack);
      if (tail.length > best.length) best = tail;
    }
    stack.delete(node);
    const path = [node, ...best];
    memo.set(node, path);
    return path;
  };
  let longest: string[] = [];
  for (const node of [...graph.nodes()].sort(byEntityOrder(order))) {
    if (graph.degree(node) === 0) continue;
    const path = visit(node, new Set());
    if (path.length > longest.length) longest = path;
  }
  return longest;
}

/**
 * True when the relations form a single rooted tree where every edge points child → parent
 * (as `is_a` does). Returns the root, or undefined when they do not form a tree.
 */
export function treeRoot(sg: SemanticGraph, relations: readonly Relation[]): string | undefined {
  if (relations.length === 0) return undefined;
  const graph = new Graph({ type: 'directed', allowSelfLoops: true });
  for (const r of relations) {
    graph.mergeNode(r.source);
    graph.mergeNode(r.target);
    graph.mergeEdge(r.source, r.target);
  }
  if (graph.size !== graph.order - 1) return undefined;
  if (graph.nodes().some((n) => graph.outDegree(n) > 1)) return undefined;
  if (connectedComponents(graph).length !== 1) return undefined;
  const roots = graph.nodes().filter((n) => graph.outDegree(n) === 0);
  return roots.length === 1 ? roots[0] : undefined;
}

/** Undirected connected components over the given relations, in entity order. */
export function relationComponents(sg: SemanticGraph, relations: readonly Relation[]): string[][] {
  const graph = relationGraph(sg, relations);
  const order = entityOrder(sg);
  return connectedComponents(graph)
    .filter((c) => c.some((n) => graph.degree(n) > 0))
    .map((c) => [...c].sort(byEntityOrder(order)))
    .sort((a, b) => byEntityOrder(order)(a[0] ?? '', b[0] ?? ''));
}

/**
 * Entities ranked by graphology degree centrality over every relation, highest first.
 * `tied` lists every entity sharing the top score (in entity order).
 */
export function degreeRanking(sg: SemanticGraph): { ranked: string[]; tied: string[] } {
  const graph = relationGraph(sg, sg.relations);
  const order = entityOrder(sg);
  const scores = graph.order > 1 ? degreeCentrality(graph) : {};
  const score = (id: string) => scores[id] ?? 0;
  const ranked = [...graph.nodes()].sort(
    (a, b) => score(b) - score(a) || byEntityOrder(order)(a, b),
  );
  const top = ranked[0];
  const tied = top === undefined ? [] : ranked.filter((id) => score(id) === score(top));
  return { ranked, tied };
}
