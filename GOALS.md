# Opsis goals

Last reviewed: 2026-10-10.

## Current delivery

Server narration scope (2026-10-10): user requested enabling the natural voice and
investigating an inline-script CSP warning. Add an operator-provisioned, persistent,
read-only model cache to the live container; candidates keep speech disabled. Reuse
the existing local Kokoro model and frozen application packages. Opsis HTML contains
only an external module script; the supplied inline hash has no identified source, so
keep the existing script policy. Server narration avoids the browser fallback's runtime
downloads. Verified: six updater tests, lint/typecheck, Rust check/24 tests, native
check/race tests, 501 unit tests and all 68 browser scenarios pass. The restricted
non-root/read-only container generated a valid WAV from the existing model with
networking disabled. Reconfigured the already CI-approved `01b4d43` image with the
new model mount, retaining a database backup and previous container; public HTTPS
speech status reports `ready` and a short narration returns valid WAV audio. The
model mount is read-only and update/certificate timers remain enabled. The main site
returns 200 and the tools root returns 404. Future code deployments still wait for
successful CI; the updater/configuration change is committed and CI is running.
The reported content-length warning is informational. `sandbox eval code:17:34`
indicates dynamically injected code, but the supplied hash did not match Opsis HTML
or static payloads inspected in the active Zen extensions. Its owner remains unconfirmed;
no unidentified inline script was allowlisted. Reload an already-failed page to choose
the now-ready server voice. No package upgrades or paid provider requests were made.

Shared server CLI / guest scope (2026-10-10): user authorized copying only local Claude
and Codex login files to the VPS, installing compatible pinned binaries, and a
public-view-only guest account while sign-up stays disabled. Implemented an
operator-configured `OPSIS_GUEST_EMAILS` policy: default-deny API authorization even
for owner/invited boards and existing agent keys; only current public, non-archived
board snapshots are readable. Guests mount a separate read-only gallery with no
chat, autosave, account settings, or recovery hooks. Desktop/local mode is unchanged.
Credentials live outside Git/images/build contexts in a private persistent mount;
candidate smoke containers receive none. CLI packages are exact-version/integrity
locked and installed without lifecycle scripts; Claude self-updates are disabled.
Progress: 501 unit tests, typecheck/lint, Rust check/24 tests, native check/race tests,
five updater tests and the targeted guest browser scenario pass. Credentials were
copied privately and both login status checks pass. One authorized live request each
passed for Claude/Haiku and Codex/gpt-6-luna inside the restricted server container.
Codex 0.162.1 was rejected by the existing compatibility allowlist
before a model call; the server pins supported 0.159.0 instead, leaving local tools
unchanged. All 68 browser scenarios pass across the full run and one isolated rerun
after a concurrent test-artifact collision. CI run 38035564939 passed all jobs,
including all four desktop platforms and release publication; `ce72cdb` was deployed
through the installed updater with a database backup and previous container retained.
The guest account was created after the server policy became active. Live HTTPS
checks confirm member CLI discovery, guest public listing, denied writes/provider
access, closed sign-up, and persistent guest sessions/restrictions across restart.
Unrelated subdomain routes still return 404 and the main website remains healthy.
The runtime remains non-root/read-only with all capabilities dropped and no published
ports. Update and certificate timers remain enabled. No further model calls were made.

VPS deployment scope (2026-10-10): serve only `/opsis/` on
`tools.pypsnotes.cloud`, returning 404 elsewhere; use the existing Docker/Nginx
host and Cloudflare DNS. Start with an empty server database. Add mount-path
support and a separately installed updater gated on successful CI for the exact
main commit. The user prioritizes supply-chain risk: freeze dependency images,
lockfiles/manifests, CI workflows and deployment recipes; no automatic package
updates. Routine builds have no network and reuse the frozen dependency image.
Progress: mount-path support and updater are implemented in an isolated checkout,
rebased onto the separately delivered drawing work. Cloudflare DNS, tools-only strict
origin TLS and a Let's Encrypt certificate/renewal timer are configured on the VPS;
the main website is unchanged. The update timer correctly waits for successful CI.
Local checks: lint/typecheck, Rust check/24 tests, native check/race tests, 492 unit
tests and 66 browser scenarios pass before that rebase; 28 relevant tests plus
lint/typecheck pass after it. Four updater policy tests pass. A real VPS image builds
with networking disabled and starts as non-root with a read-only root filesystem;
health and prefixed asset URLs pass. Release download digest/metadata/source checks
were exercised against a published successful CI release. This caught and fixed
the deployment recipe's workspace-local Vite executable path. The updater also handles
successful partial CI reruns and restarts the old service if a backup fails before
migration. CI run 38032958052 for `0abe7bf` passed every job: 499 unit tests,
67 web browser scenarios, all four desktop platform jobs, and release publication.
That exact commit was deployed through the installed updater. The live `/opsis/`
proxy is enabled; HTTPS HTML/health and secure HttpOnly `/opsis/` cookies pass,
unrelated routes return 404, unauthenticated account access returns 401, and public
sign-up returns 403. The requested operator account was created; the board library
is empty and no local data was copied. Account/session persistence across a real
container restart passed. Chrome verified the live login screen; the local prefixed
browser smoke covered login, board creation/edit/save/reload and logout. Update and
certificate-renewal timers are enabled. Provider CLIs/credentials were subsequently
configured under the shared-server scope above; speech was subsequently enabled under
the narration scope above. Cloudflare's
own `/cdn-cgi/trace` still returns 200 independently
of Nginx; the 404 boundary applies to application routes, not hostname concealment.
No OS packages or dependency versions were upgraded.

