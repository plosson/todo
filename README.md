# Todo

Personal **tags-only** todo list: Bun + Hono + SQLite, Google OIDC for humans, Kite-style device OAuth for AgentIO. Installable as a PWA (Safari → Add to Home Screen). MIT.

See [`docs/plans/todo-service-trd.md`](docs/plans/todo-service-trd.md) for locked decisions and architecture.

## Quick start

```bash
bun install
cp .env.example .env   # optional
DEV_AUTH=1 bun run dev
# → http://localhost:8787
```

With `DEV_AUTH=1` (default when Google is unset and not in production), open the PWA and click **Continue as dev**.

## Environment

| Variable | Required | Notes |
|---|---|---|
| `GOOGLE_CLIENT_ID` | for production human sign-in | Google Cloud OAuth web client |
| `GOOGLE_CLIENT_SECRET` | with client id | |
| `BASE_URL` | yes in prod | Public origin, no trailing slash. Redirect URI registered in Google: `{BASE_URL}/api/auth/google/callback` |
| `DEV_AUTH` | for local/e2e | `1` enables `/api/auth/dev` and the PWA “Continue as dev” button |
| `PORT` | no | Default `8787` |
| `DATABASE_PATH` | no | Default `.data/todo.db` |
| `SESSION_SECRET` | no | Auto-generated under `.data/secret` if unset |
| `DATA_DIR` | no | Default `.data` |

## API (Bearer or session cookie)

- `GET/POST /api/todos` — list (`?tag=&status=open|done|all`) / create `{ title, tags?, notes? }`
- `GET/PATCH/DELETE /api/todos/:id`
- `POST /api/todos/:id/check` · `POST /api/todos/:id/uncheck`
- `GET /api/tags` · `DELETE /api/tags/:name`
- Device OAuth: `POST /api/auth/device` → browser `/auth/device` → `POST /api/auth/device/token`
- `GET /api/auth/me` · `GET/DELETE /api/auth/sessions…`
- Google: `GET /api/auth/google/start` → callback
- Dev: `POST /api/auth/dev` when `DEV_AUTH=1`

## Device OAuth (AgentIO)

Same shape as Kite / open-artifact:

1. CLI `POST /api/auth/device` with `{ label }` → `{ deviceCode, userCode, verificationUrl, … }`
2. Human opens `verificationUrl`, signs in (Google or dev), approves the code
3. CLI polls `POST /api/auth/device/token` until `{ state: "approved", token, expiresAt }`
4. Use `Authorization: Bearer <token>` for API calls

## AgentIO plugin

CLI lives in the **agentio** repo (`src/plugins/todo/`), mirroring `kite`. Not shipped in this server repo. Contract:

```
agentio todo profile add --url https://todo.example.com
agentio todo add "Buy milk" --tag errands --json
agentio todo list --tag errands --open --json
agentio todo check tod_…
agentio todo rm tod_… --confirm
```

If the plugin is not yet merged, agents can call the REST API directly with a device-issued bearer token.

## Docker

```bash
docker compose up --build
# set GOOGLE_* and BASE_URL in the environment for production
```

## Tests

```bash
bun test test/           # unit/integration (API + device auth)
bunx playwright install chromium   # once
bun run test:e2e         # Playwright against local server with DEV_AUTH
```

## Non-goals (v1)

No reminders/push, no Android/native, no projects/boards/priorities — tags only. See the TRD.
