import { COMPASS_POINTS } from '../anchors';
import { FlatMaterial } from '../material';
import type { PrimitiveProps } from '../types';

/** Compass rose in the XZ plane; north is −Z. Highlighted anchors get a longer accent needle. */
export function Compass({ color, tone, highlightAnchors = [] }: PrimitiveProps) {
  return (
    <group>
      <mesh position={[0, -0.2, 0]}>
        <cylinderGeometry args={[0.5, 0.5, 0.6, 24]} />
        <FlatMaterial color={color} />
      </mesh>
      <mesh position={[0, 0.11, 0]}>
        <cylinderGeometry args={[0.06, 0.06, 0.1, 8]} />
        <FlatMaterial color={tone('direction.mark')} />
      </mesh>
      {COMPASS_POINTS.map((point, i) => {
        const cardinal = i % 2 === 0;
        const highlighted = highlightAnchors.includes(point);
        const length = highlighted ? 0.44 : cardinal ? 0.38 : 0.24;
        const needleColor = highlighted
          ? tone('ui.highlight')
          : point === 'N'
            ? tone('direction.north')
            : tone('direction.mark');
        return (
          <group key={point} rotation={[0, (-i * Math.PI) / 4, 0]}>
            <mesh position={[0, 0.14, -length / 2 - 0.04]} rotation={[-Math.PI / 2, 0, 0]}>
              <coneGeometry args={[highlighted ? 0.07 : cardinal ? 0.055 : 0.035, length, 4]} />
              <FlatMaterial color={needleColor} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

/** Straight arrow pointing +X. */
export function Arrow({ color }: PrimitiveProps) {
  return (
    <group>
      <mesh position={[-0.12, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
        <cylinderGeometry args={[0.08, 0.08, 0.76, 8]} />
        <FlatMaterial color={color} />
      </mesh>
      <mesh position={[0.37, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
        <coneGeometry args={[0.2, 0.26, 8]} />
        <FlatMaterial color={color} />
      </mesh>
    </group>
  );
}

/** Quarter-arc arrow rising from lower-left to upper-right (e.g. "rises"). */
export function CurvedArrow({ color }: PrimitiveProps) {
  return (
    <group position={[0.25, -0.4, 0]}>
      <mesh rotation={[0, 0, Math.PI / 2]}>
        <torusGeometry args={[0.65, 0.05, 6, 16, Math.PI / 2]} />
        <FlatMaterial color={color} />
      </mesh>
      <mesh position={[0.05, 0.65, 0]} rotation={[0, 0, -Math.PI / 2]}>
        <coneGeometry args={[0.13, 0.22, 8]} />
        <FlatMaterial color={color} />
      </mesh>
    </group>
  );
}

/** Ground slab with a crisp horizon edge separating sky and ground. */
export function Horizon({ color, tone }: PrimitiveProps) {
  return (
    <group>
      <mesh position={[0, -0.1, 0]}>
        <boxGeometry args={[1, 0.8, 1]} />
        <FlatMaterial color={color} />
      </mesh>
      <mesh position={[0, 0.4, 0]}>
        <boxGeometry args={[1, 0.2, 1.01]} />
        <FlatMaterial color={tone('nature.leaf')} />
      </mesh>
    </group>
  );
}
