import type { OSG, PositionedNode, PositionedScene } from '@opsis/schema';

export type PresentationStep = {
  id: string;
  title: string;
  description: string;
  visibleNodeIds: readonly string[];
  visibleEdgeIds: readonly string[];
  focusNodeIds: readonly string[];
  emphasizedEdgeIds: readonly string[];
  selectedNodeId: string | null;
};

export type PresentationPlan = {
  sceneId: string;
  steps: readonly PresentationStep[];
};

const directionalKinds = new Set(['arrow', 'path']);

function isBackdrop(node: PositionedNode): boolean {
  return node.id.startsWith('v_') || (node.role === 'context' && node.primitive === 'horizon');
}

function semanticIndex(osg: OSG, id: string): number {
  const entity = osg.sg.entities.find((candidate) => candidate.id === id);
  return entity?.span[0] ?? Number.MAX_SAFE_INTEGER;
}

function compareNodes(osg: OSG, left: PositionedNode, right: PositionedNode): number {
  return (
    semanticIndex(osg, left.id) - semanticIndex(osg, right.id) || left.id.localeCompare(right.id)
  );
}

/** Orders content using the oriented scene geometry, with text order as a stable tie-breaker. */
export function orderedPresentationNodes(osg: OSG, scene: PositionedScene): PositionedNode[] {
  const content = scene.nodes.filter((node) => !isBackdrop(node));
  if (
    scene.metaphor === 'flow' ||
    scene.metaphor === 'timeline' ||
    scene.metaphor === 'actor_action'
  ) {
    return [...content].sort(
      (left, right) =>
        left.position[0] - right.position[0] ||
        right.position[1] - left.position[1] ||
        compareNodes(osg, left, right),
    );
  }
  return [...content].sort((left, right) => compareNodes(osg, left, right));
}

function stepTitle(scene: PositionedScene, node: PositionedNode, index: number): string {
  if (scene.metaphor === 'compass') return `Orient to ${node.label}`;
  if (scene.metaphor === 'cycle') return `Cycle through ${node.label}`;
  if (scene.metaphor === 'timeline') return `${index === 0 ? 'First' : 'Then'}: ${node.label}`;
  if (scene.metaphor === 'flow') {
    const anchor = scene.nodes.find((candidate) => candidate.role === 'anchor');
    if (anchor && node.id !== anchor.id && node.position[0] < anchor.position[0])
      return `Input: ${node.label}`;
    if (anchor && node.id !== anchor.id && node.position[0] > anchor.position[0])
      return `Output: ${node.label}`;
  }
  return node.label;
}

/** Builds a deterministic, read-only reveal plan from one positioned OSG scene. */
export function createPresentationPlan(osg: OSG, sceneIndex = 0): PresentationPlan {
  const scene = osg.scenes[sceneIndex];
  if (!scene) return { sceneId: '', steps: [] };

  const backdropIds = scene.nodes
    .filter(isBackdrop)
    .map((node) => node.id)
    .sort((left, right) => left.localeCompare(right));
  const orderedEdges = [...scene.edges].sort(
    (left, right) =>
      semanticIndex(osg, left.from) - semanticIndex(osg, right.from) ||
      semanticIndex(osg, left.to) - semanticIndex(osg, right.to) ||
      left.id.localeCompare(right.id),
  );
  const ordered = orderedPresentationNodes(osg, scene);
  const revealed = new Set(backdropIds);
  const revealedEdges = new Set<string>();

  const steps = ordered.map((node, index): PresentationStep => {
    revealed.add(node.id);
    const justRevealedEdges = orderedEdges.filter(
      (edge) => !revealedEdges.has(edge.id) && revealed.has(edge.from) && revealed.has(edge.to),
    );
    justRevealedEdges.forEach((edge) => revealedEdges.add(edge.id));
    const neighbors = justRevealedEdges.flatMap((edge) => [edge.from, edge.to]);
    const focusNodeIds = [...new Set([node.id, ...neighbors])];
    return {
      id: `${scene.id}:${index}:${node.id}`,
      title: stepTitle(scene, node, index),
      description: `${index + 1} of ${ordered.length}: ${node.label}`,
      visibleNodeIds: [...revealed],
      visibleEdgeIds: [...revealedEdges],
      focusNodeIds,
      emphasizedEdgeIds: justRevealedEdges
        .filter((edge) => directionalKinds.has(edge.kind))
        .map((edge) => edge.id),
      selectedNodeId: node.id,
    };
  });

  // A backdrop-only or empty scene still gets one useful, deterministic presentation state.
  if (steps.length === 0) {
    steps.push({
      id: `${scene.id}:0:overview`,
      title: osg.title,
      description: osg.title,
      visibleNodeIds: backdropIds,
      visibleEdgeIds: orderedEdges
        .filter((edge) => revealed.has(edge.from) && revealed.has(edge.to))
        .map((edge) => edge.id),
      focusNodeIds: backdropIds,
      emphasizedEdgeIds: [],
      selectedNodeId: null,
    });
  }

  return { sceneId: scene.id, steps };
}

/** Clamps a requested presentation index to the available steps. */
export function clampPresentationStep(index: number, stepCount: number): number {
  return Math.max(0, Math.min(Math.max(0, stepCount - 1), Math.trunc(index)));
}
