import { useMemo } from 'react';
import { BoxGeometry, DoubleSide, EdgesGeometry } from 'three';
import { FlatMaterial } from '../material';
import type { PrimitiveProps } from '../types';

const noRaycast = () => null;

/** Simple crate with a darker lid band. */
export function Box({ color, tone }: PrimitiveProps) {
  return (
    <group>
      <mesh position={[0, -0.05, 0]}>
        <boxGeometry args={[0.9, 0.8, 0.9]} />
        <FlatMaterial color={color} />
      </mesh>
      <mesh position={[0, 0.4, 0]}>
        <boxGeometry args={[0.96, 0.12, 0.96]} />
        <FlatMaterial color={tone('struct.frame')} />
      </mesh>
    </group>
  );
}

/** One layer of a stack: a full-footprint slab. */
export function StackLayer({ color }: PrimitiveProps) {
  return (
    <mesh>
      <boxGeometry args={[1, 1, 1]} />
      <FlatMaterial color={color} />
    </mesh>
  );
}

/** Open hemispherical bowl. */
export function Bowl({ color }: PrimitiveProps) {
  return (
    <group position={[0, 0.3, 0]}>
      <mesh>
        <sphereGeometry args={[0.5, 12, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2]} />
        <meshStandardMaterial color={color} flatShading side={DoubleSide} />
      </mesh>
      <mesh position={[0, -0.5, 0]}>
        <cylinderGeometry args={[0.18, 0.2, 0.06, 12]} />
        <FlatMaterial color={color} />
      </mesh>
    </group>
  );
}

/** Biological cell: translucent membrane with a nucleus. */
export function Cell({ color, tone }: PrimitiveProps) {
  return (
    <group>
      <mesh>
        <icosahedronGeometry args={[0.5, 2]} />
        <meshStandardMaterial color={color} flatShading transparent opacity={0.35} />
      </mesh>
      <mesh position={[0.08, 0.04, 0]}>
        <icosahedronGeometry args={[0.16, 1]} />
        <FlatMaterial color={tone('ui.optional')} />
      </mesh>
    </group>
  );
}

/**
 * Grouping frame for a whole-of-parts: a thin base plate plus faint, non-pickable edges,
 * so clicks inside the frame reach the parts rather than the frame.
 */
export function GroupFrame({ color, tone }: PrimitiveProps) {
  const edges = useMemo(() => new EdgesGeometry(new BoxGeometry(1, 1, 1)), []);
  return (
    <group>
      <lineSegments geometry={edges} raycast={noRaycast}>
        <lineBasicMaterial color={color} transparent opacity={0.35} />
      </lineSegments>
      <mesh position={[0, -0.5, 0]}>
        <boxGeometry args={[1.02, 0.02, 1.02]} />
        <FlatMaterial color={tone('struct.layer')} />
      </mesh>
    </group>
  );
}
