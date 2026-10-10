# Model and canvas controls

## Agents and models

Open **Settings → Agents and models**. Appearance controls remain available in the
**Appearance** section.

- Choose the default model/effort independently for Claude and Codex. Known
  incompatible combinations fail before a provider request. Custom IDs remain
  explicit and require access through your CLI account.
- Leave **Executable path** empty for automatic discovery, or enter the absolute
  path to your installed CLI on the machine running Opsis. This is an executable,
  not a shell command. The harness validates it and runs a bounded version probe.
  A selected path never silently falls back to another installation.
- **Check configuration** runs no model completion. It checks executable/version
  compatibility, not authentication, entitlement or remaining quota. Sign in
  through the provider's CLI and check your provider account for those details.
- Add, edit and remove up to 30 named profiles. Select a saved profile in the
  composer's expanded model settings. Editing a profile loads its values; save
  profile changes to retain its new name/settings.
- **Show task-based suggestions** offers a quick-overview or branch-analysis
  choice. Nothing changes until **Apply suggested model and effort** is selected.
  Generating still requires a separate submission. Warnings identify potentially
  expensive models/efforts; these are qualitative, not price quotations.

Defaults remain Haiku / low and GPT-6 Luna / low. Each canvas request displays its
selected agent, model and effort (or Haiku's built-in reasoning). No automatic
model upgrade, provider failover, authentication retry or general tool access is
introduced by these controls.

### Limits and measurements

The request character limit includes the composed system instructions, diagram,
extracted document text and any repair text. It is checked before each completion;
it counts JavaScript string units, not provider tokens. Binary uploads retain their
separate attachment limits. The existing three-minute deadline, process I/O byte
bounds and one invalid-output repair remain in force.

Claude's optional dollar budget is passed to the CLI per attempt. A repair is
another attempt, so it can have another budget allowance. This is the CLI's
budget mechanism, not an Opsis invoice or a guaranteed cap on a subscription bill.
See the [Claude CLI reference](https://code.claude.com/docs/en/cli-reference).
Neither current Opsis CLI integration offers an enforced output-token cap; the UI
says so rather than displaying a nonfunctional token slider.

Usage history retains the last 100 attempted diagram/illustration requests in
this browser or desktop WebView. It records model/effort, time and reported usage,
including measurements received before a failed result. It never stores prompts,
boards or credentials. Each reported completion has separate input, output,
cache-read, cache-write and cost fields. An absent measurement remains
**unavailable**; an actual zero remains **0**. Interrupted requests may have
incomplete measurements. Local request-window counters remain separate from
provider-reported token usage. Live thinking counts are labeled as estimates and
are never used as usage or billing measurements.

Codex measurements come from its completed-turn usage envelope; cached input is
part of its input count, not an extra charge to add to it. See
[Codex non-interactive output](https://learn.chatgpt.com/docs/non-interactive-mode).
Claude's result envelope supplies its own usage/cache fields and, when available,
CLI-estimated dollar cost, labeled separately from measured tokens. See
[Claude cost tracking](https://code.claude.com/docs/en/agent-sdk/cost-tracking).
No pricing table is guessed and no estimate is presented as
actual billing. These measurements do not cover other apps, subscription allowance,
or requests whose CLI emitted no usable usage record.

Preferences, profiles, provider caps and the most recent 1,000 usage records are
account settings stored in SQLite (`account_settings` and `usage_records`,
migration 4). They follow the account to other browsers on the same Opsis server
and are included in full-database backups. Each key is validated by a shared
schema on both hosts. **Clear usage history** in Settings removes the account's
records. Appearance (the `appearance` key: colour scheme, background palette, accent
or custom colour, fonts) is an account setting too, cached in the browser so the look
paints before sign-in. Canvas layout choices remain device preferences.

The first account to sign in on a browser that has earlier localStorage values
(`opsis:model-settings:v1`, `opsis:model-profiles:v1`, `opsis:provider:v1`,
`opsis:provider-usage:v1`, `opsis:reported-usage:v1`) receives a copy of any
setting it does not already have; the local copies are left in place and later
accounts in that browser do not inherit them. If account settings cannot load,
the workspace reports it and uses the economical defaults.

Settings → Agents and models also shows **Usage by collection**: reported usage
grouped by each board's current collection, with Unfiled and Other or deleted
boards. Generations record the board open when they started. Totals keep
unreported measurements visible (“Unavailable”, or “N unreported”) instead of
counting them as zero, and dollar figures remain CLI estimates, not billing.

## Canvas control

Select a concept to **Pin position**. Pins survive saves, reloads, copies,
follow-ups and explicit **Arrange downward**. Unpin to move it again; removing a
concept removes its pin. Normal follow-ups retain all existing positions, pinned
or otherwise. Pins lock positions, not content or existence: proposed removals
still require review.

Use **Connect to** in concept details to add a connection without dragging.
**Edit connection** opens keyboard-accessible source/destination and port selectors.
Dragging dots or reconnecting either end of an arrow continues to work. A
connection can have a short branch condition and a longer optional description.
The condition appears on the arrow; the description remains in its inspector
and Markdown export. Decision concepts have a distinct marker and icon tint.

Proposal review contains a checkbox per added, changed or removed concept/edge,
plus an optional board-metadata change. **Clear selection** and **Select all
changes** help choose a subset; the proposed preview follows that selection.
Invalid dependencies block Apply and explain what needs selecting. For example,
a removed concept cannot leave a retained arrow without an endpoint. Applying
the selection is one undoable action and retains manual layout. Schema/process
validation still applies to the combined result.

Reading view keeps labels at 80–100% scale. A graph too wide for the first row
starts at the leftmost concept rather than shrinking everything into illegibility.
Use Fit for an overview. Routing caches geometry across prose/colour changes,
indexes crossings inside grid segments, and caches directed search steps. It is
deterministic and bounded by the existing 50-node/100-edge contract; fully
overlapping objects can still make clear separation impossible.

### Icon import evaluation

The existing picker has 178 icons, category filters and search by names/related
terms. Custom icons use the shared bounded declarative drawing schema with a
library fallback. Raw SVG import is deliberately deferred: arbitrary SVG can
contain scripts, event handlers, external resources, foreignObject, CSS and
unbounded geometry. Copying SVG markup into the renderer would violate the
validated-data contract. A future importer must convert a strictly limited
primitive subset into that existing schema, reject unsupported content and
provide a preview; it must never render the source markup directly. No raw SVG
upload capability is claimed in this release.
