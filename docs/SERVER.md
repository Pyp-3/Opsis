# Personal server

Run Opsis on your own server and open it from any browser at your own HTTPS address. This
mode is for **one person or a small group the operator trusts**: the operator creates every
account, and everyone shares the agent CLIs and API keys configured on the server. It is not
a public multi-tenant service. Boards live only in the server's database. Syncing a desktop
app with a server is a separate, unfinished goal (see `GOALS.md`).

## What changes in server mode

Setting `OPSIS_PUBLIC_ORIGIN` turns it on for the Fastify host (`apps/api`). Without it, Opsis
is the usual loopback-only local application.

- **Accounts.** Sign-up is closed (`POST /v1/auth/signup` returns 403, and the sign-in page
  offers only logging in). The operator creates accounts and resets passwords from the shell.
- **Proxy boundary.** Browser requests must arrive over HTTPS for the public origin through a
  trusted proxy. Others get 421. Writes must carry the public origin as `Origin`, or they get 403.
  The session cookie is always `Secure`, and responses carry HSTS, a content security policy,
  `X-Frame-Options: DENY` and cross-origin isolation headers.
- **Web app.** The API serves the built web app (`apps/web/dist`); page routes such as
  `/boards` fall back to its index. Fingerprinted `assets/` are cached for a year.
- **Agents.** Claude, Codex and the other CLIs run as the server's user, with that user's CLI
  logins. The **Executable path** an account saves is ignored. Set paths for the server with
  `OPSIS_CLAUDE_BIN`, `OPSIS_CODEX_BIN`, `OPSIS_KIMI_BIN`, `OPSIS_GROK_BIN` or
  `OPSIS_ANTIGRAVITY_BIN`, or leave them unset to use `PATH`. API keys are per instance, as
  on a local install (Settings → API keys, or `OPSIS_<PROVIDER>_API_KEY`).
- **Shared links.** A board an owner shares with **Anyone with the link** (or makes Public)
  opens read-only for people without an account, through `GET /v1/guest/boards/<id>`. It is
  the only board route that needs no sign-in. It answers 404 for private and archived boards,
  never sends hidden pages unless the request names that page's ID, never sends undo history,
  and shares the board-read rate limit. A board's ID (a random UUID) is what grants access, as
  in Google Docs' link sharing: making the board private again closes the link.
- **MCP agent keys** still work only for agents on the server itself, talking to the API
  directly on loopback. A key sent through the proxy is ignored.

## Configuration

| Variable              | Meaning                                                                                                        |
| --------------------- | -------------------------------------------------------------------------------------------------------------- |
| `OPSIS_PUBLIC_ORIGIN` | Required. The exact address people open, such as `https://opsis.example.com` (HTTPS, no path).                 |
| `OPSIS_DB_PATH`       | The SQLite database. Use a persistent path such as `/var/lib/opsis/opsis.sqlite`.                              |
| `HOST`, `PORT`        | Where the API listens; default `127.0.0.1:8000`. Keep loopback when Nginx runs on the same machine.            |
| `OPSIS_TRUSTED_PROXY` | Which peers may set `X-Forwarded-*` headers; default `loopback`. Use the proxy's address if it runs elsewhere. |
| `OPSIS_WEB_ROOT`      | The built web app; default `apps/web/dist` in the checkout.                                                    |
| `OPSIS_SPEECH`        | `off` disables the server-side narrator voice.                                                                 |

Opsis refuses to start in server mode with an `http://` origin or without a built web app.
A non-loopback `HOST` is accepted only in server mode. If you use one, firewall the port so
only the proxy can reach it.

## Install

On the server, as the user that will run Opsis (and that is signed in to the agent CLIs),
install Node.js 20.19+, pnpm 10.34.5 and Rust via rustup (the build compiles the process
engine to WebAssembly), then:

```sh
git clone https://github.com/Pyp-3/Opsis.git
cd Opsis
pnpm install --frozen-lockfile
pnpm build
```

Create your account before the first start. Without `--password-stdin` a strong password is
generated and printed once:

```sh
pnpm accounts create /var/lib/opsis/opsis.sqlite you@example.com "Your Name"
pnpm accounts list /var/lib/opsis/opsis.sqlite
pnpm accounts reset-password /var/lib/opsis/opsis.sqlite you@example.com
printf '%s\n' 'chosen password' | pnpm accounts create /var/lib/opsis/opsis.sqlite friend@example.com "Friend" --password-stdin
```

