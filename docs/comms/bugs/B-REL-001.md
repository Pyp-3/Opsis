---
type: bug
id: B-REL-001
severity: minor
found_by: pedagogy-reviewer
owner: canvas-agent
---

## Utterance / input

"Water evaporates, forms clouds, and falls as rain." (visual baseline `cycle-flow`), and any 2D
scene.

## Steps

1. Run `pnpm test:browser tests/visual` and open
   `tests/visual/north-star.spec.ts-snapshots/cycle-flow-linux.png`.

## Expected

Cycle edges follow the ring clockwise without crossing (oriented-flow grammar). Canvas chrome
shows its content.

## Actual

- Nodes have fixed right-side source and left-side target handles, so the Clouds → Rain and
  Rain → Water edges cross in an X below the ring. Direction is still correct (arrowheads, since
  D-005), and the text outline lists every connection.
- The minimap renders as an empty white panel, and the zoom controls at the bottom left show no
  icons in the baselines.
- Each node card shows its raw primitive id (`labeled_card`) as a subtitle.

## Evidence

`tests/visual/north-star.spec.ts-snapshots/{cycle-flow,timeline-flow}-linux.png`.
