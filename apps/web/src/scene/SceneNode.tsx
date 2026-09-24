import { animated, easings, useSpring } from '@react-spring/three';
import { Html, Line } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import type { EntityKind, PositionedNode, PositionedScene } from '@opsis/schema';
import { PrimitiveStateContext, anchorToWorld, getPrimitive, type Vec3 } from '@opsis/primitives';
import { resolveColor, type ColorToken, type PaletteId } from '@opsis/ui';
import { useMemo } from 'react';
import { labelPlacement, nodeTarget } from './model';

/** Explode/assemble duration; PROMPT.md §12.3 requires 450–700 ms. */
export const EXPLODE_DURATION_MS = 600;

type Props = {
  node: PositionedNode;
  scene: PositionedScene;
  exploded: boolean;
  reducedMotion: boolean;
  paletteId: PaletteId;
  hovered: boolean;
  selected: boolean;
  highlightAnchors: readonly string[];
  kind: EntityKind | undefined;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
};

/** Twelve box edges as 24 segment endpoints, for the dashed "optional" outline. */
function boxEdges([w, h, d]: Vec3): Vec3[] {
  const [x, y, z] = [w / 2, h / 2, d / 2];
  const c: Vec3[] = [
    [-x, -y, -z],
    [x, -y, -z],
    [x, y, -z],
    [-x, y, -z],
    [-x, -y, z],
    [x, -y, z],
    [x, y, z],
    [-x, y, z],
  ];
  const pairs = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0],
    [4, 5],
    [5, 6],
    [6, 7],
    [7, 4],
    [0, 4],
    [1, 5],
    [2, 6],
    [3, 7],
  ];
  return pairs.flatMap(([a, b]) => [c[a ?? 0] as Vec3, c[b ?? 0] as Vec3]);
}

const ALIGN = {
  left: 'translate(0, -50%)',
  right: 'translate(-100%, -50%)',
  center: 'translate(-50%, -50%)',
} as const;

/** One OSG node: its primitive, label, leader line, optional outline, hover and selection. */
export function SceneNode(props: Props) {
  const { node, scene, exploded, reducedMotion, paletteId, hovered, selected } = props;
  const def = getPrimitive(node.primitive);
  const Render = def.render3D ?? getPrimitive('labeled_card').render3D;
  const tone = useMemo(
    () => (token: ColorToken) => resolveColor(token, token, paletteId),
    [paletteId],
  );
  const color = resolveColor(node.style?.colorToken, def.colorToken, paletteId);
  const placement = labelPlacement(node, scene);
  // §10.2: the whole fades to 30 % while its parts are exploded apart.
  const dimmed =
    exploded &&
    node.role === 'anchor' &&
    (scene.metaphor === 'container' || scene.metaphor === 'stack');
  const state = useMemo(() => ({ hovered, selected, dimmed }), [hovered, selected, dimmed]);
  const outline = useMemo(() => boxEdges(node.size.map((s) => s * 1.06) as Vec3), [node.size]);

  const { position } = useSpring({
    position: nodeTarget(node, exploded),
    immediate: reducedMotion,
    config: { duration: EXPLODE_DURATION_MS, easing: easings.easeInOutCubic },
  });

  const stop = (e: ThreeEvent<PointerEvent | MouseEvent>) => e.stopPropagation();

  return (
    <animated.group position={position as unknown as Vec3}>
      <group
        rotation={node.rotation ?? [0, 0, 0]}
        onPointerOver={(e) => {
          stop(e);
          props.onHover(node.id);
        }}
        onPointerOut={(e) => {
          stop(e);
          props.onHover(null);
        }}
        onClick={(e) => {
          stop(e);
          props.onSelect(node.id);
        }}
      >
        <group scale={node.size}>
          <PrimitiveStateContext.Provider value={state}>
            {Render ? (
              <Render
                color={color}
                tone={tone}
                size={node.size}
                label={node.label}
                kind={props.kind}
                emphasis={node.style?.emphasis === 'highlight'}
                highlightAnchors={props.highlightAnchors}
              />
            ) : null}
          </PrimitiveStateContext.Provider>
        </group>
      </group>
      {def.anchorLabels
        ? Object.entries(def.anchorLabels).map(([anchor, text]) => {
            const a = def.anchors[anchor];
            if (!a) return null;
            const [x, , z] = anchorToWorld(a, [0, 0, 0], node.size);
            const on = props.highlightAnchors.includes(anchor);
            return (
              <Html
                key={anchor}
                position={[x * 1.12, node.size[1] / 2, z * 1.12]}
                zIndexRange={[10, 0]}
              >
                <span
                  className={on ? 'opsis-bearing opsis-bearing--on' : 'opsis-bearing'}
                  aria-hidden
                >
                  {text}
                </span>
              </Html>
            );
          })
        : null}
      {node.optional ? (
        <Line
          points={outline}
          segments
          dashed
          dashSize={0.18}
          gapSize={0.12}
          lineWidth={1.5}
          color={resolveColor('ui.optional', 'ui.optional', paletteId)}
        />
      ) : null}
      {placement.leaderFrom ? (
        <Line
          points={[
            placement.leaderFrom,
            [placement.offset[0] - 0.1, placement.offset[1], placement.offset[2]],
          ]}
          lineWidth={1.2}
          color={resolveColor('ui.outline', 'ui.outline', paletteId)}
        />
      ) : null}
      <Html position={placement.offset} zIndexRange={[20, 10]}>
        <div
          className={`opsis-label${selected ? ' opsis-label--selected' : ''}${hovered ? ' opsis-label--hovered' : ''}`}
          style={{ transform: ALIGN[placement.align] }}
        >
          <span>{node.label}</span>
          {node.optional ? <span className="opsis-badge">optional</span> : null}
        </div>
      </Html>
    </animated.group>
  );
}
