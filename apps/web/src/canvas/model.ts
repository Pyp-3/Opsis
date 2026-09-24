import {
  OSGSchema,
  type MetaphorId,
  type OSG,
  type PositionedNode,
  type PositionedScene,
} from '@opsis/schema';
import { t } from '@opsis/ui';
import { MarkerType, type Edge, type Node } from '@xyflow/react';

export const FLOW_SCALE = 100;

export type CanvasNodeData = {
  label: string;
  primitive: PositionedNode['primitive'];
  optional: boolean;
  anchor: boolean;
  metaphor: MetaphorId;
  size: readonly [number, number];
  primitiveVisual: boolean;
  highlightAnchors: readonly string[];
  [key: string]: unknown;
};

export type OsgEditResult = { success: true; osg: OSG } | { success: false; message: string };

function sceneBounds(nodes: PositionedNode[]): PositionedScene['bounds'] {
  if (nodes.length === 0) return { min: [0, 0, 0], max: [0, 0, 0] };
  const axes = [0, 1, 2] as const;
  return {
    min: axes.map((axis) => Math.min(...nodes.map((node) => node.position[axis]))) as [
      number,
      number,
      number,
    ],
    max: axes.map((axis) => Math.max(...nodes.map((node) => node.position[axis]))) as [
      number,
      number,
      number,
    ],
  };
}

/** Edge kinds that carry a direction and therefore end in an arrowhead (oriented-flow grammar). */
const DIRECTED_EDGE_KINDS: ReadonlySet<string> = new Set(['arrow', 'path']);

const CARD_FOOTPRINT = { width: 188, height: 90 } as const;
const COMPASS_VISUALS: Partial<
  Record<PositionedNode['primitive'], { width: number; height: number }>
> = {
  compass: { width: 280, height: 280 },
  sun: { width: 120, height: 120 },
  curved_arrow: { width: 140, height: 100 },
};
const FLOW_NODE_GAP = 24;

type FlowFootprint = { id: string; x: number; y: number; width: number; height: number };

/** Pixel footprint used by the actual React Flow node, rather than its world-space 3D geometry. */
export function canvasNodeFootprint(
  node: PositionedNode,
  metaphor: MetaphorId,
): { width: number; height: number; primitiveVisual: boolean } {
  const visual = metaphor === 'compass' ? COMPASS_VISUALS[node.primitive] : undefined;
  if (visual) return { ...visual, primitiveVisual: true };
  return {
    width: Math.max(CARD_FOOTPRINT.width, node.size[0] * FLOW_SCALE),
    height: Math.max(CARD_FOOTPRINT.height, node.size[1] * FLOW_SCALE),
    primitiveVisual: false,
  };
}

function rectanglesOverlap(left: FlowFootprint, right: FlowFootprint): boolean {
  return (
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y
  );
}

/** Deterministically separates measured 2D footprints when a 3D size is smaller than its card. */
function separateRenderedFootprints(footprints: FlowFootprint[]): void {
  for (let index = 0; index < footprints.length; index += 1) {
    const node = footprints[index];
    if (!node) continue;
    for (let attempt = 0; attempt < footprints.length * 4; attempt += 1) {
      const collision = footprints.slice(0, index).find((other) => rectanglesOverlap(node, other));
      if (!collision) break;
      const nodeCentre = { x: node.x + node.width / 2, y: node.y + node.height / 2 };
      const otherCentre = {
        x: collision.x + collision.width / 2,
        y: collision.y + collision.height / 2,
      };
      const dx = nodeCentre.x - otherCentre.x;
      const dy = nodeCentre.y - otherCentre.y;
      if (Math.abs(dx) >= Math.abs(dy)) {
        node.x =
          dx >= 0
            ? collision.x + collision.width + FLOW_NODE_GAP
            : collision.x - node.width - FLOW_NODE_GAP;
      } else {
        node.y =
          dy >= 0
            ? collision.y + collision.height + FLOW_NODE_GAP
            : collision.y - node.height - FLOW_NODE_GAP;
      }
    }
  }
}

/** Edge colour: a token with ≥ 3:1 contrast on the canvas (WCAG 1.4.11). */
export const FLOW_EDGE_COLOR = 'var(--opsis-ui-textMuted)';

