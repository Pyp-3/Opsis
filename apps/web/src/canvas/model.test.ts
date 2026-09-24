import { describe, expect, it } from 'vitest';
import { loadFixture } from '../scene/fixtures';
import {
  addNode,
  connectNodes,
  deleteEdge,
  deleteNode,
  moveNode,
  osgToFlow,
  relabelNode,
  relinkEdge,
} from './model';

describe('oriented-flow edges', () => {
  it('ends directed edges in an arrowhead and leaves bearing lines plain', () => {
    const osg = connectNodes(loadFixture('sandwich'), 'e_sandwich', 'e_tomato', 'user_arrow');
    expect(osg.success).toBe(true);
    if (!osg.success) return;
    const { edges } = osgToFlow(osg.osg);
    const arrow = edges.find((edge) => edge.id === 'user_arrow');
    expect(arrow?.markerEnd).toMatchObject({ type: 'arrowclosed' });
    for (const edge of edges) {
      const kind = (edge.data as { kind: string }).kind;
      expect(edge.markerEnd !== undefined, `${edge.id} (${kind})`).toBe(
        kind === 'arrow' || kind === 'path',
      );
    }
  });
});

describe('validated OSG edits', () => {
  it('syncs move, label, add, connect, relink and delete edits into a valid OSG', () => {
    let osg = loadFixture('sandwich');
    const moved = moveNode(osg, 'e_tomato', 250, -375);
    expect(moved.success).toBe(true);
    if (!moved.success) return;
    osg = moved.osg;
    expect(osg.scenes[0]?.nodes.find((node) => node.id === 'e_tomato')?.position).toEqual([
      2.5, 3.75, 0,
    ]);

    const relabelled = relabelNode(osg, 'e_tomato', 'Fresh tomato');
    expect(relabelled.success).toBe(true);
    if (!relabelled.success) return;
    osg = relabelled.osg;

    const added = addNode(osg, 'Lunch plate', 'user_plate');
    expect(added.success).toBe(true);
    if (!added.success) return;
    osg = added.osg;
    expect(osg.sg.entities.some((entity) => entity.id === 'user_plate')).toBe(true);

    const connected = connectNodes(osg, 'e_sandwich', 'user_plate', 'user_edge');
    expect(connected.success).toBe(true);
    if (!connected.success) return;
    osg = connected.osg;

    const removedEdge = deleteEdge(osg, 'user_edge');
    expect(removedEdge.success).toBe(true);
    if (!removedEdge.success) return;
    osg = removedEdge.osg;
    const reconnected = connectNodes(osg, 'e_sandwich', 'user_plate', 'user_edge');
    if (!reconnected.success) return;
    osg = reconnected.osg;

    const relinked = relinkEdge(osg, 'user_edge', 'e_tomato', 'user_plate');
    expect(relinked.success).toBe(true);
    if (!relinked.success) return;
    osg = relinked.osg;
    expect(osg.scenes[0]?.edges.find((edge) => edge.id === 'user_edge')).toMatchObject({
      from: 'e_tomato',
      to: 'user_plate',
    });

    const deleted = deleteNode(osg, 'user_plate');
    expect(deleted.success).toBe(true);
    if (!deleted.success) return;
    expect(deleted.osg.scenes[0]?.edges.some((edge) => edge.id === 'user_edge')).toBe(false);
  });

  it('rejects edits before commit when they violate the OSG schema', () => {
    const osg = loadFixture('sandwich');
    expect(relabelNode(osg, 'e_tomato', 'one two three four five')).toMatchObject({
      success: false,
    });
    expect(deleteNode(osg, 'e_sandwich')).toMatchObject({
      success: false,
      message: expect.stringContaining('exactly one anchor'),
    });
    expect(connectNodes(osg, 'missing', 'e_tomato', 'bad')).toMatchObject({ success: false });
    expect(osg.scenes[0]?.nodes.find((node) => node.id === 'e_tomato')?.label).toBe('Tomato');
  });
});