Scope update: the user has now authorized #3 board links, #6 collection sharing/
export and #4 remote server/device sync. Implement and validate in that order.
Remote mode remains opt-in; instance API keys remain server-wide. Signing and
manual platform checks remain separate. #3 and #6 are implemented and verified below.
For #4 the user chose a personal server first (2026-10-10, see below); device sync remains
outstanding.

Additional authorized scope: Canvas workspace tabs for Canvas, Chat and a future
placeholder. Move prompting into provider-specific per-board chat threads; retain
live generation progress/previews on Canvas. Threads are private to each account,
including on boards shared with editors (confirmed by the user).
This supplements rather than replaces #3, #6 and #4.

Canvas/Chat polish (2026-10-07, user request; layout chosen by the user): the
Canvas/Chat/reserved tabs moved into the header as a compact switch, so the canvas
gains the former tab row. On screens 1100 px and wider, Chat docks beside a live,
editable canvas. It is resizable, and can expand to a full page with a thread sidebar;
both choices are per-device preferences. Narrow screens use a full-page chat with a
thread menu. The chat has message bubbles labelled with provider and model, inline live
activity with Stop, and a "Review on canvas" card. Errors are styled, and the composer
is docked to the bottom. The Canvas tab shows working/review status and the Chat tab
an unread reply. A proposal review opens beside the docked chat. Header Export/Linked
from become icons on phones. A new browser scenario covers docking, review placement,
expansion persistence and accessibility. The reviewed Linux pixel baseline was
regenerated for the taller canvas. Verified: lint, typecheck, Rust check/24 tests,
desktop check/race tests, packaged integration and 399 unit tests pass. Fastify
`test:qa` passes 57/57 browser scenarios, and so does the rebuilt Linux binary.
The hidden WebView smoke test passes. Desktop and mobile screenshots were reviewed;
no paid model calls were made. While validating, a desktop-sync fingerprint bug was
found and fixed: only the first file was hashed, so web changes were missed. A
regression test now covers it (`pnpm release:test`).

Chat model-settings fix (2026-10-07, user report): opening Model settings in the docked
chat made the panel taller than the chat column, pushing its controls and the Model toggle
off-screen with no way to scroll or close it. The chat composer now shrinks within the
column and only the settings panel scrolls; the prompt and toggle stay visible. A new
browser scenario on a short 1280×640 screen checks every section is reachable, only the
panel scrolls, and the toggle closes it; it failed before the fix. Verified: lint,
typecheck, Rust check/24 tests, desktop check/race tests, 399 unit tests and all 58
Fastify browser scenarios pass. CSS-only; the desktop binary was not rebuilt by hand. CI run
37629889984 passed every job. Follow-up at the user's request: when the composer is
narrower than 480 px (docked chat, phones), the Model toggle shows only its sliders icon
as a round button with a tooltip and its full accessible name, instead of truncating to
"M…". The scenario now checks the icon form, the labelled form in the full-page chat and
no phone overflow. Lint, typecheck, Rust, desktop checks, 399 unit tests and 58 browser
scenarios pass; desktop and phone screenshots were reviewed.

Local Linux desktop sync (2026-10-07, user request): `pnpm desktop:sync` rebuilds
the desktop app from the current checkout when sources changed. It reuses the
speech runtime when its inputs are unchanged and installs to `~/.local/opt/opsis`
with a command link and application-menu entry. Opt-in git hooks
(`--install-hooks`) run it in the background after commits, merges, rebases and
branch checkouts. It is a no-op on non-Linux systems, in CI, or without the native
toolchain. Verified on Arch/Hyprland: the full build, an incremental rebuild that
reused the runtime, the no-op check, a background hook build with a concurrent
request, and the hidden WebView smoke test (24 checks) against the rebuilt binary.
Lint, typecheck, Rust check/24 tests, desktop check/race tests and packaged
integration pass. The full browser suite passes 56/56 against the rebuilt Linux
binary, including the Linux pixel baseline. Fastify `test:qa` passes 399 unit tests
and 56 browser scenarios. The canvas-drawing eraser step consistently raced the
post-reload viewport animation on this machine. It now waits for the view to settle
and erases at the stroke's rendered position, with its assertions unchanged. It
passes 4/4 repeats on each host.

Integrated on `codex/links-chat-collections` in the isolated `Opsis-links-chat`
worktree: board links, collection sharing/export/import, private account/provider/model
chat and, at the user's request, Claude's `canvas-drawing` branch. Drawing shortcuts
are active only on Canvas. Regression tests preserve drawings and links through chat
regeneration and collection copies/HTML export. Chat persistence is independent of
board sharing; public viewers can still browse/delete their own existing threads.

