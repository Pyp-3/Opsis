import { createContext, useContext } from 'react';

/** Interaction state the scene publishes to a primitive's materials. */
export type PrimitiveState = { hovered: boolean; selected: boolean; dimmed: boolean };

/** Scene → primitive interaction state; primitives read it through `FlatMaterial`. */
export const PrimitiveStateContext = createContext<PrimitiveState>({
  hovered: false,
  selected: false,
  dimmed: false,
});

/** Flat-shaded low-poly material that glows softly on hover and more on selection. */
export function FlatMaterial({ color, glow = true }: { color: string; glow?: boolean }) {
  const { hovered, selected, dimmed } = useContext(PrimitiveStateContext);
  const intensity = !glow ? 0 : selected ? 0.35 : hovered ? 0.18 : 0;
  return (
    <meshStandardMaterial
      key={dimmed ? 'dimmed' : 'solid'} // three.js must recompile when `transparent` flips
      color={color}
      flatShading
      roughness={0.85}
      metalness={0}
      emissive={color}
      emissiveIntensity={intensity}
      transparent={dimmed}
      opacity={dimmed ? 0.3 : 1}
    />
  );
}
