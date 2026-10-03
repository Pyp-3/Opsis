# PROMPT.md — Opsis

> **Opsis** (Greek: ὄψις, "sight"). *See what you mean.*
>
> Historical specification for the retired pipeline and 3D application. Its workflow,
> roles and precedence rules are superseded by [AGENTS.md](AGENTS.md). Retained as
> design history; use README and current contracts for the supported application.

---

## 0. How to use this document

1. Every agent reads **Sections 1–6** before doing anything.
2. Each agent then reads its own role in **Section 7** and the contracts it touches in **Sections 4, 5 and 8**.
3. Work proceeds milestone by milestone (**Section 13**). No agent starts work on milestone N+1 until milestone N passes its acceptance criteria (**Section 14**).
4. All inter-agent communication uses the message formats in **Section 8**.
5. If something is ambiguous, do not guess silently. Record the ambiguity in `docs/DECISIONS.md` using the format in **Section 8.5**, pick the most conservative option, and continue.

Keywords **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT** and **MAY** follow RFC 2119 meaning.

---

## 1. Mission

Many words and ideas are misunderstood because the reader has no picture of them. Opsis turns natural-language text into **interactive, explorable visual diagrams** so that learners can *see* what a sentence means.

Opsis is:

- **A canvas** where people and AI co-create diagrams from words.
- **A translator** from language to structure (graph theory) to picture (visual metaphors).
- **An explorer** where every part of a diagram can be clicked, opened, disassembled and explained, recursively.
- **An education tool first.** Accuracy, clarity and accessibility beat visual flair.

The feel we are aiming for combines three references:

| Reference | What we borrow |
|---|---|
| Typesetting/diagram languages (LaTeX/TikZ, Typst, Mermaid) | Text is the source of truth; diagrams are reproducible from text. |
| n8n / node-based editors | Smooth, draggable nodes, visible connections, delightful direct manipulation. |
| Engineering "exploded view" drawings | Wholes can be pulled apart into labelled parts and reassembled. |

---

## 2. Two guiding examples (the North Star)

Every design decision must make these two examples work beautifully. Agents SHOULD test against them constantly.

### 2.1 "The sun rises in the east."

Expected result:

- A **compass** rose is the anchor visual, with **East** highlighted.
- A **sun** icon sits on the eastern horizon, with a short arc/arrow showing upward motion (rising).
- An optional horizon line separates sky and ground.
- Clicking **sun** → summary: "The Sun is the star at the centre of our solar system."
- Clicking **east** → summary: "East is the direction where the Sun appears to rise."
- Clicking **rises** → explanation that the Sun only *appears* to rise because Earth rotates west-to-east. (Opsis must surface this kind of scientific nuance: pedagogy over literalism.)

### 2.2 "A sandwich can contain bread, tomato, ham."

Expected result:

- A **sandwich** is rendered as a stacked assembly: bread (top), ham, tomato, bread (bottom).
- An **Explode** control (and a gesture) animates the layers apart along the vertical axis, each with a label and a leader line.
- Each part is clickable:
  - **Single click** → short summary (1–2 sentences) in a side panel.
  - **"Explain more"** or double click → full explanation (structured: what it is, where it comes from, why it matters here, fun fact).
  - **"Open"** → drill down into that part as its own diagram (e.g. tomato → skin, flesh, seeds). Breadcrumbs show the path: `Sandwich › Tomato › Seeds`.
- The word "can" is respected: parts are marked as **optional/possible**, not required (e.g. dashed outline or an "optional" badge).

---

## 3. Glossary

| Term | Meaning |
|---|---|
| **Utterance** | The raw text the user types. |
| **Semantic Graph (SG)** | Language-level structure extracted from an utterance: entities, relations, attributes. No visuals. |
| **Visual Plan (VP)** | The SG mapped to visual metaphors, primitives and layout intent. |
| **Opsis Scene Graph (OSG)** | The final, renderable, versioned JSON document. The contract between backend and renderer. |
| **Primitive** | A reusable visual building block (compass, arrow, container, stack, sun, person, cycle…). |
| **Metaphor** | A rule that maps a relation type to a visual arrangement (e.g. `direction` → compass). |
| **Part** | A node that belongs to a whole via `has_part`. Parts can be exploded and drilled into. |
| **Drill-down** | Opening a node as a new, child diagram generated on demand. |
| **Explode / Assemble** | Animated separation / recombination of a whole's parts. |
| **Detail levels** | `label` → `summary` → `explanation` → `deep_dive` (child diagram). |
| **Canvas** | The interactive surface (2D node mode and 3D scene mode). |

