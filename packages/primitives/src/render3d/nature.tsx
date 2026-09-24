import { FlatMaterial } from '../material';
import type { PrimitiveProps } from '../types';

const RAYS = Array.from({ length: 8 }, (_, i) => (i * Math.PI) / 4);

/** Low-poly sun: faceted core with eight rays. */
export function Sun({ color }: PrimitiveProps) {
  return (
    <group>
      <mesh>
        <icosahedronGeometry args={[0.3, 1]} />
        <FlatMaterial color={color} />
      </mesh>
      {RAYS.map((angle) => (
        <group key={angle} rotation={[0, 0, angle]}>
          <mesh position={[0, 0.41, 0]}>
            <coneGeometry args={[0.06, 0.16, 4]} />
            <FlatMaterial color={color} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** Moon with a few shallow craters. */
export function Moon({ color, tone }: PrimitiveProps) {
  return (
    <group>
      <mesh>
        <icosahedronGeometry args={[0.45, 1]} />
        <FlatMaterial color={color} />
      </mesh>
      {(
        [
          [0.2, 0.18, 0.34],
          [-0.15, -0.1, 0.4],
          [0.05, -0.28, 0.32],
        ] as const
      ).map((p) => (
        <mesh key={p.join()} position={p}>
          <icosahedronGeometry args={[0.08, 0]} />
          <FlatMaterial color={tone('nature.rock')} />
        </mesh>
      ))}
    </group>
  );
}

/** Earth: ocean sphere with land blobs. */
export function Earth({ color, tone }: PrimitiveProps) {
  return (
    <group>
      <mesh>
        <icosahedronGeometry args={[0.45, 1]} />
        <FlatMaterial color={color} />
      </mesh>
      {(
        [
          [0.22, 0.2, 0.3],
          [-0.28, 0.05, 0.28],
          [0.05, -0.3, 0.3],
          [0.1, 0.35, -0.2],
        ] as const
      ).map((p) => (
        <mesh key={p.join()} position={p}>
          <dodecahedronGeometry args={[0.14, 0]} />
          <FlatMaterial color={tone('nature.leaf')} />
        </mesh>
      ))}
    </group>
  );
}

/** Puffy cloud of overlapping low-poly spheres. */
export function Cloud({ color }: PrimitiveProps) {
  return (
    <group>
      {(
        [
          [-0.25, -0.1, 0, 0.22],
          [0, 0.05, 0, 0.3],
          [0.26, -0.08, 0, 0.22],
          [0.05, -0.15, 0.1, 0.22],
        ] as const
      ).map(([x, y, z, r]) => (
        <mesh key={`${x}${y}`} position={[x, y, z]}>
          <icosahedronGeometry args={[r, 1]} />
          <FlatMaterial color={color} />
        </mesh>
      ))}
    </group>
  );
}

/** Teardrop: sphere base with a conical tip. */
export function Raindrop({ color }: PrimitiveProps) {
  return (
    <group>
      <mesh position={[0, -0.2, 0]}>
        <icosahedronGeometry args={[0.3, 1]} />
        <FlatMaterial color={color} />
      </mesh>
      <mesh position={[0, 0.2, 0]}>
        <coneGeometry args={[0.27, 0.55, 10]} />
        <FlatMaterial color={color} />
      </mesh>
    </group>
  );
}

/** Tree: trunk plus two stacked cones of foliage. */
export function Tree({ color, tone }: PrimitiveProps) {
  return (
    <group>
      <mesh position={[0, -0.35, 0]}>
        <cylinderGeometry args={[0.07, 0.09, 0.3, 6]} />
        <FlatMaterial color={tone('nature.wood')} />
      </mesh>
      <mesh position={[0, -0.02, 0]}>
        <coneGeometry args={[0.42, 0.5, 7]} />
        <FlatMaterial color={color} />
      </mesh>
      <mesh position={[0, 0.28, 0]}>
        <coneGeometry args={[0.3, 0.42, 7]} />
        <FlatMaterial color={color} />
      </mesh>
    </group>
  );
}

/** Flat leaf with a midrib. */
export function Leaf({ color, tone }: PrimitiveProps) {
  return (
    <group rotation={[0, 0, Math.PI / 6]}>
      <mesh scale={[0.3, 0.5, 0.06]}>
        <icosahedronGeometry args={[1, 1]} />
        <FlatMaterial color={color} />
      </mesh>
      <mesh>
        <boxGeometry args={[0.02, 0.9, 0.08]} />
        <FlatMaterial color={tone('nature.wood')} />
      </mesh>
    </group>
  );
}

/** Body of water: a slab with a lighter ripple surface. */
export function Water({ color, tone }: PrimitiveProps) {
  return (
    <group>
      <mesh position={[0, -0.05, 0]}>
        <boxGeometry args={[1, 0.9, 1]} />
        <FlatMaterial color={color} />
      </mesh>
      {[-0.25, 0.05, 0.3].map((z) => (
        <mesh key={z} position={[0, 0.42, z]}>
          <boxGeometry args={[0.9, 0.06, 0.06]} />
          <FlatMaterial color={tone('nature.sky')} />
        </mesh>
      ))}
    </group>
  );
}

/** Mountain: four-sided peak with a snow cap. */
export function Mountain({ color, tone }: PrimitiveProps) {
  return (
    <group>
      <mesh rotation={[0, Math.PI / 4, 0]}>
        <coneGeometry args={[0.7, 1, 4]} />
        <FlatMaterial color={color} />
      </mesh>
      <mesh position={[0, 0.36, 0]} rotation={[0, Math.PI / 4, 0]}>
        <coneGeometry args={[0.2, 0.29, 4]} />
        <FlatMaterial color={tone('nature.cloud')} />
      </mesh>
    </group>
  );
}
