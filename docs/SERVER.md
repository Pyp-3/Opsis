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

```sh
git pull && pnpm install --frozen-lockfile && pnpm build && sudo systemctl restart opsis
pnpm database backup /var/lib/opsis/opsis.sqlite /var/backups/opsis-$(date +%F).sqlite
```

Migrations run on start and preserve existing data. Backups include account and session
records, so keep them private. Instance API keys live beside the database in
`opsis.sqlite.provider-keys.json` and are not part of backups.

## Limits

There is no self-service sign-up, password reset by email or audit log. Rate limits are per
process, and the server is a single SQLite instance. Every account can use the server's CLI
logins and API keys, so give accounts only to people you would lend those to.
