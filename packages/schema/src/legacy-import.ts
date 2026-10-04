import { BoardDocumentSchema, type BoardDocument } from './board';
import { BOARD_ICONS } from './board-icons';
import { OSGSchema, type PrimitiveId } from './legacy-osg';

const PRIMITIVES: Record<PrimitiveId, BoardDocument['nodes'][number]['icon']> = {
  compass: 'compass',
  arrow: 'send',
  curved_arrow: 'repeat',
  horizon: 'map',
  sun: 'sun',
  moon: 'moon',
  earth: 'globe',
  cloud: 'cloud',
  raindrop: 'droplet',
  tree: 'tree',
  leaf: 'leaf',
  water: 'waves',
  mountain: 'mountain',
  box: 'box',
  stack_layer: 'layers',
  bowl: 'container',
  cell: 'box',
  group_frame: 'blocks',
  bread_slice: 'layers',
  generic_layer: 'layers',
  round_fruit: 'apple',
  slice: 'pie',
  person: 'user',
  hand: 'hand',
  cycle_ring: 'repeat',
  timeline_axis: 'clock',
  scale_balance: 'scale',
  bar: 'chart',
  counter_dots: 'calculator',
  labeled_card: 'file',
};

/** Flatten legacy scenes without discarding provenance; never execute their behaviors. */
export function importLegacyBoard(value: unknown): BoardDocument {
  const osg = OSGSchema.parse(value);
  const nodes: BoardDocument['nodes'] = [],
    edges: BoardDocument['edges'] = [],
    positions: BoardDocument['positions'] = {};
  const groups: NonNullable<BoardDocument['groups']> = [];
  osg.scenes.forEach((scene, sceneIndex) => {
    const ids = new Map(
      scene.nodes.map((node, index) => [node.id, `legacy_${sceneIndex}_${index}`]),
    );
    groups.push({
      id: `scene_${sceneIndex}`,
      label: `${scene.metaphor} · scene ${sceneIndex + 1}`,
      nodeIds: [...ids.values()],
      collapsed: false,
      boundary: false,
    });
    scene.nodes.forEach((node) => {
      const id = ids.get(node.id)!;
      const mapped = PRIMITIVES[node.primitive];
      const icon = BOARD_ICONS.includes(mapped) ? mapped : 'box';
      nodes.push({
        id,
        label: node.label.slice(0, 80),
        icon,
        kind: node.role === 'anchor' ? 'step' : 'note',
        summary: `Imported from ${scene.metaphor} scene ${sceneIndex + 1}.`,
        explanation:
          `Original concept: ${node.label}. Primitive: ${node.primitive}. Role: ${node.role}.\nSource: ${osg.utterance}`.slice(
            0,
            3000,
          ),
        notes: `Original 3D position: ${node.position.join(', ')}. Only X/Y are projected; depth and animation are not reproduced.`,
        references: [
          { title: `Legacy OSG ${osg.id}`.slice(0, 200), excerpt: osg.utterance.slice(0, 3000) },
        ],
        confidence: 'simplified',
        caveat:
          'Legacy scene flattened into 2D. Original geometry and behaviors remain in the source file; review relationship direction.',
      });
      positions[id] = { x: node.position[0] * 180 + sceneIndex * 1800, y: -node.position[1] * 180 };
    });
    scene.edges.forEach((edge, index) =>
      edges.push({
        id: `legacy_edge_${sceneIndex}_${index}`,
        source: ids.get(edge.from)!,
        target: ids.get(edge.to)!,
        label: `${edge.kind}: ${edge.label ?? ''}`.slice(0, 100),
        kind: scene.metaphor === 'cycle' ? 'retry' : 'flow',
        description: `Original relation: ${edge.kind}. Review its direction after flattening.`,
      }),
    );
  });
  return BoardDocumentSchema.parse({
    version: 2,
    agent: 'demo',
    title: osg.title.slice(0, 100),
    description:
      'Imported legacy OSG. Original JSON remains unchanged; review flattened relationships.',
    nodes,
    edges,
    positions,
    groups,
  });
}
