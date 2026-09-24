import { OSGSchema, type OSG, type PositionedNode, type PositionedScene } from '@opsis/schema';
import type { Edge, Node } from '@xyflow/react';

export const FLOW_SCALE = 100;

export type CanvasNodeData = {
  label: string;
  primitive: PositionedNode['primitive'];
  optional: boolean;
  anchor: boolean;
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

/** Converts a positioned OSG scene to React Flow's node and edge model. */
export function osgToFlow(
  osg: OSG,
  sceneIndex = 0,
): { nodes: Node<CanvasNodeData>[]; edges: Edge[] } {
  const scene = osg.scenes[sceneIndex];
  if (!scene) return { nodes: [], edges: [] };
  return {
    nodes: scene.nodes.map((node) => ({
      id: node.id,
      position: { x: node.position[0] * FLOW_SCALE, y: -node.position[1] * FLOW_SCALE },
      data: {
        label: node.label,
        primitive: node.primitive,
        optional: node.optional === true,
        anchor: node.role === 'anchor',
      },
      ariaLabel: `${node.label}${node.optional ? ', optional' : ''}`,
    })),
    edges: scene.edges.map((edge) => ({
      id: edge.id,
      source: edge.from,
      target: edge.to,
      ...(edge.label ? { label: edge.label } : {}),
      ...(edge.animated !== undefined ? { animated: edge.animated } : {}),
      type: edge.kind === 'path' ? 'smoothstep' : 'default',
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
      summary: `${cleanLabel} was added to this diagram.`,
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