---

## 4. System architecture

### 4.1 Pipeline overview

```
Utterance
   │
   ▼
[1] Semantic Parser ──► Semantic Graph (SG)
   │
   ▼
[2] Metaphor Selector ──► Visual Plan (VP)
   │
   ▼
[3] Layout Engine ──► positioned OSG (x, y, z, sizes, groups)
   │
   ▼
[4] Renderer (Three.js / 2D node canvas) ──► interactive scene
   │
   ▲ user clicks a node
   │
[5] Explainer (lazy) ──► summary / explanation / child diagram
```

Principles:

- **Each stage is a pure function of its input plus configuration.** Same input + same seed ⇒ same output. This makes caching, testing and sharing possible.
- **Every stage's output is validated against a schema** (Zod on the TypeScript side). Invalid output MUST be rejected and retried or repaired, never passed downstream.
- **LLM calls live only in stages 1, 2 and 5.** Layout and rendering are deterministic code.
- **Explanations are lazy.** Only labels and one-line summaries are produced up front; deeper content is fetched on click and cached.

### 4.2 Deployment shape

- **Frontend:** single-page app (Section 6).
- **Backend:** a small API service that owns LLM calls, caching and persistence.
- **LLM provider:** abstracted behind an interface `LLMClient` so providers can be swapped. Model names and keys come from environment variables, never hard-coded.

---

## 5. Data contracts

All contracts live in `packages/schema` and are the only place types are defined. Frontend and backend import from there. Every document carries `schemaVersion`.

### 5.1 Semantic Graph (SG)

```ts
type SemanticGraph = {
  schemaVersion: "sg/1";
  utterance: string;
  language: string;               // BCP-47, e.g. "en"
  entities: Entity[];
  relations: Relation[];
  notes?: PedagogyNote[];         // misconceptions, nuance (e.g. "sun only appears to rise")
};

type Entity = {
  id: string;                     // stable slug, e.g. "e_tomato"
  surface: string;                // text as written: "tomato"
  lemma: string;                  // "tomato"
  kind: EntityKind;               // see 5.1.1
  span: [number, number];         // char offsets in utterance
  attributes?: Record<string, string | number | boolean>;
  summary: string;                // ≤ 25 words, grade-appropriate
};

type Relation = {
  id: string;
  type: RelationType;             // see 5.1.2
  source: string;                 // entity id
  target: string;                 // entity id
  modality: "certain" | "possible" | "typical" | "negated";  // "can contain" → possible
  order?: number;                 // for sequences / stacking
  evidenceSpan?: [number, number];
};

type PedagogyNote = {
  targetId: string;               // entity or relation id
  kind: "misconception" | "nuance" | "safety" | "ambiguity";
  text: string;
};
```

#### 5.1.1 `EntityKind`

`object | substance | living_thing | person | place | direction | celestial_body | event | process | quantity | time | abstract_concept | action`

#### 5.1.2 `RelationType` (taxonomy)

| Type | Meaning | Default metaphor |
|---|---|---|
| `has_part` / `contains` | Composition | Stack or container with explodable parts |
| `is_a` | Classification | Tree / hierarchy |
| `located_at` | Position | Map / scene placement |
| `direction` | Orientation | Compass |
| `moves` | Motion | Arrow along path |
| `causes` | Causality | Directed arrow with "→ leads to" |
| `precedes` | Sequence/time | Timeline or flow |
| `cycle` | Repeating process | Circular flow |
| `compares` | Bigger/smaller/same | Side-by-side scale |
| `quantity` | Amounts | Bar/count glyphs |
| `transforms_into` | Change of state | Before → after morph |
| `property_of` | Attribute | Badge/tag on node |
| `agent_of` / `acts_on` | Who does what to whom | Actor → action → object |

Agents MAY propose new types via a Decision Record (8.5). They MUST NOT invent types ad hoc in code.