Use absolute database paths: these commands run from `apps/api`. They are safe while the
server is running. A password reset signs that account out on every device; its agent keys
are kept. To bring existing boards across, restore a backup of your local database to the
server path (see [backup and restore](PERSISTENCE.md#full-database-backup-and-restore)).

### systemd

```ini
# /etc/systemd/system/opsis.service
[Unit]
Description=Opsis
After=network.target

[Service]
User=opsis
WorkingDirectory=/home/opsis/Opsis
Environment=OPSIS_PUBLIC_ORIGIN=https://opsis.example.com
Environment=OPSIS_DB_PATH=/var/lib/opsis/opsis.sqlite
ExecStart=/usr/bin/pnpm --filter api start
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

The `PATH` that systemd gives the service must include the agent CLIs, or set their
`OPSIS_<AGENT>_BIN` variables. Chat threads keep native CLI sessions under the system
temporary directory. If it is cleared, the next turn starts a new session and says so.

### Nginx

```nginx
server {
    listen 443 ssl;
    http2 on;
    server_name opsis.example.com;
    ssl_certificate     /etc/letsencrypt/live/opsis.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/opsis.example.com/privkey.pem;

    # Attachments and imports are sent with generation requests.
    client_max_body_size 40m;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        # Generation streams progress and can take several minutes.
        proxy_buffering off;
        proxy_read_timeout 600s;
    }
}

server {
    listen 80;
    server_name opsis.example.com;
    return 301 https://$host$request_uri;
}
```

All three `proxy_set_header` lines are required. Without them every browser request is
refused. If the public address has a port, use `Host $http_host` so the port is kept.

## Updating and backups

### Hosting under a path

Build the browser with `OPSIS_BASE_PATH=/opsis/ pnpm --filter web build`. The API still
uses its usual root-relative routes internally; the proxy removes `/opsis/` when forwarding.
Keep `OPSIS_PUBLIC_ORIGIN=https://tools.example.com` without a path. Navigation, API calls,
assets and copied board links use the build's prefix. The default `/` build keeps local and
desktop behavior unchanged.

On a dedicated tools host, use an exact `/opsis` redirect to `/opsis/`, proxy only
`/opsis/` (with buffering off for generation), and return 404 from `location /`.
Rewrite the session cookie path from `/` to `/opsis/`. This limits exposed routes;
DNS and certificate transparency can still reveal the hostname. When Cloudflare proxies
the host, its own `/cdn-cgi/` endpoints can remain available independently of Nginx.

### Frozen-dependency VPS updater

`scripts/server/` contains the Docker recipes and a systemd timer for an operator-managed
deployment. It is deliberately installed separately from the Git checkout: pulling a commit
cannot change the privileged updater. The root-owned `/opt/opsis/config.json` specifies the
approved baseline commit, frozen dependency image tag and immutable image ID, public origin,
Docker network and trusted proxy address. Bootstrap that dependency image once with the
reviewed lockfile and a pinned official Node image digest. Keep all configuration and state
root-only; data belongs to container UID 1000.

Every five minutes the updater fetches `main` and checks the latest matching push run of
`.github/workflows/ci.yml` for that exact SHA. Pending, failed, cancelled, skipped, foreign
repository and other-branch runs cannot deploy. Dependency manifests, lockfiles, package-manager
configuration, workflows and deployment files are frozen against the baseline. A change to
any of them logs "Review required" and leaves the service running. Updating the baseline or
dependency image is a separate manual review, never an automatic package upgrade.

An eligible update downloads the matching CI release, verifies GitHub's SHA-256 digest and
release metadata, checks included source against Git, and fast-forwards to the approved SHA.
It reuses the frozen dependency image and builds the browser with networking disabled. Runtime
containers run as non-root, with a read-only root filesystem, no added capabilities, no host
ports or Docker socket, bounded resources, a private writable data directory and temporary
storage. No GitHub credential is needed for the public repository. CI success is not a code
review or a guarantee against a compromised maintainer account or malicious application code.

The candidate is tested before replacing the service. A database snapshot and previous
container are retained. If startup fails, logs identify the failed commit and automatic
retries of it stop. Database rollback is intentionally manual, because migrations may make
the previous executable incompatible with the changed database. Inspect the logs and backup
before restoring; do not simply point an old image at a migrated database.

```sh
systemctl list-timers opsis-update.timer
journalctl -u opsis-update.service --since today
docker logs --tail 100 opsis-server
systemctl stop opsis-update.timer       # pause deployments
systemctl start opsis-update.service   # check now
```

Container logs rotate at 10 MB × 5 files. systemd captures updater/build failures in the
journal. Retained database snapshots and previous images/containers need operator-managed
retention; they are never deleted incidentally. A failed SHA stays in `state.json` until the
operator investigates and clears its `failed` field. No packages are installed during routine
updates, and no OS package upgrade is part of this workflow.

For natural narration, provision a complete Kokoro cache (the existing
`apps/api/data/models/onnx-community/Kokoro-82M-v1.0-ONNX/` tree) in a private directory
owned by UID 1000, then set `model_dir` in the installed updater configuration to that
directory. Only the live container mounts it at `/models`, read-only, and receives
`OPSIS_SPEECH=on` and `OPSIS_MODEL_DIR=/models`. Candidates keep speech disabled. The
model persists across releases and cannot be silently replaced by the runtime; missing
or incompatible cached files fail with the speech status message. Verify `/v1/speech`
reports `ready` and a short `POST /v1/speech` returns `audio/wav` after deployment.
Server narration uses the same-origin API and avoids browser model/runtime downloads.

Opsis's HTML uses external module scripts. An inline-script CSP warning needs the
blocked script's source to identify its owner (for example, an injected proxy or extension
script); do not enable `unsafe-inline` or allow an unidentified hash to hide the warning.

