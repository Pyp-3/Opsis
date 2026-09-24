# Asset licenses

Every icon, model, texture or primitive asset added under `assets/` MUST be original
(procedurally generated or hand-authored) or carry a permissive licence (CC0 or MIT).
Record each third-party asset below (PROMPT.md §6, asset rule). No trademarked characters,
logos or copyrighted artwork.

| Path | Source / author | Licence | Notes |
| ---- | --------------- | ------- | ----- |

_No third-party assets yet._

## Original primitives (M1)

All 30 primitives in `packages/primitives` are **original** to Opsis: 3D geometry is built
procedurally at runtime from three.js built-in geometry classes (box, cylinder, cone,
icosahedron, torus, capsule, extruded shapes) and 2D renderers are hand-authored inline SVG.
No model, texture, font or image files are shipped.

| Path                                      | Source / author                                                 | Licence                                                | Notes                                 |
| ----------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------- |
| `packages/primitives/src/render3d/*.tsx`  | Opsis contributors (original)                                   | Project licence                                        | Procedural low-poly geometry          |
| `packages/primitives/src/render2d.tsx`    | Opsis contributors (original)                                   | Project licence                                        | Hand-authored SVG paths               |
| `packages/ui/src/tokens.ts` (`OKABE_ITO`) | Colour values from Okabe & Ito (2008), _Color Universal Design_ | Facts, not copyrightable; widely used as public domain | Colour-blind-safe palette values only |
| Scene labels                              | Browser system UI font via CSS `system-ui`                      | n/a (not bundled)                                      | No web fonts are fetched or shipped   |

Runtime libraries (not assets): three.js (MIT), @react-three/fiber (MIT), @react-three/drei (MIT),
@react-spring/three (MIT).