### 5.2 Visual Plan (VP)

```ts
type VisualPlan = {
  schemaVersion: "vp/1";
  sgRef: string;                  // hash of the SG
  anchor: string;                 // node id of the main visual (e.g. compass, sandwich)
  scenes: SceneIntent[];          // usually 1; multiple for "compare" or "before/after"
};

type SceneIntent = {
  id: string;
  metaphor: MetaphorId;           // "compass" | "stack" | "container" | "cycle" | "timeline" | "tree" | "flow" | "scale" | "map" | "actor_action"
  nodes: VisualNode[];
  edges: VisualEdge[];
  camera?: "top" | "front" | "iso" | "free";
  dimension: "2d" | "3d" | "auto";
};

type VisualNode = {
  id: string;                     // same id as the SG entity where possible
  primitive: PrimitiveId;         // from the primitive library (Section 9)
  label: string;
  role: "anchor" | "part" | "actor" | "object" | "modifier" | "context";
  optional?: boolean;             // from modality "possible"
  style?: { emphasis?: "none" | "highlight"; colorToken?: string };
  explodable?: boolean;
  drillable?: boolean;
};

type VisualEdge = {
  id: string;
  from: string;
  to: string;
  kind: "arrow" | "line" | "leader" | "containment" | "path";
  label?: string;
  animated?: boolean;
};
```

### 5.3 Opsis Scene Graph (OSG) — the renderable document

```ts
type OSG = {
  schemaVersion: "osg/1";
  id: string;                     // uuid
  title: string;
  utterance: string;
  createdAt: string;              // ISO 8601
  seed: number;                   // for deterministic layout
  sg: SemanticGraph;              // kept for traceability
  scenes: PositionedScene[];
  breadcrumbs: { id: string; label: string }[];  // drill-down path
  parentId?: string;              // if this is a child diagram
};

type PositionedScene = SceneIntent & {
  nodes: (VisualNode & {
    position: [number, number, number];
    size: [number, number, number];
    rotation?: [number, number, number];
    explodedPosition?: [number, number, number];   // target when exploded
  })[];
  bounds: { min: [number, number, number]; max: [number, number, number] };
};
```

### 5.4 Explanation payload (lazy)

```ts
type Explanation = {
  schemaVersion: "exp/1";
  nodeId: string;
  osgId: string;
  level: "summary" | "explanation";
  audience: "child" | "teen" | "adult";   // reading level
  summary: string;                        // ≤ 25 words
  sections?: {
    whatItIs: string;
    whyItMattersHere: string;             // tied to the utterance's context
    howItWorks?: string;
    funFact?: string;
    commonMisconception?: string;
  };
  confidence: "high" | "medium" | "low";
  suggestedDrillDown?: string[];          // candidate child parts, e.g. ["skin","flesh","seeds"]
};
```

### 5.5 Validation rules (enforced by schema package)

- Every edge endpoint MUST reference an existing node.
- Node ids are unique within a scene.
- `summary` ≤ 25 words; `label` ≤ 4 words.
- A scene MUST have exactly one `anchor`.
- `optional: true` MUST correspond to a relation with modality `possible`.
- No NaN/Infinity in positions. Bounds must contain all nodes.

---

## 6. Technology stack

Use these unless a Decision Record justifies a change.

| Concern | Choice | Notes |
|---|---|---|
| Language | **TypeScript** (strict) everywhere | Shared types in `packages/schema`. |
| Monorepo | pnpm workspaces | `apps/web`, `apps/api`, `packages/*`. |
| Build | Vite | Fast dev server. |
| UI | React 18+ | |
| 3D | **three.js** via **@react-three/fiber** and **@react-three/drei** | Main renderer for scenes, exploded views, compass etc. |
| 2D node canvas | **React Flow (@xyflow/react)** | The n8n-style editing surface. |
| Graph algorithms | **graphology** | Cycle detection, traversal, centrality for anchor choice. |
| Layout | **elkjs** (layered/tree), **d3-force** (organic), custom metaphor layouts | See Section 10. |
| Animation | **@react-spring/three** (3D) and **framer-motion** (2D/UI) | Respect reduced motion. |
| State | **zustand** | One store for canvas, one for session. |
| Validation | **zod** | Runtime validation of every contract. |
| Math/science text | **KaTeX** | For formulas in explanations. |
| Text import | **Mermaid** (optional importer) | Import existing diagrams into OSG. |
| Styling | CSS variables + Tailwind | Design tokens in `packages/ui`. |
| API | **Fastify** (Node) | Endpoints in Section 11. |
| Persistence | SQLite (dev) → Postgres (prod) via **Drizzle ORM** | Store OSGs, explanations, cache. |
| Cache | In-memory LRU + DB | Key = hash(stage, input, config, model). |
| Tests | **Vitest** (unit), **Playwright** (E2E + screenshots) | |
| Lint/format | ESLint + Prettier | CI blocks on failure. |
| Export | PNG, SVG (2D), GLB (3D), JSON (OSG) | |

