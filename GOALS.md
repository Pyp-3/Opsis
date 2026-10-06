# Opsis goals

Last reviewed: 2026-10-06.

## Current delivery

Provider delivery (2026-10-06): Kimi, Grok and managed Antigravity API connections
and official CLI adapters are implemented on both hosts. API keys belong to the
running server instance, shared by all its accounts. Settings offers write-only
key management; keys persist in a separate local secret file with environment
overrides, outside account settings, SQLite, board exports and logs. All signed-in
local accounts can manage this setting; MCP agent keys cannot. The file is not
encrypted (POSIX 0600 / Windows user-directory ACL). See [provider setup and limits](docs/PROVIDERS.md).

CLI compatibility is pinned to Kimi 1.52.x, Grok 1.0.46 and Antigravity 1.3.0.
Fake-runner tests exercise all three through the full native generation workflow;
API tests cover explicit models, usage, redaction and background cancellation.
Grok's argv bound initially caught duplicate schema text in a real workflow test;
the duplicate is now avoided. No live provider calls have been made. Full web QA
passed 381 unit tests and 49 browser scenarios (one Linux-only skip); three added
HTTP transport tests also pass. Lint, typecheck, Rust check/24 tests, Go vet and
the full native race suite pass. The final Windows build passes packaged database/
MCP integration and all 24 hidden WebView checks. Native browser coverage: 46 pass,
three 30-second timeouts and one Linux-only skip; all three timed-out scenarios
plus instance-key settings pass in an isolated rerun against the final executable.
Key settings pass cross-account sharing, no secret reads/exports, no-call checks,
removal, mobile overflow and accessibility coverage. Desktop/mobile screenshots
were inspected. Current delivery CI must still be confirmed after push.

Trusted Windows signing and Apple signing/notarization are explicitly deferred by
the user. Windows UI automation was retried and again returned "Computer Use
native pipe is unavailable". Interactive save-dialog/clipboard and manual Mac
checks remain open; no local Mac is available. Do not start #3, #6 or #4 yet.

Priority update (2026-10-06): finish the earlier provider/settings/pricing and
platform backlog before starting #3, #6 or #4. Providers should support both
official APIs and official CLI interfaces where available. No Windows signing
certificate/service, Apple Developer account or local Mac is available. Trusted
release signing remains externally blocked; macOS build/runtime verification can
use hosted CI. The Windows interactive check was attempted but the computer-use
native pipe is unavailable, so save-dialog/clipboard verification remains open.

CI run 37434731605 completed with both desktop jobs failing on the obsolete
11-tool MCP assertion after search added tool 12. The assertion now checks the
exact catalogue (45b8e41, pushed); the complete Windows native race suite passes
locally. The original web CI job passed. Follow-up run 37439376513 passes web,
Linux, Windows and both Mac architectures' feature/integration checks and release
publishing. Current feature-delivery CI is tracked separately below.

macOS packaging progress: native Intel/Apple Silicon build paths, application
bundle metadata/icon/ad-hoc signing, zip distribution and per-architecture CI
checks are implemented. Both architectures' build, native race, packaged
integration, browser, hidden WKWebView and extracted-package checks pass in run 37439376513. Developer ID signing/notarization and an interactive Mac check remain unavailable.
Local bundle-layout test passes. The existing release archive test requires `zip`,
which is absent on this Windows machine. Lint, typecheck, Rust check/tests and Go
vet/race tests pass. Initial JS QA crashed under the shell's Node 22.3.0; it passes
with the previously verified bundled Node 22.23.3.

Windows npm launcher parity: configured Claude/Codex `.cmd`, `.bat` and `.ps1`
paths now resolve their adjacent package manifest to a native executable or Node
entrypoint. Arbitrary shell launchers remain rejected. Regression coverage checks
both agents, paths containing spaces and invalid package entries; the Windows
harness race tests pass. Rebuilt executable: full native race suite, packaged
database/MCP integration, 46 browser scenarios (one Linux-only skip), and all 24
hidden WebView2 smoke checks pass. Full JS QA: 366 unit tests and 46 browser
scenarios pass on Node 22.23.3. No paid provider requests were made.