/** Converts a positioned OSG scene to React Flow's node and edge model. */
export function osgToFlow(
  osg: OSG,
  sceneIndex = 0,
): { nodes: Node<CanvasNodeData>[]; edges: Edge[] } {
  const scene = osg.scenes[sceneIndex];
  if (!scene) return { nodes: [], edges: [] };
  const highlights = scene.nodes
    .filter((node) => node.primitive !== 'compass')
    .map((node) => node.label.trim().toLocaleUpperCase())
    .filter((label) => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW', 'EAST'].includes(label))
    .map((label) => (label === 'EAST' ? 'E' : label));
  const footprints = scene.nodes.map((node) => {
    const footprint = canvasNodeFootprint(node, scene.metaphor);
    return {
      id: node.id,
      x: node.position[0] * FLOW_SCALE - footprint.width / 2,
      y: -node.position[1] * FLOW_SCALE - footprint.height / 2,
      width: footprint.width,
      height: footprint.height,
    };
  });
  separateRenderedFootprints(footprints);
  const footprintById = new Map(footprints.map((footprint) => [footprint.id, footprint]));
  return {
    nodes: scene.nodes.map((node) => {
      const footprint = footprintById.get(node.id)!;
      const dimensions = canvasNodeFootprint(node, scene.metaphor);
      return {
        id: node.id,
        position: { x: footprint.x, y: footprint.y },
        style: { width: footprint.width, height: footprint.height },
        data: {
          label: node.label,
          primitive: node.primitive,
          optional: node.optional === true,
          anchor: node.role === 'anchor',
          metaphor: scene.metaphor,
          size: [footprint.width, footprint.height] as const,
          primitiveVisual: dimensions.primitiveVisual,
          highlightAnchors: node.primitive === 'compass' ? highlights : [],
        },
        ariaLabel: node.optional ? `${node.label}, ${t('canvas.optional')}` : node.label,
      };
    }),
    edges: scene.edges.map((edge) => ({
      id: edge.id,
      source: edge.from,
      target: edge.to,
      ...(edge.label ? { label: edge.label } : {}),
      ...(edge.animated !== undefined ? { animated: edge.animated } : {}),
      type: edge.kind === 'path' || scene.metaphor === 'compass' ? 'smoothstep' : 'default',
      ...(scene.metaphor === 'compass' && edge.from === 'v_compass'
        ? { hidden: true }
        : scene.metaphor === 'compass' && edge.from.includes('sun')
          ? { sourceHandle: 'top-source', targetHandle: 'bottom-target' }
          : scene.metaphor === 'compass'
            ? { sourceHandle: 'right-source', targetHandle: 'top-target' }
            : {}),
      ...(DIRECTED_EDGE_KINDS.has(edge.kind)
        ? { markerEnd: { type: MarkerType.ArrowClosed, color: FLOW_EDGE_COLOR } }
        : {}),
      data: { kind: edge.kind },
    })),
  };
}

/** Applies an immutable edit and rejects it unless the complete OSG remains valid. */
export function validateOsgEdit(osg: OSG, edit: (draft: OSG) => void): OsgEditResult {
  const draft = structuredClone(osg);
  edit(draft);
  for (const scene of draft.scenes) scene.bounds = sceneBounds(scene.nodes);
  const parsed = OSGSchema.safeParse(draft);
  if (parsed.success) return { success: true, osg: parsed.data };
  return {
    success: false,
    message: parsed.error.issues.map((issue) => issue.message).join('; '),
  };
}

/** Moves one node from React Flow coordinates back into the shared OSG coordinate system. */
export function moveNode(osg: OSG, nodeId: string, x: number, y: number): OsgEditResult {
  return validateOsgEdit(osg, (draft) => {
    const node = draft.scenes[0]?.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) return;
    node.position = [x / FLOW_SCALE, -y / FLOW_SCALE, node.position[2]];
  });
}

/** Relabels a visual node. The canonical four-word rule is enforced by OSG validation. */
export function relabelNode(osg: OSG, nodeId: string, label: string): OsgEditResult {
  return validateOsgEdit(osg, (draft) => {
    const node = draft.scenes[0]?.nodes.find((candidate) => candidate.id === nodeId);
    if (node) node.label = label.trim();
  });
}

/** Adds a generic editable node and its traceability entity. */
export function addNode(osg: OSG, label: string, id: string): OsgEditResult {
  return validateOsgEdit(osg, (draft) => {
    const scene = draft.scenes[0];
    if (!scene) return;
    const cleanLabel = label.trim();
    scene.nodes.push({
      id,
      primitive: 'labeled_card',
      label: cleanLabel,
      role: 'context',
      position: [0, 0, 0],
      size: [1.8, 1, 0.3],
      drillable: false,
    });
    draft.sg.entities.push({
      id,
      surface: cleanLabel,
      lemma: cleanLabel.toLocaleLowerCase(),
      kind: 'abstract_concept',
      span: [0, 0],
      summary: t('canvas.addedSummary', { label: cleanLabel }),
    });
  });
}

/** Deletes a node and every visual edge incident to it. */
export function deleteNode(osg: OSG, nodeId: string): OsgEditResult {
  return validateOsgEdit(osg, (draft) => {
    const scene = draft.scenes[0];
    if (!scene) return;
    scene.nodes = scene.nodes.filter((node) => node.id !== nodeId);
    scene.edges = scene.edges.filter((edge) => edge.from !== nodeId && edge.to !== nodeId);
  });
}

/** Deletes one visual edge. */
export function deleteEdge(osg: OSG, edgeId: string): OsgEditResult {
  return validateOsgEdit(osg, (draft) => {
    const scene = draft.scenes[0];
    if (scene) scene.edges = scene.edges.filter((edge) => edge.id !== edgeId);
  });
}

/** Adds an arrow edge between existing nodes. */
export function connectNodes(osg: OSG, from: string, to: string, id: string): OsgEditResult {
  return validateOsgEdit(osg, (draft) => {
    draft.scenes[0]?.edges.push({ id, from, to, kind: 'arrow' });
  });
}

/** Changes both endpoints of an existing edge. */
export function relinkEdge(osg: OSG, edgeId: string, from: string, to: string): OsgEditResult {
  return validateOsgEdit(osg, (draft) => {
    const edge = draft.scenes[0]?.edges.find((candidate) => candidate.id === edgeId);
    if (edge) {
      edge.from = from;
      edge.to = to;
    }
  });
}