**Asset rule:** all icons, models and primitives MUST be original: procedurally generated geometry, hand-authored SVG, or assets under a permissive license (CC0/MIT) with the license recorded in `assets/LICENSES.md`. No trademarked characters, logos or copyrighted artwork.

---

## 7. Agent roles

Each agent owns specific directories. An agent MUST NOT edit files owned by another agent without a handoff message (8.2) approved by the Orchestrator.

### 7.1 Orchestrator (Lead)

- **Owns:** `docs/`, `PLAN.md`, milestone tracking, CI config.
- **Does:** breaks milestones into tickets, assigns them, reviews handoffs, enforces acceptance criteria, resolves conflicts, keeps `docs/DECISIONS.md` current.
- **Must not:** write feature code except glue and fixes to unblock others.
- **Output each cycle:** status report (8.3).

### 7.2 Schema Agent

- **Owns:** `packages/schema`.
- **Does:** implements Section 5 as Zod schemas + inferred TS types, validators, fixture generators, versioning and migrations.
- **Done when:** every contract has a schema, valid/invalid fixtures, and 100% test coverage on validators.

### 7.3 Semantic Parser Agent

- **Owns:** `packages/pipeline/parse`.
- **Does:** Utterance → SG. Uses the LLM with a strict JSON-only system prompt, validates with Zod, repairs or retries up to 2 times, then fails gracefully with a readable error.
- **Must:** capture modality ("can", "sometimes", "never"), ordering, directions, and pedagogy notes (misconceptions).
- **Must:** keep a deterministic rule-based fallback for simple patterns (X contains A, B, C; X is in the Y; X causes Y) so the demo works offline.

### 7.4 Metaphor Agent

- **Owns:** `packages/pipeline/metaphor`.
- **Does:** SG → VP. Picks the anchor and metaphor using the table in 5.1.2 plus the rules in Section 10.1. Maps entities to primitives (Section 9).
- **Must:** be rule-first, LLM-second. Rules decide when they apply; the LLM is consulted only for ties or unknown entities, and its answer must be validated against the primitive registry.

### 7.5 Layout Agent

- **Owns:** `packages/pipeline/layout`.
- **Does:** VP → OSG positions, including `explodedPosition` for every explodable part. Deterministic given `seed`.
- **Must:** guarantee no label overlap in default view and no node overlap in either assembled or exploded state.

### 7.6 Renderer Agent (3D)

- **Owns:** `apps/web/src/scene`, `packages/primitives`.
- **Does:** renders OSG with react-three-fiber; builds the primitive library; implements explode/assemble, hover, selection, camera controls, labels (drei `Html`/`Text`), leader lines.
- **Must:** hit the performance budgets (Section 12.3).

### 7.7 Canvas Agent (2D / n8n feel)

- **Owns:** `apps/web/src/canvas`.
- **Does:** React Flow editor that shows the same OSG as draggable nodes and edges; lets users add, delete, relink and relabel nodes; syncs edits back into the OSG; toggles 2D ↔ 3D without losing state.
- **Must:** feel smooth: snapping, minimap, zoom-to-fit, undo/redo (≥ 50 steps), keyboard shortcuts.

### 7.8 Explainer Agent

- **Owns:** `packages/pipeline/explain`.
- **Does:** node + context → Explanation (5.4) and child diagrams for drill-down (runs the pipeline recursively with context from the parent).
- **Must:** adapt to `audience`; always ground `whyItMattersHere` in the original utterance; set `confidence` honestly; never present speculation as fact.

