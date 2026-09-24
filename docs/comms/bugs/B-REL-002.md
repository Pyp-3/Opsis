---
type: bug
id: B-REL-002
severity: major
found_by: pedagogy-reviewer
owner: layout-agent (with canvas-agent)
status: resolved
---

## Utterance / input

"The sun rises in the east." (North Star §2.1) in its default 2D view (D-004 keeps sun/east 2D).

## Steps

1. Run `pnpm test:browser tests/visual` and open
   `tests/visual/north-star.spec.ts-snapshots/sun-east-linux.png`.

## Expected

§7.5 and §10.2: no node overlap and no label overlap. The compass is the anchor visual, with East
at its east bearing and the sun on the eastern horizon. The rising arc reads as apparent motion.

## Actual

- The **Sun** card (about x 537–720 px) and the **East** card (about x 718–905 px) touch or
  overlap.
- The Sun → Rise and Rise → East edges route underneath the East card.
- The compass is drawn as a plain "Compass / main" card on the far left, joined to East by a
  line. It is not drawn as a compass rose with bearings.
- The layout's overlap tests pass on OSG `position`/`size`, but the 2D React Flow cards are much
  wider than the OSG footprint after `FLOW_SCALE`, so the check does not cover what learners see.

## Evidence

`tests/visual/north-star.spec.ts-snapshots/sun-east-linux.png` (the arrowheads come from D-005;
the node positions are unchanged from the earlier approved baseline).
`tests/golden/layout-structure.test.ts` checks OSG boxes only.

## Suggested fix

Either make the 2D card footprint part of the layout's node size, or have `osgToFlow` apply a
measured-size collision pass. Add a browser assertion that no two rendered
`.react-flow__node` boxes intersect in the North Star and golden 2D scenes. Draw the 2D compass
anchor with the `compass` primitive's 2D icon, placing East at its bearing.

## Resolution (2026-09-24, codex-3)

Resolved. The canvas now converts OSG centre coordinates to React Flow top-left coordinates using
the actual rendered footprint, preserves those dimensions during presentation playback, and runs
a deterministic pixel-footprint collision pass for cards whose UI minimum is larger than their
world-space primitive. Compass motion chains resolve their bearing transitively, so Sun → Rise →
East is laid out along the eastern bearing.

The 2D North Star uses the registered `compass`, `sun` and `curved_arrow` SVG renderers. The compass
rose labels N/E/S/W and emphasizes E by both weight/length and colour. The Sun crosses a labelled
eastern horizon, while the rise arc and both directed edges remain clear of every node. The
redundant compass → East bearing line stays in the semantic outline but is hidden on the 2D canvas;
the highlighted E spoke already communicates that relation and avoids routing through the Sun.

Evidence:

- `tests/visual/north-star.spec.ts` measures live `.react-flow__node` rectangles for sun/east,
  cycle and timeline and fails on any intersection over 0.5 px.
- `apps/web/src/canvas/model.test.ts` checks the North Star footprint model and hidden redundant
  bearing edge.
- `packages/pipeline/layout/src/index.test.ts` checks transitive bearing placement.
- Reviewed baseline: `tests/visual/north-star.spec.ts-snapshots/sun-east-linux.png`.
- Full verification: 592/592 unit/integration tests; golden 15/15; browser 15 passed and 1 skipped
  (hardware-only FPS); build, typecheck, lint, Prettier and `git diff --check` passed.
