# Pedagogy notes

Opsis is an education tool first (PROMPT.md §1, §12.1). This file collects the misconceptions,
nuances and audience notes that the Explainer, Metaphor and Pedagogy Reviewer agents MUST
respect. Each entry lists the trigger, the misconception, the accurate framing and how the
diagram/explanation should surface it.

The explainer (`packages/pipeline/explain`) loads the misconceptions below from
`src/knowledge.ts` and the audience wording rules from `src/audience.ts`. A test
(`src/pedagogy.test.ts`) fails if an entry or rule there is missing from this file, so change both
together.

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

### P-002: Earth orbits the Sun, not the reverse

- Trigger: "the sun orbits the earth", "the sun goes around the earth", any explanation of **orbit**/**revolve**.
- Misconception: the Sun travels around a stationary Earth (geocentric model).
- Accurate framing: Earth orbits the Sun once a year; the Sun's daily path across our sky is caused by Earth rotating once a day.
- Surface as: Parser adds a misconception note on the `orbit` action; the explainer quotes it in `commonMisconception`.
- Audience notes: child: "Earth travels around the Sun. The Sun does not go around Earth." Teen/adult: separate orbit (a year) from rotation (a day).
- Golden case: 11 — "The Earth orbits the Sun."

### P-003: Whales and dolphins are not fish

- Trigger: "a whale is a fish", "dolphins are fish", explanations of whale/dolphin.
- Misconception: anything that lives in water and swims is a fish.
- Accurate framing: Whales and dolphins are mammals: they breathe air with lungs and feed their young milk.
- Surface as: Is-a relation carries a misconception note; explanation states the accurate class first.
- Audience notes: child: "They live in water, but they are mammals. They breathe air." Adults may add "cetaceans".
- Golden case: none

### P-004: Bats are not birds

- Trigger: "a bat is a bird", explanations of bat.
- Misconception: anything that flies is a bird.
- Accurate framing: Bats are mammals with fur that feed their young milk; their wings are skin stretched over long finger bones.
- Surface as: Misconception note on the is-a relation.
- Audience notes: child: "Bats can fly, but they are mammals, not birds."
- Golden case: none

### P-005: Spiders are not insects

- Trigger: "a spider is an insect", explanations of spider.
- Misconception: all small crawling animals are insects.
- Accurate framing: Spiders are arachnids: eight legs and two main body parts; insects have six legs and three body parts.
- Surface as: Misconception note on the is-a relation.
- Audience notes: child: count the legs (eight vs six).
- Golden case: none

### P-006: A tomato is botanically a fruit

- Trigger: "tomato is a vegetable", any explanation of tomato (e.g. the sandwich drill-down).
- Misconception: tomatoes are vegetables, full stop.
- Accurate framing: Botanically a tomato is a fruit because it develops from the flower and holds seeds; in cooking it is treated as a vegetable. Both uses are legitimate in their own context, so the culinary word is not "wrong", only incomplete.
- Surface as: `commonMisconception` on the tomato explanation; the tomato drill-down shows the seeds.
- Audience notes: child: "Cooks call a tomato a vegetable, but it is a fruit: it grows from a flower and holds seeds."
- Golden case: 2 — sandwich → tomato drill-down.

### P-007: Not all birds can fly

- Trigger: "birds fly", "some birds cannot fly", explanations of bird/fly.
- Misconception: every bird can fly (or, from "some birds cannot fly", that most birds cannot).
- Accurate framing: Most birds fly; flightless birds such as penguins, ostriches and kiwis do not.
- Surface as: The negated relation is drawn with its modality; a nuance chip names examples.
- Audience notes: child: "Most birds can fly, but some, like penguins and ostriches, cannot."
- Golden case: 14 — "Some birds cannot fly."

### P-008: Clouds are not water vapour

- Trigger: "water evaporates and forms clouds", explanations of cloud.
- Misconception: clouds are steam or water vapour.
- Accurate framing: Water vapour is an invisible gas; clouds are tiny liquid droplets or ice crystals that form when vapour cools and condenses.
- Surface as: The evaporation → cloud step is labelled "condenses"; explanation of cloud names droplets.
- Audience notes: child: "Clouds are made of tiny drops of water or bits of ice."
- Golden case: 3 — water cycle.

### P-009: Plants do not eat soil

- Trigger: photosynthesis sentences, explanations of plant.
- Misconception: plants take their food (mass) from the soil.
- Accurate framing: Plants make sugar from carbon dioxide and water using light energy; most of a plant's mass comes from carbon dioxide in the air. Roots take up water and small amounts of minerals.
- Surface as: Flow diagram shows carbon dioxide as an input; the explanation says where the mass comes from.
- Audience notes: child: "Plants make their own food from air, water and sunlight."
- Golden case: 7 — photosynthesis.

### P-010: Blood is never blue

- Trigger: heart/blood sentences, explanations of blood or vein.
- Misconception: blood in veins is blue until it meets oxygen.
- Accurate framing: Blood is always red; oxygen-poor blood is darker red. Veins look blue because of how skin scatters and absorbs light. Diagrams use blue only as a convention for oxygen-poor blood.
- Surface as: If the diagram colours vessels, the legend says the colour is a convention.
- Audience notes: child: "Blood is never blue. It is dark red when it has less oxygen."
- Golden case: 6 — "The heart pumps blood to the lungs."

### P-011: Electrons do not orbit like planets

- Trigger: atom sentences, explanations of atom or electron.
- Misconception: electrons circle the nucleus on fixed tracks, like planets around the Sun.
- Accurate framing: Electrons occupy fuzzy regions (orbitals) around the nucleus; the ring picture is a simplified model.
- Surface as: The atom container draws electrons around the nucleus; the explanation calls the picture a model.
- Audience notes: child: "Electrons do not circle the middle of an atom like tiny planets." Adults may mention orbitals.
- Golden case: 9 — "An atom has a nucleus and electrons."

### P-012: Melting is not dissolving or disappearing

- Trigger: "ice melts", explanations of melt or ice.
- Misconception: melting ice "disappears" or dissolves; its temperature keeps rising while it melts.
- Accurate framing: Melting is a change of state from solid to liquid; at normal pressure ice stays at 0 °C while it melts because the heat goes into loosening the bonds between molecules.
- Surface as: Before → after morph keeps the same amount of water.
- Audience notes: child: "Melting ice turns into water. Nothing disappears; the water only changes form."
- Golden case: 13 — "Ice melts into water when it gets warm."

## Audience wording (explainer, `explain/v1`)

`Explanation.audience` selects a reading level. The prompt quotes these rules word for word
(`packages/pipeline/explain/src/audience.ts`), and the offline fallback follows them in its
templates.

### child — about 8 to 11

- Use short sentences of about 12 words or fewer, in everyday words.
- Avoid technical terms; if one is unavoidable, explain it straight away with a familiar comparison.
- Describe one idea per sentence and speak to the reader as "you".
- Keep every simplification true: say "the Sun looks like it rises", never "the Sun rises up".

### teen — about 12 to 16

- Use clear sentences; give a one-clause definition the first time a key term appears.
- Explain cause and effect ("because", "so") rather than only naming things.
- Scientific names are fine when defined; avoid unexplained abbreviations.

### adult — curious non-specialist

- Be precise and concise; standard terminology is fine.
- Mention important exceptions or nuance in a few words rather than over-simplifying.

### Every audience

- Simplify truthfully: a simpler statement must still be correct.
- State only well-established facts. Never present a guess, rumour or opinion as fact.
- Do not use "just", "simply" or "obviously"; they make learners feel slow.
- Do not say "always" or "never" unless it is strictly true.
- Use neutral, kind language that is safe for students.

## Explanation rules the code enforces

- **Grounding.** `sections.whyItMattersHere` must name the clicked part or another thing from the
  student's sentence; replies that do not are sent back once for repair.
- **Honest confidence.** A reply that hedges ("probably", "maybe", "I think"…) cannot claim
  `confidence: "high"`. When the parser marked the node `attributes.confidence = "low"`, a
  `"high"` reply is capped at `"medium"`.
- **Offline fallback.** Without a working LLM the explainer builds the explanation only from the
  SG (entity summary, the relation that ties the part to the sentence, any SG pedagogy note, else
  the curated misconception above). It adds no new facts and always sets `confidence: "low"`, so
  the UI shows the "unsure" indicator (PROMPT.md §12.1).
- **Drill-down parts.** Child diagrams use the parts in this order: parts the caller passes (an
  explanation's `suggestedDrillDown`), parts already named in the parent SG, the curated
  `KNOWN_PARTS` list in `src/knowledge.ts` (textbook structure only), then LLM suggestions with
  confidence above `"low"`. If none is available, Opsis says it does not know the parts yet rather
  than guessing.

## Offline parser coverage for golden cases 3, 7, 11 and 13 (release review)

- **Curated cycles only.** A step chain ("Water evaporates, forms clouds, and falls as rain") is
  closed into a loop only when it matches a curated textbook cycle (`KNOWN_CYCLES` in
  `packages/pipeline/parse/src/fallback.ts`; today only the water cycle). Other chains stay open, so
  the offline parser never invents a cycle.
- **Energy is used, not transformed.** In "X uses A, B and C to make D and E", energy inputs
  (sunlight, light, energy, heat) are drawn only as used by X. Only matter-carrying inputs get
  `transforms_into` arrows to the products. Those arrows show the overall reactants → products
  equation, not which atom goes where.
- **Process nodes.** "Ice melts into water when it gets warm" draws `melt` as its own node, with
  `warm` causing it, so the condition points at the process rather than at the water.
- New SG notes from the offline parser: P-008 (nuance on `cloud` when evaporation is named),
  P-009 (misconception on `carbon dioxide` when a plant uses it), P-012 (misconception on `melt`
  when ice melts).

## §14.3 score record: release review, 2026-09-24 (claude-1)

Sample: 20 `level: "explanation"` responses from `POST /v1/explain`, taken from the offline
pipeline output of all 15 golden cases. The North Star nodes (sun, east, rises, tomato) were always
included. The other 16 were drawn with a fixed-seed PRNG (seed 20260924), and audiences were
assigned child → teen → adult in turn. No LLM provider was configured, so every response is the
deterministic SG-only fallback (`confidence: "low"`, so the "unsure" indicator shows). Scores are
1–5 for accuracy (Acc), clarity for the audience (Cla), relevance to the utterance (Rel) and
misconception handling (Mis).

| #   | Case / node | Audience | Acc  | Cla  | Rel  | Mis  | Mean     |
| --- | ----------- | -------- | ---- | ---- | ---- | ---- | -------- |
| 1   | 01 sun      | child    | 5    | 4    | 4    | 4    | 4.25     |
| 2   | 01 east     | teen     | 5    | 5    | 4    | 5    | 4.75     |
| 3   | 01 rises    | adult    | 5    | 4    | 4    | 5    | 4.50     |
| 4   | 02 tomato   | child    | 5    | 5    | 5    | 5    | 5.00     |
| 5   | 02 ham      | teen     | 5    | 5    | 5    | 4    | 4.75     |
| 6   | 14 bird     | adult    | 5    | 5    | 4    | 5    | 4.75     |
| 7   | 10 boil     | child    | 5    | 3    | 4    | 4    | 4.00     |
| 8   | 08 Nairobi  | teen     | 5    | 5    | 4    | 4    | 4.50     |
| 9   | 13 melt     | adult    | 5    | 5    | 4    | 5    | 4.75     |
| 10  | 09 electron | child    | 5    | 3    | 4    | 5    | 4.25     |
| 11  | 07 sugar    | teen     | 5    | 5    | 4    | 4    | 4.50     |
| 12  | 14 fly      | adult    | 5    | 5    | 4    | 5    | 4.75     |
| 13  | 04 animal   | child    | 4    | 4    | 4    | 4    | 4.00     |
| 14  | 03 cloud    | teen     | 5    | 5    | 4    | 5    | 4.75     |
| 15  | 11 Earth    | adult    | 5    | 5    | 4    | 4    | 4.50     |
| 16  | 08 Mombasa  | child    | 5    | 4    | 4    | 4    | 4.25     |
| 17  | 07 plant    | teen     | 5    | 5    | 4    | 5    | 4.75     |
| 18  | 06 lungs    | adult    | 5    | 5    | 4    | 4    | 4.50     |
| 19  | 10 add      | child    | 5    | 4    | 4    | 4    | 4.25     |
| 20  | 02 bread    | teen     | 5    | 5    | 5    | 4    | 4.75     |
|     | **Mean**    |          | 4.95 | 4.55 | 4.15 | 4.45 | **4.53** |

- **Result: 4.53 / 5 ≥ 4.2 target.** No accuracy score is 1 or 2, so no major pedagogy bug.
- **Fixed during review.** Before this review, electron and lungs (and every case 6, 9 and 12
  entity) had the empty, ungrammatical summary "Electrons is named in your sentence…". They would
  have scored Cla 2 and Rel 3. Curated summaries were added, and the generic template now quotes
  the word.
- **Weakest dimension: relevance (4.15).** The offline `whyItMattersHere` is a template ("the word
  X is linked to Y; the diagram shows how they connect"). It is grounded, but it does not say what
  the link means. Child clarity drops where a curated summary uses a technical word ("vapour",
  "negative charge"), because the offline path uses one summary for every audience.
- **Not sampled.** LLM-written explanations (no provider or harness was configured in this
  environment). Score them on the first provider-backed run.
