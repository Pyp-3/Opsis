import { Html, Line } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import type { PositionedScene } from '@opsis/schema';
import type { Vec3 } from '@opsis/primitives';
import { resolveColor, type PaletteId } from '@opsis/ui';
import { useRef } from 'react';
import { edgeStart } from './model';

type EdgeProps = {
  from: Vec3;
  to: Vec3;
  color: string;
  label: string | undefined;
  animated: boolean;
  dashed: boolean;
};

/** A straight edge; animated edges march their dashes unless reduced motion is on. */
function Edge({ from, to, color, label, animated, dashed }: EdgeProps) {
  const ref = useRef<{ material: { dashOffset: number } } | null>(null);
  useFrame((_, delta) => {
    if (animated && ref.current) ref.current.material.dashOffset -= delta * 0.6;
  });
  const mid: Vec3 = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2];
  return (
    <group>
      <Line
        ref={ref as never}
        points={[from, to]}
        color={color}
        lineWidth={2}
        dashed={dashed || animated}
        dashSize={0.2}
        gapSize={0.12}
      />
      {label ? (
        <Html position={mid} zIndexRange={[5, 0]}>
          <span className="opsis-edge-label">{label}</span>
        </Html>
      ) : null}
    </group>
  );
}

/**
 * Draws arrow/line/path edges between node centres. Containment and leader edges are
 * implied by the layout (stacking, label leaders) and are not drawn again.
 */
export function SceneEdges({
  scene,
  paletteId,
  reducedMotion,
}: {
  scene: PositionedScene;
  paletteId: PaletteId;
  reducedMotion: boolean;
}) {
  const byId = new Map(scene.nodes.map((n) => [n.id, n]));
  return (
    <group>
      {scene.edges
        .filter((e) => e.kind !== 'containment' && e.kind !== 'leader')
        .map((edge) => {
          const from = byId.get(edge.from);
          const to = byId.get(edge.to);
          if (!from || !to) return null;
          return (
            <Edge
              key={edge.id}
              from={edgeStart(from, to)}
              to={to.position}
              color={resolveColor('flow.arrow', 'flow.arrow', paletteId)}
              label={edge.label}
              animated={edge.animated === true && !reducedMotion}
              dashed={edge.kind === 'path'}
            />
          );
        })}
    </group>
  );
}