### 7.9 UX & Accessibility Agent

- **Owns:** `apps/web/src/ui`, `packages/ui`.
- **Does:** input bar, side panel, breadcrumbs, toolbar (Explode, 2D/3D, Export, Reading level), onboarding, empty/error/loading states; enforces Section 12.2.

### 7.10 API Agent

- **Owns:** `apps/api`.
- **Does:** endpoints (Section 11), LLM client abstraction, caching, rate limiting, persistence, sharing links.

### 7.11 QA Agent

- **Owns:** `tests/`, `fixtures/golden/`.
- **Does:** golden-utterance suite (Section 14.2), E2E flows, visual regression screenshots, schema fuzzing, performance checks. Files bugs using 8.4.
- **Has veto** over milestone completion.

### 7.12 Pedagogy Reviewer Agent

- **Owns:** `docs/PEDAGOGY.md`, prompt templates' educational wording.
- **Does:** reviews explanations for accuracy, age-appropriateness and misconceptions; maintains the misconceptions list (e.g. the Sun "rising"); samples 20 golden outputs per milestone and scores them (Section 14.3).

---

## 8. Communication protocol

All messages are Markdown with a YAML header, stored under `docs/comms/` with filename `YYYYMMDD-HHMM-<from>-<type>.md`.

### 8.1 Task ticket (Orchestrator → Agent)

```yaml
---
type: ticket
id: T-042
milestone: M2
assignee: layout-agent
depends_on: [T-038]
contracts: [vp/1, osg/1]
---
```
Body sections: **Goal**, **Inputs**, **Expected outputs**, **Acceptance criteria** (checklist), **Out of scope**.

### 8.2 Handoff (Agent → Agent, via Orchestrator)

```yaml
---
type: handoff
ticket: T-042
from: layout-agent
to: renderer-agent
artifacts: [packages/pipeline/layout/src/stack.ts, fixtures/osg/sandwich.json]
---
```
Body: **What changed**, **How to use it**, **Known limitations**, **Tests added**.

### 8.3 Status report (every agent, end of each work cycle)

```yaml
---
type: status
agent: renderer-agent
milestone: M2
---
```
Body: **Done**, **In progress**, **Blocked by** (with ticket ids), **Next**, **Risks**.

### 8.4 Bug report

```yaml
---
type: bug
id: B-017
severity: blocker | major | minor | cosmetic
found_by: qa-agent
owner: layout-agent
---
```
Body: **Utterance / input**, **Steps**, **Expected**, **Actual**, **Evidence** (screenshot path, failing test).

### 8.5 Decision Record

Append to `docs/DECISIONS.md`:

```
## D-0xx: <title>
- Date:
- Author:
- Context:
- Options considered:
- Decision:
- Consequences:
```

### 8.6 Rules

- One ticket, one owner.
- Never break a published contract version. Change = new version + migration + Decision Record.
- A handoff without tests is rejected.
- If blocked for more than one cycle, escalate to the Orchestrator with a proposed workaround.

---

## 9. Primitive library

Located in `packages/primitives`. Each primitive exports:

```ts
type PrimitiveDef = {
  id: PrimitiveId;
  category: "direction" | "container" | "nature" | "celestial" | "food" | "people" | "flow" | "shape" | "measure" | "generic";
  keywords: string[];               // for matching entities: ["compass","north","east","direction"]
  dimensions: ("2d" | "3d")[];
  render3D?: React.FC<PrimitiveProps>;
  render2D?: React.FC<PrimitiveProps>;  // SVG
  anchors: Record<string, [number, number, number]>;  // attach points, e.g. compass.east
  explodeAxis?: [number, number, number];
};
```

**MVP set (M1–M2), minimum 25 primitives:**

- Direction: `compass` (with named anchors N/NE/E/…), `arrow`, `curved_arrow`, `horizon`.
- Celestial/nature: `sun`, `moon`, `earth`, `cloud`, `raindrop`, `tree`, `leaf`, `water`, `mountain`.
- Containers/structure: `box`, `stack_layer`, `bowl`, `cell` (circle membrane), `group_frame`.
- Food (for composition demos): `bread_slice`, `generic_layer`, `round_fruit`, `slice`.
- People/actions: `person` (simple, neutral figure), `hand`.
- Flow/measure: `cycle_ring`, `timeline_axis`, `scale_balance`, `bar`, `counter_dots`.
- Fallback: `labeled_card` (always available, never fails).