Combined validation (2026-10-07): full Fastify and rebuilt Windows-executable browser
suites each pass 55 scenarios with one Linux-only skip. The Linux screenshot was
regenerated with Playwright's Linux Chromium in WSL against the built app and visually
reviewed. Lint/typecheck, Go vet/full race suite, packaged integration and all 24 hidden
WebView checks pass. Rust check/24 tests pass (Rust unchanged by the merge). Unit tests:
398 pass in the full single-worker run; the one new HTML-test decoding mistake was fixed
and passes in its rerun (399 total). Earlier interrupted browser runs are not counted.
Desktop and mobile chat screenshots were inspected. No paid model calls were made.
The system print dialog itself remains a manual platform check. CI for this integration
has since passed: later runs, most recently 37920477193 (2026-10-09), passed every job. Remote server/sync (#4) has not been implemented.

CI follow-up: provider run 37454454247 passed web, Linux and Windows. Both Mac
architectures passed native tests, builds, integration and browser coverage but
timed out in the hidden WebView smoke. The preceding Apple Silicon rerun also
timed out. Commit 1b304dc adds bounded smoke-step diagnostics and an awaited native
round trip before each condition wait, without changing checks or deadlines.
Local Windows smoke passes all 24 checks. Follow-up run 37456419571 passes every
job, including both Mac smoke tests, packaging and release publication. Apple
Silicon's smoke completes all 24 checks in about four seconds. The native round
trip changes scheduling; the earlier stall's exact root cause is not proven.
Retain these diagnostics if it recurs rather than treating a timeout as harmless.

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
were inspected. CI has since passed: later runs, most recently 37920477193 (2026-10-09), passed every job.

Trusted Windows signing and Apple signing/notarization are explicitly deferred by
the user. Windows UI automation was retried and again returned "Computer Use
native pipe is unavailable". Interactive save-dialog/clipboard and manual Mac
checks remain open; no local Mac is available. The later scope update above now
authorizes #3, #6 and #4.

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
publishing.

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
no further diagnostic. Superseded: run 37456419571 passed both Mac smoke tests (see the CI
follow-up above), and later runs, most recently 37920477193 (2026-10-09), passed every job.

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
and interactive platform checks remain open; later runs, most recently 37920477193 (2026-10-09), passed every job.
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
provider's signing call) and the interactive save-dialog/clipboard check. (`.cmd` launcher
parity and macOS packaging have since shipped; see above.)

## Completed: release retention (requested 2026-10-08)

- [x] CI keeps only the 5 newest build prereleases: after each publication a reusable
      `release-retention` workflow deletes older ones with their tags, one run at a time.
      Drafts in progress and hand-published stable releases are kept; a manual dispatch
      defaults to a dry run. Unit tests cover ranking, drafts, stable releases and limits;
      a dry run against the live repository planned to keep 5 of 37 and delete 32. CI run
      37745959481 (9fc2312) passed every job; its retention job deleted 33 older build
      prereleases and their tags (the 32 planned plus build 87, displaced by build 93),
      with no failures. Exactly 5 build prereleases and 5 tags remain (builds 88–93).

## In progress: continuous chat and drawing focus (requested 2026-10-08)

The user asked that chat threads keep their context continuously ("harness based") and that
the agent prioritise drawings when items are chosen. Confirmed choices: hybrid continuity
(Opsis thread notes for every provider plus native CLI session resume for Claude/Codex) and
"selected become focus" (selected drawings are sent and may be edited after review).
Line endings: the repository now forces LF via `.gitattributes`, so commits from Windows
match Linux.

- [x] Thread notes: the agent returns a short `reply` and rewrites bounded `memory` each turn;
      the thread stores both (optional fields in the chat document, no migration).
- [x] Outcomes: assistant messages record applied / review / partial / discarded / failed,
      updated when the reader resolves a review, and sent to the agent with recent messages.
- [x] Continuous threads: at 80 messages the oldest are condensed into the notes instead of
      refusing; the demo or a model without notes keeps condensed requests as note lines.
- [x] Native sessions: Claude (`--session-id`/`--resume`) and Codex (`exec resume`) resume a
      per-thread session in a server-derived `opsis-sessions/<account>/<thread>` directory on
      both hosts; resumed turns send a short continuation prompt; sessions rotate after 16
      turns; a failed resume is forgotten and reported, never retried. Other CLIs and API
      connections stay ephemeral.
- [x] Drawing focus: selected drawings, or those attached to the selected concept, are sent
      (never hidden/locked ones); the agent may return `focusEdits` for exactly those, which
      the review shows as one selectable "Change your selected drawings" item.
- [x] Drawing first: a shared pure rule (focus, drawing tool, spatial request) sets the
      priority, shown and overridable in the chat composer.
- [x] Transcript removal (2026-10-09): a thread's session state now lists every session it has
      used (up to 128, with the day each started), including ones replaced after 16 turns, a
      failed resume and a failed first Claude turn. Deleting the thread, or the board holding it,
      removes those transcripts from Claude's and Codex's own stores by validated session id,
      then the thread's directory, on both hosts. Other CLI sessions are never touched.