Cost projections (2026-10-06): implemented a separate Settings tab with dated
official GPT-6 Luna/Haiku 4.5 standard API prices, custom rates, disjoint token
assumptions, long-context pricing and cumulative 7/30/90-day costs. Inputs are
validated account settings on both hosts; no database migration or generation call
is required. Account isolation, cross-browser persistence, mobile overflow and
accessibility pass against both Fastify and the rebuilt Windows executable.
Lint/typecheck, Go vet/full race suite, packaged integration and all 24 hidden
WebView2 checks pass. JS QA: 369 unit tests pass; browser assertions pass, with
one artifact-cleanup error caused by overlapping runs sharing `test-results`.
All six affected-file scenarios pass with a separate artifact directory. A further
account-only-settings regression passes. Full native browser run: 47 pass, one
Linux-only pixel baseline skipped. Desktop and mobile screenshots were inspected.
The calculator is hypothetical API spending, not subscription billing or an
estimate of missing usage. Pricing commit fcfe6fa is pushed; run 37440511815
completed successfully on every job.

macOS CI follow-up: isolated platform-specific cache-path expectations and added
the UniformTypeIdentifiers framework Wails needs for native file dialogs. The
first linker-fix run exposed a cgo comment formatting error, fixed in 9482537;
native build/runtime checks now pass on both architectures. Windows CI also exposed 8.3 temporary
path spelling in a launcher test; 37c0492 compares actual file identities instead.

Fallback settings (2026-10-06): each primary agent can keep an account-saved copy
of a named profile as its alternative, including another provider. Profile edits
and deletion do not silently change it; refresh/removal are explicit. The canvas
shows the exact target and switches only on the user's click, preserving the
prompt. Switching makes no request, and a failed request never triggers a fallback
retry. The web scenario verifies an authentication failure, explicit switching,
separate resubmission, cross-browser persistence and removal on both hosts.
Lint/typecheck, 370 unit tests, Go vet/full race suite and all 48 applicable web
browser tests pass. The native browser suite passed 47 scenarios with one
30-second authentication-test timeout; both authentication scenarios and the
fallback scenario pass in an isolated rerun against the final rebuilt executable.
The Linux-only screenshot baseline is skipped locally. Packaged database/MCP
integration and all 24 hidden WebView2 checks pass. No live provider calls were made.
Fallback delivery run 37443046673 passed web, Linux, Windows and Intel Mac;
Apple Silicon failed only its hidden WKWebView smoke with a 90-second timeout and
no further diagnostic. Its failed job was rerun on 2026-10-06; result pending.

Provider implementation references: official interfaces exist for Kimi, Grok
and Antigravity, including Google's managed Antigravity API. Preserve both API and
CLI scope. Sources checked 2026-10-06:

- [Kimi API](https://platform.kimi.ai/docs/api/chat): current K3 uses explicit
  reasoning effort (low/high/max) and `max_completion_tokens`.
- [Kimi CLI](https://moonshotai.github.io/kimi-cli/en/reference/kimi-command.html):
  current release 1.52.0; print mode auto-approves tools, so an adapter must supply
  a tool-free custom agent and prevent inherited MCP/tools before enabling it.
- [Grok CLI](https://docs.x.ai/build/cli/headless-scripting): official headless
  and ACP interfaces; verify prompt transport and isolation rather than assuming
  Claude/Codex flags. No local Kimi/Grok/agy executable was discovered.
- [Antigravity API](https://ai.google.dev/gemini-api/docs/antigravity-agent):
  managed Interactions API, explicit underlying model, background/cancellation
  lifecycle. It currently rejects structured outputs and `max_output_tokens`.
  The old unused `agy` wrapper was replaced with the documented 1.3.0 streaming
  input/result envelope and isolated permission configuration.

API-key storage and provider adapters are implemented above. Do not put keys in account
profiles, board documents, exported settings or logs. Live provider tests still
require explicit authorization; none have been run.

P2 and the quality/release-readiness checklist are complete for the web and Linux
Go/Wails application as of 2026-10-04. Shared editing is opt-in for named accounts
on one server, with owner invitations/revocation and revision-based recovery.
Groups, notes/sources, reviewed imports, comparison, examples and provisional streamed
concepts are implemented. See the verification and scope limits below; this does
not complete the separate provider and Windows/macOS work.

Both P1 sections are complete as of 2026-10-04 on the web and Linux desktop:
model settings/profiles/diagnostics, reported usage and explicit limits, consent-based
suggestions, keyboard connection editing, branch metadata, pins, selective proposal
acceptance, readable framing and denser-graph routing improvements. See the P1
evidence and limitations below.

P0 persistence is complete as of 2026-10-04: private duplicates, reversible archive,
transactional database migrations, manual full-database backup/restore, and an
owner-only saved-revision browser with restore-as-copy. Both Fastify and the Linux
Go desktop host are verified. Existing data, ownership, revision guards, deletion
tombstones, and the 40-entry undo limit are preserved.

The separately requested Kimi/Grok/Antigravity providers and instance API-key settings
are implemented above. Cost projections/graphs and explicit fallback-model settings are
implemented above. Native Windows and both Mac packages pass CI; trusted signing
and interactive platform checks remain open. Current delivery CI remains to be confirmed.
Appearance settings and initial native platform plumbing have shipped; they do not
complete those goals. The Linux desktop and browser application remain supported.

Windows x64 desktop (2026-10-05): `pnpm desktop:build` now produces
`output/desktop/opsis.exe` natively on Windows (WebView2, bundled `node.exe`, flat
link-free speech runtime). Fixed Windows SQLite file URIs and Claude/Codex discovery
(`.exe` or Node entry only; POSIX mode checks skipped). Verified on Windows 11:
`go test -race ./internal/...`, `--diagnose` with speech on and off, all 24 hidden
WebView2 smoke checks, and real `--version` probes of npm-installed Claude/Codex.
Release packaging: `desktop:package` writes `opsis-…-windows-x64.zip` + SHA-256; the
exe embeds an icon, per-monitor-DPI manifest and version info; a `Windows desktop`
CI job (windows-2025) tests and attaches the zip to each prerelease. Locally on
Windows 11 with Node 22.23.3: packaged database/MCP integration passed, the browser
suite against `opsis.exe` passed (Linux-only pixel baseline skipped) and 344/345
unit tests passed (one cold-ESLint timeout).

Installer and updates (2026-10-05): a per-user Inno Setup installer
(`…-windows-x64-setup.exe`, no admin rights, Start menu, uninstaller) ships beside
the zip. Installed copies offer one-click updates to newer `main` builds: CI signs an
update manifest with Ed25519 (`OPSIS_UPDATE_SIGNING_KEY` secret, public key in
`internal/updater`), and the app verifies the signature and installer SHA-256 before
running it silently and relaunching. `--check-update`/`--install-update` expose the
same path. Authenticode signing is wired (`scripts/sign-windows.mjs`) and switches
on when `WINDOWS_CERTIFICATE`/`WINDOWS_CERTIFICATE_PASSWORD` secrets exist; no
certificate is configured yet, so releases remain unsigned. Verified locally:
updater unit tests (valid, tampered, foreign-key, older-build, bad-name cases),
notice component tests, and a silent install → smoke → uninstall round trip. CI build 56
published the installer with a valid signed manifest (checked independently against
the embedded public key); its installed copy reports its version and finds no newer build. After build 57
published, that installed build 56 found it, verified the manifest and installer,
installed silently and relaunched as build 57 (marker and `release.json` confirmed).
Downloaded installers are now removed before each download and at startup.
Remaining: obtain a code-signing certificate (a cloud-HSM certificate needs its
provider's signing call), interactive save-dialog/clipboard check, and `.cmd`
override parity with the Fastify host. macOS packaging remains pending.

## In progress: board collections (requested 2026-10-05)

Let an account group its own boards ("canvases") into named collections for faster access.

- [x] Private per-account collections: create, rename (case-insensitive unique, 1–60
      characters, up to 100) and delete; deleting ungroups boards and never deletes them.
- [x] File a board into at most one collection, create a board directly inside the
      selected collection, and filter My boards by All / Unfiled / collection with counts.
- [x] Filing is organization, not an edit: no revision, update-time or undo change.
      Copies are filed beside their source; archived boards keep their collection.
- [x] Shared migration 3 (`board_collections`, `boards_v2.collection_id`) on both the
      Fastify and Go hosts; included in full-database backups.
- [x] Race-enabled Go suite verified in CI run 37343651152 (Linux and Windows desktop jobs).
- [ ] Not yet in scope: MCP tools to list/file collections, collection-aware home/sidebar
      recents, multi-select bulk moves, and per-board JSON export of the collection.

Verified 2026-10-05 on Windows 11 (Node 22.23.3): Fastify collection tests (privacy,
duplicate names, filing at creation, unchanged revision/update time, copy filing,
delete ungroups, restart persistence); Go API tests with the same cases (non-race);
browser scenario filing, filtering across reload and deleting a collection while
keeping its boards. Full gates: lint, typecheck, Rust check/24 tests, 351 unit tests,
43 browser scenarios against Fastify and against the built `opsis.exe` (Linux-only
pixel baseline skipped). See [collections](docs/PERSISTENCE.md#collections).

## In progress: scaling the library (requested 2026-10-06)

Requested together after collections. Each item lists its acceptance criteria; check an item
only after both hosts (Fastify and Go) and the browser path are verified.

### Account-scoped settings (#8)

- [x] Model preferences, named profiles, provider limits and usage records live in SQLite per
      account (shared migration), not per-browser localStorage; they follow the account across
      browsers and are included in full-database backups.
- [x] Existing localStorage values are imported once into an account that has none; the local
      copies are left in place. Unavailable server storage reports an error, never silently resets.

### Usage and cost per collection (#9)

- [x] Usage records carry the generating board; Settings shows reported usage grouped by
      collection (current membership), keeping missing measurements distinct from zero.
- [x] Costs are only CLI-reported estimates and are labeled so; pricing-based projections stay
      in the separate pending provider/pricing goal.

### Tags and smart collections (#5)

- [x] Owner-private tags (several per board, case-insensitive), edited without a revision or
      undo step; filter My boards by tag.
- [x] Smart collections: saved rules (tags, visibility, collection, recency, agent, title text)
      evaluated by one shared pure function; they never move or modify boards.

### Search across boards (#2)

- [x] One search over titles, concepts, summaries, explanations, notes, sources and connection
      labels of boards the account owns or edits; results open the board with the concept selected.
- [x] Shared pure ranking used by both hosts and an MCP `opsis_search_boards` tool.
- [ ] Not in this delivery: semantic (embedding) search with a local index.

Progress 2026-10-06: #8, #9, #5 and #2 shipped (commits ecf81a5, b93cbd3, d2fa37b) with
migrations 4 and 5. Verified locally on Windows 11 (Node 22.23.3): API tests on both hosts
(settings/usage isolation and bounds, tags/smart rules, search scope), 366 unit tests, browser
scenarios for account-wide profiles in a second browser context, tags/smart collections and
search-to-concept on Fastify and on the built `opsis.exe` (a few full-suite runs hit 30 s
timeouts on this low-memory machine and passed when rerun), packaged database/MCP integration
and the hidden WebView2 smoke. CI for those commits failed on three issues fixed in the
follow-up commit: untagged boards listed `tags: null` on the Go host (breaking saves there),
the desktop smoke still read profiles from localStorage, and accessibility scans ran during
page fade-ins. Confirm the next CI run before relying on these items.

### Links between boards (#3)

- [ ] A concept may link to another board (optional saved field, never requested from agents and
      kept through regenerations). The canvas marks linked concepts; opening follows the link with
      a way back; boards show which boards link to them (backlinks).

### Collection sharing and export (#6)

- [ ] Owners can make every board in a collection public/private and invite/revoke an editor for
      all of its boards in one action.
- [ ] Export a collection as a bundle and import it as new private boards in a new collection,
      remapping links between its boards; export a self-contained read-only static site; print a
      collection walkthrough (save as PDF from the print dialog).

### Remote Opsis server and device sync (#4)

- [ ] Opt-in server mode for the Fastify host: non-loopback binding only with an HTTPS public
      origin (direct TLS or an explicitly trusted proxy), strict origin checks, Secure cookies,
      CSP/HSTS, invite-only enrollment and operator-issued password resets, local CLI generation
      disabled, serving the built web app, and an audit log with retention. Loopback mode unchanged.
- [ ] Per-device sync tokens (shown once, revocable, limited to sync routes).
- [ ] Local hosts (Fastify and Go desktop) connect to a server and sync owned boards with a shared
      pure planner: pushes, pulls, three-way merges; true conflicts and edit-vs-delete keep a
      separate copy. Collections and tags travel by name. Tokens are never returned or logged.
- [ ] Not in this delivery: live presence/cursors, multi-server scaling, hosted backups.

## Product goal

Make agents useful as visual hands: convert a question or explanation into an understandable, editable 2D graph, with richer information available on selection. Preserve the user's spatial arrangement as the conversation and process branch.

The current experience is close to the intended visual direction. This checklist tracks shipped behavior and remaining work; perceived design completeness is not a claim of production readiness. Unchecked items below are planned, not implemented.

## Implemented

- [x] 2D blueprint canvas as the primary application, without a 3D toggle.
- [x] Frameless icons from a shared icon library, with short labels.
- [x] Pan, zoom, fit-to-view, and manual node movement.
- [x] Bounded-width top-to-bottom arrangement with overflow branches placed on later rows.
- [x] Scroll-through reading at a stable zoom; explicit overview and undoable downward rearrangement.
- [x] Icon-attached ports, including bottom connections routed above labels; shared canvas/export geometry.
- [x] Typed request/response/feedback/retry paths, distinct return styling, and a two-way DNS example. Agent instructions distinguish actor interactions from chronological stages.
- [x] Fan-out lanes, overlap/crossing penalties, crossing knockouts, and connection type colors/patterns. The sidebar legend was removed to reduce clutter.
- [x] Compact label-sized node footprints and row spacing calculated from relationship labels and connection density, instead of fixed 360px rows.
- [x] Wrapped labels, reserved text footprints, and obstacle-aware rounded orthogonal routes shared by canvas and exports.
- [x] Curved directional connections that follow moving nodes.
- [x] Four reusable connection ports; multiple incoming/outgoing paths and endpoint reconnection.
- [x] Connection-side metadata preserved in saved v2 documents and SVG exports.
- [x] Click-to-read concept details and navigation through connected concepts.
- [x] Editable concepts, icons and relationships; add/remove concepts.
- [x] Refined header, collapsible/searchable concept sidebar and detail inspector.
- [x] Canvas-first workspace (2026-10-04): sharing and groups drop down from the header
      instead of taking rows above the canvas; the canvas toolbar and composer can be
      tucked away, and that choice is remembered per device (localStorage, not board data).
      The composer stays open on empty canvases and during generation, and reopens for
      suggestions. Covered by a browser regression test and a reviewed baseline update.
- [x] Prompt-to-graph generation via local Claude and Codex CLIs.
- [x] Follow-up generation using the current graph and selected concept.
- [x] Preserve existing node positions through graph expansions.
- [x] Model presets, custom model IDs and supported effort settings.
- [x] Economical defaults, per-agent saved preferences and no silent model upgrade.
- [x] Validated agent output, bounded execution and failure handling that preserves the board.
- [x] No-call email demo, including a delivery-failure branch.
- [x] SQLite-backed named boards, browser recovery snapshots and JSON import/export.
- [x] Dedicated board manager: create empty named boards, search, rename and confirm permanent deletion. Revision checks and deletion tombstones prevent stale-tab resurrection.
- [x] Minimal grouped sidebar: board actions, five recent boards, current concepts and collapsed examples.
- [x] Transactional drags, no-op history protection, persistent undo/redo and Ctrl/Cmd+Z, Shift+Z and Y shortcuts.
- [x] SVG, PNG and Markdown exports; persistent undo/redo.
- [x] Server-side follow-up change detection and explicit apply/discard review.
- [x] One invalid-output repair attempt on the same model within a shared deadline.
- [x] Model-generated suggestions and per-node uncertainty/simplification caveats.
- [x] Elapsed generation time and coarse stage feedback.
- [x] Guided concept walkthrough with branch/cycle handling.
- [x] Legacy OSG JSON import with flattening warnings and source preservation.
- [x] Separate history, generation and persistence hooks plus sidebar component.
- [x] Cached/deduplicated agent readiness probes (30 seconds).
- [x] Portable harness supervision tests using the running Node executable, not `/usr/bin/node`.
- [x] Shared schema, API/harness and workspace unit tests; direct browser interaction checks.
- [x] Legacy OSG JSON import retained; retired pipeline tables remain untouched in existing databases.
- [x] Accounts, board ownership, read-only public boards and revocable local agent keys.
- [x] External agent canvas editing over MCP, sharing the board API and undo history.

## Completed: persistence and recovery — P0

- [x] Add a separate v2 SQLite table and revision-checked create/load/update endpoints.
- [x] Add a named-board library: create, rename and reopen; separate-copy recovery on conflicts.
- [x] Board search and confirmed deletion.
- [x] Routine private duplicate and reversible archive/unarchive actions, with revision checks.
- [x] Import the existing browser board without deleting its source; show successful database save status.
- [x] Add save-state/error feedback, retry behavior and per-tab recovery after interruption.
- [x] Add transactional, versioned database migrations, manual full-database backup/restore and documented retention behavior.
- [x] Persist bounded undo/redo history, with explicit restore actions.
- [x] Add an owner-only, paginated long-term revision archive with previews and restore-as-private-copy.

Acceptance: several boards survive API/browser restarts; edits and connection ports round-trip exactly; migration and backup/restore have automated tests. Browser storage must not be the only copy after a successful migration.

Verified 2026-10-04: 321 unit/API/schema tests, 24 Rust tests, native race tests,
lint/type checks, 29 browser scenarios against each API host, database-import/MCP
integration, 19 hidden Wayland checks, and both packaged and development backup/
restore commands. Persistence regression tests cover legacy migration and rollback,
future-version refusal, live WAL snapshots, preserved ownership/templates/tombstones,
private revision access, archive across reload, pagination beyond 40 undo states,
and copy restoration without modifying the source. See [persistence documentation](docs/PERSISTENCE.md).

Limits: revision history starts with the state present at migration; older discarded
saves cannot be reconstructed. Revisions remain until board deletion and can grow
storage use. Full backups are manual, include credential records, and restore into a
new destination without merging. There is no scheduled backup/pruning or new
Windows/macOS runtime validation in this delivery.

## Completed: model management and usage — P1

- [x] Dedicated settings page for agents, executable paths, model presets and default effort.
- [x] Add/edit/remove named model profiles without editing source code.
- [x] Show supported model/effort combinations and clear CLI/account diagnostics.
- [x] Display actual usage when reported by the provider; distinguish unavailable usage from zero.
- [x] Add explicit request/output limits where supported and warnings before expensive choices.
- [x] Optional task-based model suggestions, always requiring consent for an upgrade.

Acceptance: defaults remain inexpensive; each request shows its selected agent/model/effort; unavailable configurations fail clearly; usage estimates are never presented as actual billing.

## Completed: canvas and explanations — P1

- [x] More discoverable connection/reconnection affordances and keyboard-accessible connection editing.
- [x] Route common chains, branching bypasses and returns around node/text footprints and separate edge labels from arrows.
- [x] Further optimize crossings and routing performance for very dense or overlapping hand-arranged graphs.
- [x] Better initial framing and readable labels across small screens and large graphs.
- [x] Named branch conditions, clearer decision nodes and optional edge descriptions.
- [x] Searchable icon picker with broader categories; evaluate safe custom SVG import.
- [x] Preview changes/removals to existing content before applying agent revisions.
- [x] Let users pin positions and selectively accept generated changes.
- [x] Stronger visual hierarchy and spacing in the composer, settings and sidebars.

Acceptance: a branching process remains understandable at normal zoom; manual layout survives follow-ups; users can inspect and reject destructive graph edits.

Verified 2026-10-04: all integration gates pass (lint, typecheck, Rust checks and
24 tests, 332 unit/API/schema tests, Go vet/race tests), plus 34 browser scenarios
against each API host, packaged database-import/MCP integration and 22 hidden
Wayland WebView checks. New coverage verifies profile persistence/edit/removal,
invalid executable diagnostics without a model call, measured-zero versus missing
usage, consent before changing model/effort, keyboard endpoint/port editing,
branch metadata across reload, pins and selective acceptance as one undo action.
Mobile settings pass overflow/accessibility checks. Existing icon search/category
coverage passes on both hosts.

Dense irregular 50-node/100-edge routing benchmark on the development machine:
about 1,122 ms before versus 724 ms after; cached geometry returned below the
benchmark's 1 ms display precision. This is one fixture, not a universal latency
guarantee. Regression coverage includes dense and overlapping layouts.

Limits: profiles/defaults and the last 100 usage records are device/origin
localStorage preferences, shared across accounts in that browser profile, not
SQLite records or part of database backups. Usage is only what the CLI reports;
cost is explicitly labeled a CLI estimate, never billing. No paid provider calls
were made during verification. CLI account entitlement/quota remain unverified by
the no-call check. Output-token caps are unavailable in these CLI integrations;
request character limits and Claude budgets per attempt are enforced where
supported. Raw SVG import was evaluated and deferred in favor of the existing
validated declarative icon format. Windows/macOS packaging, new providers,
API-key/fallback settings and pricing-based cost projections remain separate work.
See [model and canvas controls](docs/P1-CONTROLS.md).

## Completed: richer workflows — P2

- [x] Nested, collapsible subgraphs with optional group boundaries (no mandatory frames around individual icons).
- [x] Overview, selected-concept detail and a step-by-step walkthrough.
- [x] Incrementally stream validated nodes instead of waiting for the complete graph.
- [x] Reusable process templates and a richer no-call example library.
- [x] Attach notes, references and source links to concepts.
- [x] Document/text import with source attribution and a review step.
- [x] Board comparison and version-history browsing.
- [x] Read-only public boards for signed-in users, with ownership controls and save-a-copy editing.
- [x] Optional collaboration/sync after durable local persistence is reliable.

## Quality and release readiness

- [x] Default QA gate now covers v2 saved boards/history, generation review, branching/dragging, exports and walkthrough.
- [x] Add automated accessibility and mobile-overflow checks for the new workspace.
- [x] Expand browser coverage for reconnection, legacy imports, network loss and visual screenshot baselines.
- [x] Test larger graphs, long-running generation, cancellation and malformed responses.
- [x] Reduce initial bundle cost and investigate the ELK chunk warning.
- [x] Verify clean-clone installation, native SQLite setup and supported CLI versions in CI.
- [x] Define and test explicit OSG JSON import; keep source records unchanged.
- [x] Add bulk legacy-database migration and richer primitive/geometry mapping.
- [x] Add account authentication and board authorization.
- [x] Review deployment hardening before supporting non-loopback hosting.

Verified 2026-10-04: 345 unit/API/schema tests, 24 Rust tests, lint/typecheck,
Go vet/race tests and 42 headless browser scenarios against each API host. Packaged
Linux verification includes database-import/MCP integration and 24 hidden Wayland
WebView checks. Regression coverage includes source-link validation in Go's pure
contract VM, delayed polling access guards, repeated batch selection, and persistence
of groups/notes/sources. No paid model calls or visible desktop windows were used.

A fresh dependency tree installed from the frozen lockfile and passed native SQLite
write/read/WAL/integrity verification. CI now runs that probe and recorded CLI
compatibility checks explicitly. The production initial entry decreased from about
782 kB (249 kB gzip) to 277 kB (86 kB gzip); ELK runs as an on-demand bounded worker,
with its large worker asset retained. The default chunk-warning threshold remains.
Screenshot coverage includes a reviewed branching-canvas baseline and framing checks.

Limits: source links and excerpts are user-supplied, not independently verified.
Local text/Markdown import is deterministic and bounded, not semantic document
analysis. Legacy bundles are explicit private-copy imports, not full database backups;
reimport can create additional copies. Claude structured deltas allow early concept
previews; the current Codex envelope yields them at message completion. Provisional
concepts never bypass full validation or review. Shared editing uses revision polling
on one server, without cross-install synchronization or live cursors. The deployment
review identifies public-hosting blockers; both hosts retain loopback-only entrypoints.
Windows/macOS packages and live-provider availability remain unverified separate goals.
See [P2 workflows](docs/P2-WORKFLOWS.md) and the
[release readiness review](docs/RELEASE-READINESS.md). Remote CI status is reported
with delivery; local results alone are not a claim that a GitHub run passed.

## Maintenance rules

- Mark an item implemented only after its user-facing behavior and persistence implications are verified.
- Keep README capabilities aligned with this checklist; distinguish legacy functionality from v2 functionality.
- Record relevant tests and limitations when closing a goal.
- New features should improve visual understanding, control or durability. Avoid introducing 3D work into the current 2D roadmap.