**Style:** friendly, flat-shaded low-poly in 3D; simple rounded strokes in 2D. One consistent palette from design tokens with a colour-blind-safe variant. No photorealism.

**Fallback rule:** if no primitive matches an entity with score ≥ 0.6, render `labeled_card` with an icon generated from its `EntityKind`. A diagram MUST never fail to render because of a missing primitive.

---

## 10. Metaphor selection and layout rules

### 10.1 Anchor & metaphor selection (Metaphor Agent)

Apply in order; first match wins:

1. Any `direction` relation or `direction` entity ⇒ metaphor `compass`; the directional entity is placed at the matching compass anchor.
2. Whole with ≥ 2 `has_part`/`contains` targets ⇒ `stack` if parts are layered things (food, strata, layers of atmosphere/earth), else `container`.
3. `cycle` relation or a detected graph cycle over `precedes`/`transforms_into` ⇒ `cycle`.
4. ≥ 3 `precedes` relations forming a path ⇒ `timeline` (time) or `flow` (process).
5. `is_a` relations forming a tree ⇒ `tree`.
6. `compares` ⇒ `scale` (two scenes side by side if needed).
7. `agent_of` + `acts_on` ⇒ `actor_action`.
8. Otherwise ⇒ `flow` with the highest-degree node (graphology degree centrality) as anchor.

Composite sentences MAY produce multiple scenes, but the MVP renders at most **3 scenes** per utterance.

### 10.2 Layout per metaphor (Layout Agent)

| Metaphor | Assembled layout | Exploded layout |
|---|---|---|
| `compass` | Compass centred; entities at bearing anchors, radius r. | N/A (not explodable); "motion" arrows animate. |
| `stack` | Parts stacked on Y by `order`, touching. | Parts spread on Y with gap = 1.5× part height; labels on the right with leader lines. |
| `container` | Parts packed inside the container bounds (circle packing). | Parts orbit outward radially, container fades to 30%. |
| `cycle` | Nodes evenly on a ring, arrows clockwise. | N/A. |
| `timeline` / `flow` | elkjs layered, left → right. | N/A. |
| `tree` | elkjs tree, top → bottom. | N/A. |
| `scale` | Two groups on a balance, tilt proportional to comparison. | N/A. |
| `actor_action` | Actor left, action arrow, object right. | N/A. |

Global rules:

- Deterministic for a given `seed`.
- Labels never overlap nodes or each other (run a label-collision pass).
- The scene fits the viewport with 10% padding at "zoom to fit".
- Optional parts (`modality: possible`) use dashed outlines and an "optional" badge.

---

