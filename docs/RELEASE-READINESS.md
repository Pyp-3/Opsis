# Release readiness review

Reviewed 2026-10-04 for the web application and Linux Go/Wails host. This is a
bounded local-application release review, not a claim that an internet-hosted,
multi-tenant service has been certified.

## Deployment boundary and findings

Both entrypoints bind to loopback. The development API now refuses `HOST` values
other than `127.0.0.1`, `::1` and `localhost`; the packaged host already binds
`127.0.0.1`. Existing account sessions remain HttpOnly/SameSite=Lax, with Secure
cookies on HTTPS in the Fastify host. Passwords use scrypt; session/agent tokens
are stored as hashes. Agent keys remain restricted to direct local non-browser
requests, with revocation and account ownership enforced on both hosts.

API responses now carry `Cache-Control: no-store`, `X-Content-Type-Options:
nosniff` and `Referrer-Policy: no-referrer`. Both hosts reject browser-marked
cross-site writes before authentication. This is defense in depth, not a substitute
for a full origin/CSRF policy if deployment scope changes. Source links accept only
HTTP/HTTPS, render as text links and isolate their opener. Imported text/legacy
behavior remains declarative data. New shared editing is explicit and per-board;
public visibility does not grant write access or saved revision access.

The review's network-hosting blockers are:

- Local CLI accounts and executable-path settings are capabilities shared by users
  of this trusted local installation. A hosted service needs isolated provider
  credentials, per-user quotas, executable allowlists and worker isolation.
- Signup is open to users reaching the local instance. A hosted deployment needs
  administrative enrollment, account recovery and abuse controls.
- TLS termination, trusted proxy/origin policy, secure cookie handling across both
  hosts, CSP, backup access control and operations/audit retention need a designed
  deployment configuration. Do not expose the current host through a public proxy.
- Current rate limits are process-local and SQLite is a single-server store.
  Multi-host service scaling, cross-install sync and live presence are outside this
  release. Inviting accounts on this server does not change that boundary.

These conclusions follow the current source and its authorization tests. Related
primary guidance: [OWASP session management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
and [OWASP CSRF prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html).
No external-system probing or paid provider calls were part of this review.

## Loading and layout

The pre-P2 production entry was approximately 782 kB minified (249 kB gzip). The
session shell now loads before the workspace; settings, account and player code
load when needed. The new entry is approximately 277 kB (86 kB gzip). This reduces
initial sign-in loading, not the total amount of code eventually used by all pages.

The previous 1.44 MB ELK bundled chunk combined its API and layout implementation.
Layout now loads the small API on demand and runs the 1.59 MB upstream worker asset
outside the UI thread, with a 15-second bound and guaranteed worker termination.
The worker is still large; this is separation of loading/execution, not removal of
its algorithms. See the [ELK worker documentation](https://github.com/kieler/elkjs#usage).
Speech/WASM models remain on-demand assets. Production builds keep the default
chunk-warning threshold so future regressions remain visible.

## Repeatable checks

CI starts from checkout and `pnpm install --frozen-lockfile`. It explicitly verifies
native SQLite write/read/WAL/integrity behavior using `scripts/verify-install.mjs`
and checks recorded CLI compatibility without account access or paid requests.
Accepted versions remain in `apps/api/src/harness/version.ts`: Claude 2.1.x,
Codex 0.156.x/0.157.x/0.159.x and the existing internal agy 1.2.x adapter. The latter
is not an exposed application provider. New versions require reviewed fixtures;
these checks are not a live-provider entitlement or end-to-end availability test.

The quality gate includes Rust checks/tests, TypeScript/lint, unit/API/schema tests,
headless browser scenarios, native vet/race tests, packaged API browser parity,
database import/MCP integration and an isolated hidden Wayland WebView smoke.
Browser scenarios cover keyboard reconnection, reviewed legacy/text import,
network-loss recovery, streamed cancellation, malformed completion, dense graphs,
shared edits/revocation and screenshot regression. Existing harness tests cover
bounded process deadlines, cancellation, malformed envelopes and the single repair.

The approval-process screenshot baseline is checked in under
`tests/workspace/p2.spec.ts-snapshots/`. It is a test fixture, not a runtime artifact.
Generate updates deliberately, inspect them, and keep the same Linux Chromium,
viewport and locale. The canvas baseline normalizes text to Arial/Liberation Sans
so external Google Fonts availability cannot change it. A fit assertion also verifies the last concept is above
the composer, so accepting a new image cannot hide that regression.

A separate fresh local dependency tree was installed with the frozen lockfile and
passed the native SQLite check. pnpm reported the existing ignored optional `sharp`
build script; no blanket build-script approval was added. Windows/macOS packaged
runtime validation remains a separate platform goal. See `GOALS.md` for final
validation counts and the applicable delivery commit.
