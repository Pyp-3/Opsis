import { useMemo } from 'react';
import { ExtrudeGeometry, Shape } from 'three';
import { FlatMaterial } from '../material';
import type { PrimitiveProps } from '../types';

/** Top-view loaf silhouette (square base, domed crown), extruded to unit height along Y. */
function useLoafGeometry(): ExtrudeGeometry {
  return useMemo(() => {
    const shape = new Shape();
    shape.moveTo(-0.5, -0.5);
    shape.lineTo(0.5, -0.5);
    shape.lineTo(0.5, 0.1);
    shape.bezierCurveTo(0.5, 0.55, 0.25, 0.5, 0, 0.5);
    shape.bezierCurveTo(-0.25, 0.5, -0.5, 0.55, -0.5, 0.1);
    shape.lineTo(-0.5, -0.5);
    const geometry = new ExtrudeGeometry(shape, {
      depth: 1,
      bevelEnabled: false,
      curveSegments: 5,
    });
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(0, -0.5, 0);
    return geometry;
  }, []);
}

/** Slice of bread: crust shell with a lighter crumb face. */
export function BreadSlice({ color, tone }: PrimitiveProps) {
  const loaf = useLoafGeometry();
  return (
    <group>
      <mesh geometry={loaf}>
        <FlatMaterial color={tone('food.crust')} />
      </mesh>
      <mesh geometry={loaf} scale={[0.9, 1.04, 0.9]}>
        <FlatMaterial color={color} />
      </mesh>
    </group>
  );
}

/** Soft rounded filling layer (ham, cheese, lettuce …). */
export function GenericLayer({ color }: PrimitiveProps) {
  return (
    <mesh>
      <cylinderGeometry args={[0.5, 0.5, 1, 12]} />
      <FlatMaterial color={color} />
    </mesh>
  );
}

/** Whole round fruit with stem and leaf. */
export function RoundFruit({ color, tone }: PrimitiveProps) {
  return (
    <group position={[0, -0.05, 0]}>
      <mesh>
        <icosahedronGeometry args={[0.42, 1]} />
        <FlatMaterial color={color} />
      </mesh>
      <mesh position={[0, 0.45, 0]}>
        <cylinderGeometry args={[0.025, 0.03, 0.12, 5]} />
        <FlatMaterial color={tone('nature.wood')} />
      </mesh>
      <mesh position={[0.1, 0.46, 0]} rotation={[0, 0, -0.9]} scale={[0.12, 0.05, 0.07]}>
        <icosahedronGeometry args={[1, 0]} />
        <FlatMaterial color={tone('nature.leaf')} />
      </mesh>
    </group>
  );
}

const SEEDS = [0, 1, 2, 3, 4, 5].map((i) => (i * Math.PI) / 3);

/** Cross-section slice (e.g. tomato): skin ring, lighter flesh, seeds. */
export function Slice({ color, tone }: PrimitiveProps) {
  return (
    <group>
      <mesh>
        <cylinderGeometry args={[0.5, 0.5, 1, 14]} />
        <FlatMaterial color={color} />
      </mesh>
      <mesh position={[0, 0.02, 0]}>
        <cylinderGeometry args={[0.2, 0.2, 1, 10]} />
        <FlatMaterial color={tone('food.fruit')} />
      </mesh>
      {SEEDS.map((a) => (
        <mesh key={a} position={[Math.cos(a) * 0.32, 0.5, Math.sin(a) * 0.32]}>
          <icosahedronGeometry args={[0.04, 0]} />
          <FlatMaterial color={tone('food.bread')} />
        </mesh>
      ))}
    </group>
  );
}
