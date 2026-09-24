import { FlatMaterial } from '../material';
import type { PrimitiveProps } from '../types';

/** Simple, neutral figure: head and rounded body, no identifying features. */
export function Person({ color, tone }: PrimitiveProps) {
  return (
    <group>
      <mesh position={[0, 0.33, 0]}>
        <icosahedronGeometry args={[0.15, 1]} />
        <FlatMaterial color={tone('people.skin')} />
      </mesh>
      <mesh position={[0, -0.16, 0]}>
        <capsuleGeometry args={[0.2, 0.36, 3, 8]} />
        <FlatMaterial color={color} />
      </mesh>
    </group>
  );
}

const FINGERS = [-0.18, -0.06, 0.06, 0.18];

/** Open hand: palm, four fingers and a thumb. */
export function Hand({ color }: PrimitiveProps) {
  return (
    <group position={[0, -0.12, 0]}>
      <mesh>
        <boxGeometry args={[0.5, 0.45, 0.14]} />
        <FlatMaterial color={color} />
      </mesh>
      {FINGERS.map((x, i) => (
        <mesh key={x} position={[x, 0.36 + (i === 1 || i === 2 ? 0.04 : 0), 0]}>
          <capsuleGeometry args={[0.05, 0.22 + (i === 1 || i === 2 ? 0.08 : 0), 2, 6]} />
          <FlatMaterial color={color} />
        </mesh>
      ))}
      <mesh position={[-0.33, 0.06, 0]} rotation={[0, 0, 0.8]}>
        <capsuleGeometry args={[0.055, 0.2, 2, 6]} />
        <FlatMaterial color={color} />
      </mesh>
    </group>
  );
}
