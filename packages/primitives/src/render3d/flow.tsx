import { FlatMaterial } from '../material';
import type { PrimitiveProps } from '../types';

const RING_ARROWS = [0, 1, 2].map((i) => (i * 2 * Math.PI) / 3);

/** Ring with three clockwise arrowheads, viewed face-on (XY plane). */
export function CycleRing({ color }: PrimitiveProps) {
  return (
    <group>
      <mesh>
        <torusGeometry args={[0.4, 0.04, 6, 32]} />
        <FlatMaterial color={color} />
      </mesh>
      {RING_ARROWS.map((a) => (
        <group key={a} rotation={[0, 0, a]}>
          <mesh position={[0, 0.4, 0]} rotation={[0, 0, -Math.PI / 2]}>
            <coneGeometry args={[0.09, 0.16, 6]} />
            <FlatMaterial color={color} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

const TICKS = [-0.35, -0.15, 0.05, 0.25];

/** Horizontal time axis with ticks and an arrowhead toward the future (+X). */
export function TimelineAxis({ color }: PrimitiveProps) {
  return (
    <group>
      <mesh rotation={[0, 0, -Math.PI / 2]} position={[-0.05, 0, 0]}>
        <cylinderGeometry args={[0.03, 0.03, 0.9, 6]} />
        <FlatMaterial color={color} />
      </mesh>
      <mesh rotation={[0, 0, -Math.PI / 2]} position={[0.44, 0, 0]}>
        <coneGeometry args={[0.07, 0.12, 6]} />
        <FlatMaterial color={color} />
      </mesh>
      {TICKS.map((x) => (
        <mesh key={x} position={[x, 0, 0]}>
          <icosahedronGeometry args={[0.06, 0]} />
          <FlatMaterial color={color} />
        </mesh>
      ))}
    </group>
  );
}

/** Two-pan balance; the beam is level (layout owns any tilt via node rotation). */
export function ScaleBalance({ color, tone }: PrimitiveProps) {
  const pan = tone('measure.bar');
  return (
    <group>
      <mesh position={[0, -0.45, 0]}>
        <cylinderGeometry args={[0.18, 0.22, 0.1, 8]} />
        <FlatMaterial color={color} />
      </mesh>
      <mesh position={[0, -0.05, 0]}>
        <cylinderGeometry args={[0.03, 0.03, 0.72, 6]} />
        <FlatMaterial color={color} />
      </mesh>
      <mesh position={[0, 0.3, 0]}>
        <boxGeometry args={[0.9, 0.04, 0.04]} />
        <FlatMaterial color={color} />
      </mesh>
      {[-0.4, 0.4].map((x) => (
        <group key={x} position={[x, 0.3, 0]}>
          <mesh position={[0, -0.12, 0]}>
            <cylinderGeometry args={[0.008, 0.008, 0.24, 4]} />
            <FlatMaterial color={color} />
          </mesh>
          <mesh position={[0, -0.25, 0]}>
            <cylinderGeometry args={[0.16, 0.1, 0.04, 10]} />
            <FlatMaterial color={pan} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** A single bar (bar-chart column) on a thin base. */
export function Bar({ color, tone }: PrimitiveProps) {
  return (
    <group>
      <mesh position={[0, 0.02, 0]}>
        <boxGeometry args={[0.7, 0.96, 0.7]} />
        <FlatMaterial color={color} />
      </mesh>
      <mesh position={[0, -0.48, 0]}>
        <boxGeometry args={[1, 0.04, 1]} />
        <FlatMaterial color={tone('struct.frame')} />
      </mesh>
    </group>
  );
}

const DOTS = [-0.4, -0.2, 0, 0.2, 0.4];

/** Row of countable dots. */
export function CounterDots({ color }: PrimitiveProps) {
  return (
    <group>
      {DOTS.map((x) => (
        <mesh key={x} position={[x, 0, 0]}>
          <icosahedronGeometry args={[0.08, 1]} />
          <FlatMaterial color={color} />
        </mesh>
      ))}
    </group>
  );
}