- [ ] Not yet: no live provider call has verified resume or transcript removal against real
      Claude/Codex accounts (fake CLI stores only); the CLIs' own indexes and prompt histories
      (such as Codex's state database) are not edited; semantic summarisation of very old turns
      relies on the agent's notes.

Verified 2026-10-08 on Windows 11 (Node 22.23.2): lint, typecheck, Rust check/24 tests,
439 unit tests (new: thread condensation/outcomes, focus privacy and merge, review
selection, session planning/rotation/failed resume, CLI session arguments, per-thread
working directory, chat generation with notes/focus/repair/demo), Go vet and the full race
suite (new: Codex session resume scoped per account on the Go host). Browser suite: 60 pass
plus one Linux-only skip on both Fastify and the rebuilt `opsis.exe`, including a new
scenario covering focus chip, drawing-first, reviewed focus edits, notes, outcomes and
excluding a focus. Packaged database/MCP integration and all 24 hidden WebView2 checks
pass. Chat screenshots were inspected. No live provider calls were made, so native resume
is verified against fake CLIs and the installed CLIs' `--help` (Claude Code 2.1.293,
Codex 0.161.0), not a real account. CI run 37735096270 (e18fa47): Linux, Windows and both
macOS desktop jobs passed (native tests, packaged browser and hidden WebView checks); the web
`check` job failed at typecheck on test-only `exactOptionalPropertyTypes` errors in
`sessions.test.ts`, so its later steps did not run there. Fixed in the follow-up commit (full
local typecheck passes). Follow-up run 37737511117 (ee3a2eb): the web `check` job (typecheck,
unit tests and the full browser suite), Linux and both macOS desktop jobs passed. Its first
Windows attempt failed in packaged integration with the known intermittent "Native server
startup timed out" (also seen in run 37423155398; no code change involved); the rerun of that
job passed, and the prerelease was published. Retain this note if the timeout recurs.

## Completed: interface colours on the account (requested 2026-10-10)

Settings → Appearance already set light/dark/system, seven accents and fonts in one browser.
The user asked to change the interface's colours too and chose all four additions offered.

- [x] Background palettes (Sage, the existing default, plus Neutral, Warm, Cool and Dusk) set the
      page, panels, sidebar, lines and text tones for light and dark; body text stays at least
      4.5:1 on every background they set.
- [x] Custom accent: any colour from a picker or hex. Light mode darkens and dark mode lightens it
      until button text, accent text and soft fills read at 4.5:1 on every palette.
- [x] The primary-button gradient and the library grid follow the accent (Evergreen keeps its
      original green-to-blue gradient), and each stop keeps the button text readable.
- [x] Appearance is an account setting (`appearance`, validated by the shared schema on both hosts,
      no migration) and is cached in the browser so it paints before sign-in. A look chosen in a
      browser before this change is copied to the first account there that has none; another
      account never inherits a cached look.
- Fixed while testing: the theme override used plain `:root` rules, but the workspace's stylesheet
  loads after it, so in System mode the chosen accent and fonts (and any new token) lost to the
  defaults. Its selectors now outrank foundation.css's instead of depending on load order.

Verified 2026-10-10 on Arch Linux: unit tests for palette and preset contrast, custom colours
(yellow, green, black, white, grey and others), gradients, the stylesheet, id narrowing, and
adopting, copying and isolating the account's look; Fastify and Go API tests store, refuse
malformed values (`url(...)`, markup, unknown modes) and keep the setting per account. Two new
browser scenarios check the live tokens, a second browser opening with the same look, reset
propagating, a second account in the same browser starting from the default, phone overflow and
accessibility scans in light and dark. Lint, typecheck, Rust check/24 tests, desktop check and
full race suite, 490 unit tests and all 66 Fastify browser scenarios (including the unchanged
Linux pixel baseline) pass. The rebuilt Linux binary passes packaged integration, all 66 browser
scenarios and all 24 hidden WebView checks. Light and dark screenshots were reviewed.

## Completed: agent drawing power (requested 2026-10-10)

The user wants agents to be able to show any 2D subject or drawing. A gap review found four
priorities; the user asked for all four to be tracked and for 1–3 to be built now.

- [x] 1. Richer shapes and styling (2026-10-10): `polygon` (closed), `arc` (start, a point it
      passes through, end) and `path` (validated SVG path data in canvas coordinates; arcs and
      shorthands are normalised so paths move, turn, scale and mirror exactly). Fill ink separate
      from the outline, fill and overall opacity, hatching (diagonal, cross, horizontal, vertical,
      dots), a dotted line style, start/end markers (arrow, dot, bar) and text alignment, bold and a
      backdrop. One shared SVG renderer (`drawingSvg`) now paints the canvas, exports and agent
      previews. On the canvas the new shapes are hit-tested (filled shapes inside), selected,
      moved, resized, rotated and erased, and the panel sets opacity, fill ink, hatch, markers and
      text style. Chat agents get the shapes through the shared schema and prompt; MCP agents
      through the drawing tools. No hand-drawing tools for polygons or paths yet.
- [x] 2. Render tool (2026-10-10): `opsis_render_board` returns a PNG of the board or a region,
      with every visible drawing as painted, concepts as labelled circles, straight connections
      and rulers in canvas coordinates. The preview SVG is built by shared code, checked against
      a strict tag/attribute allow-list (no links, entities, scripts or external URLs) and
      rasterised by `POST /v1/render` with `sharp` on Fastify, and by the desktop's Node service
      behind a signed-in Go route. The Go MCP bridge now passes image results through. Without
      that Node service the tool returns the SVG markup. Chat agents do not get a preview loop.
