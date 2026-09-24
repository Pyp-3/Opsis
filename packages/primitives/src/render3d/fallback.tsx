import type { EntityKind } from '@opsis/schema';
import { FlatMaterial } from '../material';
import type { PrimitiveProps } from '../types';

/** Small procedural glyph per entity kind, drawn on top of a `labeled_card`. */
function KindIcon({ kind, color }: { kind: EntityKind; color: string }) {
  switch (kind) {
    case 'direction':
    case 'action':
      return (
        <mesh rotation={[0, 0, -Math.PI / 2]}>
          <coneGeometry args={[0.35, 0.8, 4]} />
          <FlatMaterial color={color} />
        </mesh>
      );
    case 'celestial_body':
      return (
        <mesh>
          <icosahedronGeometry args={[0.4, 1]} />
          <FlatMaterial color={color} />
        </mesh>
      );
    case 'person':
    case 'living_thing':
      return (
        <mesh>
          <capsuleGeometry args={[0.22, 0.4, 2, 6]} />
          <FlatMaterial color={color} />
        </mesh>
      );
    case 'place':
      return (
        <mesh rotation={[Math.PI, 0, 0]}>
          <coneGeometry args={[0.3, 0.8, 6]} />
          <FlatMaterial color={color} />
        </mesh>
      );
    case 'substance':
      return (
        <mesh>
          <octahedronGeometry args={[0.4, 0]} />
          <FlatMaterial color={color} />
        </mesh>
      );
    case 'event':
    case 'time':
    case 'process':
      return (
        <mesh>
          <torusGeometry args={[0.3, 0.1, 6, 12]} />
          <FlatMaterial color={color} />
        </mesh>
      );
    case 'quantity':
      return (
        <mesh>
          <boxGeometry args={[0.2, 0.7, 0.2]} />
          <FlatMaterial color={color} />
        </mesh>
      );
    case 'abstract_concept':
      return (
        <mesh>
          <dodecahedronGeometry args={[0.4, 0]} />
          <FlatMaterial color={color} />
        </mesh>
      );
    case 'object':
      return (
        <mesh>
          <boxGeometry args={[0.6, 0.6, 0.6]} />
          <FlatMaterial color={color} />
        </mesh>
      );
  }
}

/**
 * Fallback tile: always renders, whatever the entity. The scene draws the label text;
 * the tile adds an accent edge and a kind glyph that is counter-scaled so it stays round.
 */
export function LabeledCard({
  color,
  tone,
  size,
  kind = 'object',
  emphasis = false,
}: PrimitiveProps) {
  const icon = Math.min(...size) * 0.9;
  const accent = emphasis ? tone('ui.highlight') : tone('ui.accent');
  return (
    <group>
      <mesh>
        <boxGeometry args={[1, 1, 1]} />
        <FlatMaterial color={color} />
      </mesh>
      <mesh position={[-0.5 + 0.04, 0, 0]}>
        <boxGeometry args={[0.08, 1.02, 1.02]} />
        <FlatMaterial color={accent} />
      </mesh>
      <group
        position={[0, 0.5 + icon / 2 / size[1], 0]}
        scale={[icon / size[0], icon / size[1], icon / size[2]]}
      >
        <KindIcon kind={kind} color={accent} />
      </group>
    </group>
  );
}