```sh
git pull && pnpm install --frozen-lockfile && pnpm build && sudo systemctl restart opsis
pnpm database backup /var/lib/opsis/opsis.sqlite /var/backups/opsis-$(date +%F).sqlite
```

Migrations run on start and preserve existing data. Backups include account and session
records, so keep them private. Instance API keys live beside the database in
`opsis.sqlite.provider-keys.json` and are not part of backups.

## Limits

### Restricted server guests and shared CLI logins

Set `OPSIS_GUEST_EMAILS` to comma-separated operator-created account emails to restrict
them to public-board viewing. This is server configuration, not a browser-editable role;
keep it with the database when restoring or moving the service. Configure the restriction
before creating or sharing the guest login. Removing an email grants that account normal
member permissions again. Sign-up remains closed in server mode.

Guests get a separate read-only diagram gallery. They cannot generate, copy, edit, manage
credentials, view private/archived boards, or use editor invitations to bypass the restriction.
Only current public snapshots are returned, without undo history or pages hidden from viewers;
polling removes a board when its owner makes it private or archives it. Like anyone else, a
guest can also open a board shared by link, and a hidden page through that page's own link,
and turn its pages. This cannot erase copies a viewer already saw.
The guest gallery supports pan/zoom, the process player, pages and concept explanations, not
the member editing/chat UI.
This restriction is specific to the Fastify personal server; native/local accounts are unchanged.

`scripts/server/Dockerfile.agents` layers Codex 0.159.0 and Claude Code 2.1.296 over
the existing frozen dependency image. Its separate npm lockfile pins archive integrity;
installation scripts are disabled. The Linux x64 Claude launcher executes the packaged
native binary directly and disables updates. No existing application dependencies change.
Use this recipe only for Linux x64, as on the VPS.

The updater's optional `agent_home` points to private persistent storage mounted at
`/home/node` only for the live container. It contains `.codex/auth.json` and
`.claude/.credentials.json`, not the operator's whole home/configuration/history. Directories
are mode 0700, files 0600, owned by container UID 1000. Logins can refresh there across
container replacements. The optional `guest_emails` array sets `OPSIS_GUEST_EMAILS`.
Never put credentials in Git, build contexts, images or logs. A compromised runtime can
read its mounted credentials; CI and file permissions do not eliminate that risk. All
normal member accounts share the operator's provider usage; guests cannot start provider work.

There is no self-service sign-up, password reset by email or audit log. Rate limits are per
process, and the server is a single SQLite instance. Every unrestricted member account can
use the server's CLI logins and API keys, so give member accounts only to people you would
lend those to. Configure guests explicitly as described above before sharing their login.