- [x] 3. Symbols, groups and bulk transforms (2026-10-10): 35 symbols (architecture, electrical,
      process/P&ID, general) placed as grouped, ordinary drawings (`opsis_list_symbols`,
      `opsis_place_symbols`, with size, rotation, mirror, ink and label). `groupId` makes the canvas
      pick, drag and restyle a group as one. `opsis_transform_drawings` (move, scale, mirror,
      rotate about the group, each piece or a point, align, distribute),
      `opsis_repeat_drawings` and `opsis_group_drawings` work in one undoable step on shared pure
      transforms, which now also hold the canvas's rotation helpers. `opsis_get_board` reports
      every drawing's painted bounds. The catalogue is 24 tools on both hosts.
- [x] 4. Chat sketches as edits, a larger budget and streaming (2026-10-10): a follow-up on a board
      with an agent sketch is offered `sketchEdits` (`put` adds or replaces a drawing by id,
      `remove` deletes by id), applied by a shared pure rule to the sketch the agent was shown;
      the result is validated and reviewed exactly like a whole sketch, and mismatched edits
      (unknown ids, put and remove of one id, both forms at once) get the usual single repair.
      The edits only appear in the schema when there is a sketch to change, so other requests
      stay small. A sketch may now hold 120 drawings (was 60; the board limit stays 200) and
      the output budget is 24,000 tokens (was 14,000). Drawings stream: each complete, valid
      drawing (from `drawings` or `sketchEdits.put`) is sent as a provisional `drawing` event and
      painted faintly on the canvas, with a status line, until the answer is validated; nothing is
      saved before review. The demo streams its sketch at a measured pace on both hosts (a new
      native `nativePause` lets the desktop's embedded workflow wait) and answers "widen the
      zone" with two edits.
- [x] Agents draw when a picture helps (2026-10-10, user request): the chat instructions no longer
      say "never draw for its own sake"; the agent adds a sketch whenever a picture would make the
      answer clearer, including charts, timelines and labelled pictures, and always when asked.

Limits of item 4: Claude's CLI streams drawings one by one; Codex's CLI only reports its message
when it is complete, and API providers return the whole answer, so their drawings appear
together just before review. The three-minute generation deadline is unchanged, so a very large
first sketch can still run out of time. Chat agents still cannot see a rendered preview.

Grok compatibility: the richer schema and instructions pushed a minimal Grok CLI request past
the 24,000-character argv cap (it had been within about 300 characters). The cap only guards
Windows' 32,767-character command line, so it is now 30,000, still about 2,400 below that
limit with the other arguments. A test checks that the instructions and schema fit.

Verified 2026-10-10 on Arch Linux. Schema tests cover path normalisation (relative,
shorthand and arc commands, compact arc flags), malformed data, exact transforms, sampling,
three-point arcs, shape validation, scale/mirror/rotate/align/distribute/repeat, every symbol
placed centred in one group, rendered fills, hatching, markers and text styles, and the preview
and its SVG allow-list. One bug was found and fixed while writing them: distributing drawings
moved nothing. Canvas tests cover
filled-shape picking, path hits, group picking and point-by-point resize/rotation. API tests cover
sign-in, refusal and one-at-a-time rendering. MCP tests cover styles, symbols, transforms,
repeat, grouping and locks; an MCP round trip through the real Fastify API returns a real PNG.
Go tests cover the render route (401, 503 without Node, forwarding), image passthrough in the
bridge and the 24-tool catalogue. A new browser scenario covers painting the new shapes,
picking a group, restyling it from the panel, dragging it as one undoable edit and reloading,
with an accessibility scan. Lint, typecheck, Rust check/24 tests, desktop check and full race
suite, 481 unit tests and all 64 Fastify browser scenarios pass. The rebuilt Linux binary passes
packaged integration (24 stdio tools and a real PNG preview from its bundled `sharp`), all 64
browser scenarios and all 24 hidden WebView checks. Canvas and preview screenshots were
reviewed. CI run 38014972744 (3db7383) passed every job, including Windows and both macOS
desktop jobs. No paid model calls were made; chat agents' use of the new shapes is covered by the
schema and prompt, not by a live model.

Item 4 verified 2026-10-10 on Arch Linux: schema tests for applying edits (order, removal,
unknown ids, conflicts, the 120 limit) and for offering edits only with a sketch; API tests for an
edited sketch reaching review unchanged in form, the schema and instructions sent to the agent,
three invalid edit answers each repaired once, and the demo streaming three drawings then
editing; scanner tests for drawings from a whole sketch and from edits across arbitrary chunk
boundaries, ignoring look-alikes in strings and nested objects; activity tests for replacement and
reset; and a Go test that the desktop workflow streams the demo sketch paced by `nativePause`.
A new browser scenario watches the sketch appear faintly on the docked canvas before review,
applies it, asks for an edit, and checks only the zone changed and the note was added, with an
accessibility scan; it passed three repeats. Lint, typecheck, Rust check/24 tests, desktop check
and full race suite, 497 unit tests and all 67 Fastify browser scenarios pass. The rebuilt Linux
binary passes packaged integration, all 67 browser scenarios and all 24 hidden WebView checks.
No paid model calls were made, so real agents' use of edits and streaming is verified with fake
answers and the demo, not a live model.

## In progress: canvas drawings (requested 2026-10-06)

Add normal/illustrative drawing on the canvas beside icon diagrams, so a board can hold
blueprints and hybrid flows (engineering and architecture) instead of only process flows.

- [x] Board document v2 gains an optional, bounded `drawings` list (shared schema,
      `board-drawings.ts`): stroke, line, arrow, box, ellipse, text and dimension shapes in
      named inks with solid/dashed/centre-line styles. Shapes are validated declarative data,
      never markup; at most 200 per board and 400 points per stroke.
- [x] A drawing may move with a concept (`anchorId`, coordinates relative to it). Removing that
      concept by hand, review, MCP rewrite or regeneration keeps the drawing where it was drawn.
- [x] Canvas tools: diagram/select/pen/line/arrow/box/ellipse/text/dimension/eraser, keyboard
      shortcuts, grid snapping with Shift constraints, restyling, attach/detach and delete. Each
      shape, move, restyle or erase sweep is one undoable edit; viewers only see drawings.
- [x] Shapes paint beneath icons and arrows; text and dimension labels paint above them.
      SVG/PNG exports draw them the same way. Agents never receive drawings, and follow-ups
      keep them.
- [x] MCP drawing tools (2026-10-07): `opsis_add_drawings`, `opsis_update_drawing` and
      `opsis_remove_drawings`, plus a scale on `opsis_update_board`. `opsis_get_board` returns
      concept positions, drawings in absolute coordinates, layers and the scale. Agents cannot
      change locked drawings or those on locked/hidden layers, and cannot lock or unlock.
- [x] Board-level scale (`drawingScale`: what one grid square measures, any unit up to 12
      characters); unlabelled dimension lines read in it on the canvas and in exports.
- [x] Resize handles (box/ellipse/stroke compass points, line/arrow/dimension ends; snapping,
      Shift keeps proportion, Alt free) and multi-select (Shift+click, drag rectangle, Ctrl/⌘ A;
      group move, restyle, attach, layer, lock and delete).
- [x] Layers (`drawingLayers`, up to 12: order, rename, hide, lock, delete moves drawings to the
      base layer) and per-drawing locks. Hidden layers are left out of the canvas and exports.
- [x] Copy/cut/paste via clipboard events (validated JSON text, works across boards and tabs)
      and Ctrl/⌘ D duplicate; each paste is one undoable step.
- [x] Rotation (2026-10-07): an optional `rotation` (degrees about the centre) for boxes,
      ellipses and text; strokes, lines, arrows and dimensions turn their points. A rotation
      handle (Shift: 15° steps), a Rotation field and Rotate 90°; rotated shapes are hit-tested,
      outlined, resized in their own frame and exported as painted. MCP tools accept `rotation`.
- [x] Text corner handles change its font size (8–96), keeping the opposite corner in place.
- [x] Chat-generation sketches (2026-10-07): the board output may include up to 60 agent
      drawings (same validated shapes, anchored to concepts or free-standing; invalid ones get
      the usual single repair). They go on an "Agent sketch" layer; free-standing sketches on a
      new diagram are placed right of it. Follow-ups show the agent only its own sketch and the
      scale; leaving the list out keeps it, and a hidden/locked agent layer is neither sent nor
      changed. Sketch changes are one reviewable proposal item ("drawings"); the server's
      change check also requires review. The demo agent sketches the email servers on request.
- [x] Fixed an existing drawing bug found while testing: pointer positions were snapped to the
      canvas's 24-unit concept grid, so freehand strokes were quantised, Alt did not place points
      freely and small handles were missed. Drawing input now does its own snapping only.
- [x] Group rotation (2026-10-09): with several drawings selected, **Rotate 90°** and a new
      **Turn selection (°)** field turn them together about the centre of their combined outline,
      keeping their layout, as one undoable edit. Attached drawings stay attached; locked ones
      are left alone. One drawing still turns about its own centre.
- [ ] Not yet: an on-canvas rotation handle for a multi-selection (the panel controls turn it).
      Streaming an agent's sketch shipped with agent drawing power item 4 (2026-10-10).

Verified 2026-10-07 on Arch Linux: schema tests (layer order/visibility/locks, layer removal,
scale labels and validation), web geometry tests (handles, resize/flip/proportion, stroke
scaling, rectangle selection, clipboard validation and paste remapping, export of hidden
layers and scale, regeneration keeping layers/scale and not sending them), MCP unit tests and
an MCP round trip through the real Fastify API. A new browser scenario covers rectangle
selection, copy/paste/undo, handle resizing, locking, the scale, a new layer, hiding it and
persistence across reload, with an accessibility scan; it found and fixed a contrast failure
in the panel's link button. Lint, typecheck, Rust check/24 tests, desktop check/race tests
(including the 15-tool MCP catalogue), 411 unit tests and 59 Fastify browser scenarios pass.
The rebuilt Linux binary passes packaged database/MCP integration, all 59 browser scenarios
and all 24 hidden WebView checks. Desktop and phone screenshots were reviewed. No paid model
calls were made. CI run 37636842699 passed web, Linux and Windows. Both Mac jobs failed only
the new scenario, because the test pressed Control+C/V; on macOS the browser copies and pastes
with ⌘. The test now uses Playwright's platform modifier; the app is unchanged. Follow-up run
37639361136 passed every job, including both Mac architectures and release publishing.

Rotation, text handles and chat sketches verified 2026-10-07 on Arch Linux: geometry tests
(rotation, rotated hit-testing and resizing, text sizing), schema/review tests (sketch as one
change, rejected concepts, key-order-insensitive comparison), client layout tests (placement,
clashing ids, locked layer) and API tests (sketch validation and repair, follow-up review, demo).
A browser scenario covers a demo chat sketch through review, the rotation handle and field, text
corner sizing and a locked agent layer, with an accessibility scan. It found two bugs, both fixed:
the grid-snapped pointer and a review that saw a reordered but identical sketch as changed.
Lint, typecheck, Rust check/24 tests, desktop check/race tests, 418 unit tests and 60 Fastify
browser scenarios pass. The rebuilt Linux binary passes packaged integration, all 60 browser
scenarios and all 24 hidden WebView checks. No paid model calls were made. CI run 37657514613
passed every job, including both Mac architectures and release publishing.

Verified 2026-10-06 on Windows 11 (Node 22.23.3) against a clean `HEAD` worktree (other
uncommitted work excluded): schema tests (shapes, anchors, removal/review detachment,
dimension labels), web geometry/export tests and two browser scenarios on Fastify (drawing,
persistence across reload, undo/redo, attach-and-drag, erasing, accessibility scan; and a
board with drawings but no concepts). Lint, typecheck and all 393 unit tests pass (six
API/lint-rule tests timed out under full-suite load and pass when rerun alone). The full
Fastify browser suite passes 51 of 52 scenarios; the Linux-only pixel baseline is skipped.
The Go desktop host validates the same embedded contracts: Go vet and the full race suite
pass with the rebuilt contract bundle, and Rust check plus its 24 tests pass. Branch CI run
37471183918 (`canvas-drawing`) passed every job: web checks with all 52 browser scenarios,
including the Linux pixel baseline (the collapsed drawing-tools button stays within its
tolerance), and the Linux, Windows and both macOS desktop jobs with their packaged-executable
browser and hidden WebView checks. The combined integration and its updated Linux
baseline are verified in the current-delivery section above.
See the [user guide](docs/USER-GUIDE.md#draw-on-the-canvas).

## Completed: board collections (requested 2026-10-05)

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
- [x] MCP collection tools (2026-10-09): `opsis_list_collections` (with board counts),
      `opsis_create_collection` and `opsis_file_board` (owner only, `null` unfiles), plus
      `collectionId` on `opsis_create_board` and in `opsis_list_boards`. Filing adds no revision
      or undo step. The catalogue is now 18 tools on both hosts.
- [x] Bulk moves (2026-10-09): **Select boards** in My boards ticks several cards (or
      **Select all shown**) and moves them to one collection or Unfiled. Only boards shown
      under the current filters count; one request per board with a single refresh, and a
      failure is reported with how many moved. The library keeps its collection filter in the
      address (`/boards?collection=<id>`), so reloads and links reopen it.
- [x] Collection-aware recents (2026-10-09): Home's Recent boards labels each board's
      collection, offers chips for collections holding recent boards, and **All in …** opens that
      collection in the library. The sidebar no longer has a recents list (removed in the earlier
      minimal-rail redesign), so it has nothing to make collection-aware.
- [x] Per-board JSON export (2026-10-09): a filed board's **Editable board** file names its
      collection in a top-level `collection` field beside the unchanged board document.
      Importing it files the new board into the importer's collection of that name (ignoring
      case), creating one if needed, and the import preview says so.

Verified 2026-10-09 on Arch Linux: MCP round trip through the real Fastify API (create, case-
insensitive duplicate refused, file at creation and later, counts, unfiling, unknown collection,
another account's board refused, revision 1 and empty history kept) and the Go native MCP test
(filing through the embedded catalogue keeps the revision). A new browser scenario covers
selecting, moving, unchanged revisions, home recents labels/chips, the library link and reload,
select-all-shown, unfiling, phone overflow and accessibility scans. While reviewing its
screenshots, a pre-existing home/library layout bug was found and fixed: the decorative backdrop
was sized to the window rather than the page beside the sidebar, so the page could scroll 132 px
sideways at 1280 px; the scenario now asserts no sideways scroll. Lint, typecheck, Rust check/24
tests, desktop check and full race suite, 440 unit tests and all 62 Fastify browser scenarios
pass. The rebuilt Linux binary passes packaged database/MCP integration (18 stdio tools), all 62
browser scenarios and all 24 hidden WebView checks. Desktop and phone screenshots were reviewed.
No paid model calls were made. CI run 37920477193 (21a7d6d) passed every job: web checks,
Linux, Windows and both macOS desktop jobs, prerelease publication and release retention.

Verified 2026-10-09 on Arch Linux (group rotation, transcript removal and the collection in
board JSON files; also referenced from the drawing and chat goals): geometry tests (shared
centre, a box travelling around it, a full turn returning home); session tests (every session
listed across replacements, providers, a failed resume and a failed first turn; ids validated);
removal from fake Claude/Codex homes (transcript, tool results, session-env, to-dos, a rollout
in the next day's folder; the reader's other sessions and rollouts kept); Fastify route tests
(thread delete removes only that account's session; board delete removes every account's
threads' sessions); and a Go API test of the same on the desktop host, a Go harness test (a
state without days searches every date folder; unsafe ids and keys refused), and the Go
generation test confirming the embedded workflow lists the Codex session. Browser scenarios
cover turning three selected sketch drawings 90° together (zone moved, dimension rotated a
quarter, undo restores) and exporting a filed board, then importing it into a renamed
same-named collection and, after deleting that, into a newly created one. Board file tests
cover name trimming and invalid names. Lint, typecheck, Rust check/24 tests, desktop check
and full race suite, 446 unit tests and all 63 Fastify browser scenarios pass. The rebuilt
Linux binary passes packaged database/MCP integration, all 63 browser scenarios and all 24
hidden WebView checks. No paid model calls or real CLI sessions were used. CI run
37934511964 (4914600) passed every job: web checks, Linux, Windows and both macOS desktop
jobs, prerelease publication and release retention.

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
page fade-ins. Those fixes are verified in CI: later runs, most recently 37920477193 (2026-10-09), passed every job.

### Links between boards (#3)

- [x] A concept may link to another board (optional saved field, never requested from agents and
      kept through regenerations). The canvas marks linked concepts; opening follows the link with
      a way back; boards show which boards link to them (backlinks).

### Collection sharing and export (#6)

- [x] Owners can make every board in a collection public/private and invite/revoke an editor for
      all of its boards in one action.
- [x] Export a collection as a bundle and import it as new private boards in a new collection,
      remapping links between its boards; export a self-contained read-only static site; print a
      collection walkthrough (save as PDF from the print dialog).

### Remote Opsis server and device sync (#4)

Scope decision (2026-10-10, user): the user will deploy Opsis on their own server behind
Nginx for personal use, opened from a browser, so a **personal server mode** comes first and
device sync is deferred until needed. The chosen option left out invite links and the
audit log as unnecessary for one person. The user also decided that agent CLIs are a server concern, not an account
one: the server runs its own installed and signed-in CLIs (instead of disabling local CLI
generation), and the executable path an account saves is ignored there.

- [x] Personal server mode for the Fastify host (`OPSIS_PUBLIC_ORIGIN`, HTTPS only; see
      `docs/SERVER.md`). Requests through the trusted proxy (`OPSIS_TRUSTED_PROXY`, default
      loopback) must be HTTPS for the public host, or they get 421; writes need the public
      `Origin`. Secure cookies, HSTS, CSP, frame denial and isolation headers are set. The
      built web app is served with page-route fallback, and its files are exempt from API rate
      limits. A non-loopback `HOST` is allowed only in this mode. MCP agent keys stay
      loopback-only. Loopback mode is unchanged.
- [x] Closed sign-up with operator accounts: `pnpm accounts list|create|reset-password`
      (generated or stdin password; a reset signs the account out everywhere). `GET
/v1/instance` reports sign-up and CLI-path capability, and the Go desktop reports a local
      instance. The sign-in page then offers only logging in, and Settings shows that the
      server sets CLI paths.
- [x] Server-run CLIs: an account's saved executable path is dropped before any agent check,
      generation or illustration; `OPSIS_<AGENT>_BIN` or PATH on the server decide.
- [ ] Not in this delivery: an audit log with retention, invite links and self-service
      password recovery (operator resets instead).
- [ ] Deferred until requested: per-device sync tokens and syncing local hosts (Fastify and
      Go desktop) with a server through a shared pure planner (push, pull, three-way merges,
      conflict and edit-vs-delete copies, collections and tags by name).
- [ ] Not in this delivery: live presence/cursors, multi-server scaling, hosted backups.

Verified 2026-10-10 on Arch Linux: server-mode API tests (origin validation; closed sign-up
and Secure cookie; refusal of plain HTTP, other hosts, other origins and spoofed headers from
an untrusted peer; loopback MCP access; web app fallback, cache headers and path traversal;
rate limits not spent by app files; account executable paths dropped; operator create/reset
signing sessions out) and a Go test of the desktop's local instance. Web unit tests cover the
login-only page and the `/signup` redirect. End to end, the built app ran in server mode behind
a local TLS proxy that forwards like the documented Nginx configuration (Nginx is not installed
here). Chromium checked the redirect to login, the operator note, logging in, the Secure
cookie, the disabled CLI path field and board creation, with no CSP violations. This run found
the rate-limit bug fixed above: app files had exhausted the API budget (429). The documented
`pnpm --filter api start` serves the app, and an `http://` origin is refused at startup.
Review also found a
pre-existing bug. The rule that only signed-in people may check agents, generate or illustrate
matched the raw URL, but the router decodes paths. An unauthenticated
`POST /v1/boards/%63heck-agent` therefore reached the agent check. That rule and the rate-limit
buckets now use the matched route, and regression tests cover encoded paths. CI run 38008537517 (3892664) passed every job: web checks, Linux, Windows and both macOS
desktop jobs, prerelease publication and release retention. Not yet verified
on a real Nginx/Let's Encrypt host; the browser narrator's model download
under the CSP was not exercised (speech off in tests).

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