## 11. API (API Agent)

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/v1/visualize` | `{ utterance, audience?, seed? }` → `OSG` |
| `POST` | `/v1/explain` | `{ osgId, nodeId, level, audience }` → `Explanation` |
| `POST` | `/v1/drilldown` | `{ osgId, nodeId }` → child `OSG` (with `parentId`, breadcrumbs) |
| `GET` | `/v1/osg/:id` | Load saved diagram |
| `PUT` | `/v1/osg/:id` | Save user edits (validated) |
| `POST` | `/v1/share/:id` | Create read-only share link |
| `GET` | `/v1/health` | Health check |

Requirements:

- All request/response bodies validated with the shared Zod schemas.
- Streaming (SSE) for `/v1/visualize` stage progress: `parsing → mapping → layout → done`, so the UI can show progress.
- Caching keyed by `hash(stage, normalizedInput, config, modelId)`.
- Rate limiting per client. Input length limit: 500 characters in MVP.
- Errors use `{ code, message, stage, retryable }`.

---

## 12. Non-functional requirements

### 12.1 Accuracy and education

- Explanations MUST be factually correct at the stated audience level; when simplifying, simplify truthfully.
- Pedagogy notes (misconceptions/nuance) MUST be surfaced in the UI as a gentle "Did you know?" chip, never hidden.
- `confidence: "low"` MUST display a visible "unsure" indicator.
- Content MUST be safe and appropriate for students; the parser refuses or neutralises harmful or explicit input with a friendly message.

### 12.2 Accessibility

- Every node has an accessible name and description (from label + summary).
- Full keyboard navigation: Tab through nodes, Enter = summary, Shift+Enter = explanation, `E` = explode/assemble, `O` = drill down, Backspace = up one breadcrumb.
- A text outline view ("Diagram as list") mirrors the scene for screen readers.
- Colour is never the only carrier of meaning; colour-blind-safe palette toggle.
- `prefers-reduced-motion` disables non-essential animation (explode becomes an instant switch).
- Contrast ≥ WCAG AA.

### 12.3 Performance budgets

- Time to first diagram (cached): < 300 ms. Uncached: < 6 s end to end, with progress shown after 300 ms.
- 60 fps on a mid-range laptop and ≥ 30 fps on a mid-range phone for scenes up to 50 nodes.
- Initial JS bundle < 400 KB gzipped (lazy-load three.js scene where possible).
- Explode/assemble animation duration 450–700 ms.

### 12.4 Internationalisation

- UI strings externalised. Pipeline accepts non-English input; `language` is detected and explanations answer in the same language. MVP ships English; architecture must not block other languages.

### 12.5 Privacy

- No accounts required for MVP. Diagrams are private unless shared. No personal data sent to the LLM beyond the utterance.

---

## 13. Milestones

### M0 — Foundations
Monorepo, CI, lint, `packages/schema` with all contracts and fixtures, empty web and api apps running, `docs/DECISIONS.md` started.

### M1 — Static North Star
Hand-written OSG fixtures for **sun/east** and **sandwich** render in 3D with correct primitives, labels, click → summary panel (from fixture), explode/assemble on the sandwich. No LLM yet.

### M2 — Live pipeline
Parser → Metaphor → Layout wired end to end through `/v1/visualize`. Rule-based fallback works offline. Golden suite (Section 14.2) passes ≥ 70%.

### M3 — Explanation & drill-down
`/v1/explain` and `/v1/drilldown`; side panel with summary/explanation tabs; breadcrumbs; audience selector; pedagogy chips; caching.

### M4 — The n8n feel
2D React Flow canvas synced with the OSG; edit, relink, undo/redo; 2D ↔ 3D toggle; save, share, export (PNG, SVG, GLB, JSON).

### M5 — Polish & learning
Accessibility audit passes; performance budgets met; onboarding with 5 sample sentences; golden suite ≥ 90%; Pedagogy score ≥ 4.2/5.

---

## 14. Acceptance criteria and testing

### 14.1 Definition of Done (every ticket)

- [ ] Code typed (no `any` without a comment explaining why).
- [ ] Unit tests for new logic; all tests green.
- [ ] Schema validation at every boundary touched.
- [ ] No new console errors or warnings in E2E.
- [ ] Accessibility: new interactive elements are keyboard-reachable and labelled.
- [ ] Handoff message written (8.2).

### 14.2 Golden utterance suite (`fixtures/golden/`)

Each golden case stores the utterance plus **structural expectations** (not pixel-exact output): expected anchor metaphor, required entities, required relation types, explodable parts, and pedagogy notes.

Minimum set:

1. "The sun rises in the east." → `compass`; entities sun, east; note about Earth's rotation.
2. "A sandwich can contain bread, tomato, ham." → `stack`; 3 optional parts; explodable.
3. "Water evaporates, forms clouds, and falls as rain." → `cycle`.
4. "A cat is a mammal, and a mammal is an animal." → `tree`.
5. "An elephant is heavier than a mouse." → `scale`.
6. "The heart pumps blood to the lungs." → `actor_action` or `flow`.
7. "Plants use sunlight, water and carbon dioxide to make sugar and oxygen." → `flow` with inputs/outputs.
8. "Nairobi is north of Mombasa." → `compass` or `map` with relative bearing.
9. "An atom has a nucleus and electrons." → `container`; nucleus centred, electrons around.
10. "First you boil water, then add pasta, then drain it." → `timeline`.
11. "The Earth orbits the Sun." → `actor_action` / orbit path.
12. "A bicycle has two wheels, a frame, pedals and a chain." → `container`/`stack`, explodable.
13. "Ice melts into water when it gets warm." → `transforms_into` before/after.
14. "Some birds cannot fly." → negated/partial modality correctly represented.
15. An unknown or nonsense sentence → graceful `labeled_card` fallback, no crash.

A case passes when all structural expectations hold. QA reports pass rate per milestone.

### 14.3 Pedagogy scoring

Pedagogy Reviewer rates 20 random explanations per milestone from 1–5 on: accuracy, clarity for audience, relevance to utterance, misconception handling. Target average ≥ 4.2 by M5. Any accuracy score of 1 or 2 is a **major** bug.

### 14.4 E2E flows (Playwright)

- Type sentence → diagram appears → click part → summary → "Explain more" → explanation.
- Sandwich → Explode → click tomato → Open → child diagram → breadcrumb back.
- Edit in 2D → switch to 3D → edit persists → reload → edit persists.
- Keyboard-only run of the sandwich flow.
- Reduced-motion run.

---

## 15. LLM prompting rules (for agents writing prompts)

Prompt templates live in `packages/pipeline/*/prompts/` as versioned files. Every template MUST:

1. State the role and the exact output schema (paste the JSON Schema generated from Zod).
2. Require **JSON only**, no prose, no code fences.
3. Include 2–3 worked examples (use the golden cases).
4. Instruct the model to capture modality, order and misconceptions.
5. Instruct the model to use `"confidence": "low"` rather than invent facts.
6. Specify audience reading level.
7. Be tested by a snapshot test that checks the parsed, validated output of the golden cases.

Parsing strategy: strip stray fences → `JSON.parse` → Zod validate → on failure, send one repair prompt with the Zod error → on second failure, use the rule-based fallback and flag the result.

---

## 16. Repository layout

```
opsis/
├─ apps/
│  ├─ web/                 # React + Vite
│  │  └─ src/{scene,canvas,ui,state}/
│  └─ api/                 # Fastify
├─ packages/
│  ├─ schema/              # Zod contracts (Section 5)
│  ├─ pipeline/{parse,metaphor,layout,explain}/
│  ├─ primitives/          # 3D + 2D primitive library
│  └─ ui/                  # design tokens, shared components
├─ fixtures/{osg,sg,golden}/
├─ tests/{e2e,visual,perf}/
├─ assets/ (+ LICENSES.md)
├─ docs/{DECISIONS.md,PEDAGOGY.md,comms/}
├─ PLAN.md
└─ PROMPT.md               # this file
```

---

## 17. Coding standards

- TypeScript `strict: true`. Prefer pure functions in pipeline packages.
- No stage may import from a later stage (parse must not import layout, etc.).
- Components small and named after what the user sees (`ExplodeButton`, `PartLabel`).
- Every public function has a JSDoc one-liner.
- Commit messages: `type(scope): summary` (Conventional Commits), referencing ticket id.
- Feature flags for anything experimental (`flags.ts`).

---

## 18. Non-goals (for now)

- Photorealistic rendering or image-generation models.
- Real-time multi-user collaboration (design data structures so it's possible later).
- Full LaTeX/TikZ compatibility (Mermaid import is enough for now).
- User accounts, payments, classrooms dashboards.
- Mobile-native apps (responsive web only).

---

## 19. Open questions (Orchestrator tracks, resolve via Decision Records)

1. Should 2D or 3D be the default view for new users? (Proposal: 3D for concrete objects, 2D for abstract/process metaphors — "auto".)
2. How are long paragraphs handled — one diagram per sentence, or merged scenes?
3. Should users be able to author their own primitives and share them?
4. Offline/low-bandwidth mode for schools with limited connectivity: how much can the rule-based fallback cover?
5. Which additional languages come first after English?

---

## 20. First actions (Orchestrator, start here)

1. Create the repo layout (Section 16) and CI.
2. Issue tickets for M0 to Schema Agent and API Agent.
3. Ask Renderer Agent to prototype the `compass` and `stack_layer` primitives in parallel, using hand-written fixtures, so the North Star examples (Section 2) are visible as early as possible.
4. Ask QA Agent to encode golden cases 1, 2 and 15 first.
5. Publish the first status report.

*Opsis — see what you mean.*
