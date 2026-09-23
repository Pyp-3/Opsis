# Pedagogy notes

Opsis is an education tool first (PROMPT.md §1, §12.1). This file collects the misconceptions,
nuances and audience notes that the Explainer, Metaphor and Pedagogy Reviewer agents MUST
respect. Each entry lists the trigger, the misconception, the accurate framing and how the
diagram/explanation should surface it.

## Entry format

```
### P-0xx: <short title>
- Trigger: utterances / words that should surface this note
- Misconception:
- Accurate framing:
- Surface as: diagram cue + explanation text
- Audience notes:
- Golden case: fixtures/golden/<id> (if any)
```

## Misconceptions

### P-001: The Sun does not literally rise

- Trigger: "the sun rises", "sunrise", "the sun sets", "the sun moves across the sky".
- Misconception: the Sun moves up from below the horizon and travels across the sky around
  a stationary Earth.
- Accurate framing: the Sun only _appears_ to rise in the east because Earth rotates from
  west to east (anticlockwise seen from above the North Pole), turning our horizon towards the
  Sun. The Sun's position relative to Earth barely changes over a day. Exactly due east is only
  true near the equinoxes; through the year sunrise shifts north or south of east.
- Surface as: the "rises" relation carries a pedagogy chip ("appears to — Earth rotates");
  clicking **rises** opens the explanation in PROMPT.md §2.1. The rising arc stays in the
  diagram (it is what we observe) but is labelled as apparent motion.
- Audience notes: for young learners, "Earth spins, so the Sun looks like it rises"; for older
  learners, add the rotation direction and the seasonal shift of the sunrise point.
- Golden case: 1 — "The sun rises in the east." (PROMPT.md §14.2).
