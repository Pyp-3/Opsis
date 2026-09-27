import { BoardDocumentSchema, OSGSchema, type BoardDocument } from '@opsis/schema';
import { boardIcons } from './icons';
import { layoutBoard } from './model';

/** Explicit file import, never overwrites or deletes the legacy source. */
export async function importBoard(value: unknown): Promise<BoardDocument> {
  const current = BoardDocumentSchema.safeParse(value);
  if (current.success)
    return current.data.nodes.some((node) => !current.data.positions[node.id])
      ? layoutBoard(current.data, current.data.agent, current.data)
      : current.data;
  const osg = OSGSchema.parse(value);
  const nodes: BoardDocument['nodes'] = [];
  const edges: BoardDocument['edges'] = [];
  const positions: BoardDocument['positions'] = {};
  osg.scenes.forEach((scene, sceneIndex) => {
    const ids = new Map(
      scene.nodes.map((node, index) => [node.id, `legacy_${sceneIndex}_${index}`]),
    );
    scene.nodes.forEach((node) => {
      const id = ids.get(node.id)!;
      const icon =
        node.primitive in boardIcons ? (node.primitive as keyof typeof boardIcons) : 'box';
      nodes.push({
        id,
        label: node.label.slice(0, 80),
        icon,
        kind: 'note',
        summary: `Imported from ${scene.metaphor} scene ${sceneIndex + 1}.`,
        explanation:
          `Original concept: ${node.label}. Primitive: ${node.primitive}. Role: ${node.role}.\nSource: ${osg.utterance}`.slice(
            0,
            3000,
          ),
        confidence: 'simplified',
        caveat:
          'Legacy scene flattened into 2D. 3D geometry, animations and drill-down behavior are not preserved. Check relationship direction; original relation kinds are included in labels.',
      });
      positions[id] = { x: node.position[0] * 180 + sceneIndex * 1800, y: -node.position[1] * 180 };
    });
    scene.edges.forEach((edge, index) =>
      edges.push({
        id: `legacy_edge_${sceneIndex}_${index}`,
        source: ids.get(edge.from)!,
        target: ids.get(edge.to)!,
        label: `${edge.kind}: ${edge.label ?? ''}`.slice(0, 100),
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
  });
}
