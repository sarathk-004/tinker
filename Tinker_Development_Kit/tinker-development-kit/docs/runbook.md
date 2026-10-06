# Runbook: run it, check it, ship it, recover it

Written in I9 against the real repository (2026-10-06). Every command below was run; where something could not be run here it says so.
No secret appears in this file: values are placeholders, real ones live in `server/.env` (git-ignored) or the host's secret store.

## 1. Run it on your machine (fresh setup)

Needs Node 24 and npm. No Docker is required (a local Postgres is started from an npm package).

```bash
npm ci                                   # install (root + shared + server workspaces)
npm run dev:db -w @tinker/server         # terminal 1: local Postgres on :54329 (data in server/.data)
npm run db:migrate -w @tinker/server     # once, and after pulling new migrations
npm run dev:api                          # terminal 2: API on :8787 with local "Developer login"
npm run dev                              # terminal 3: web app on http://localhost:5173
npm run worker -w @tinker/server         # optional terminal 4: background cleanup worker
```

- Everything works without any key. Plain commands ("add Orders", "put Redis between A and B"), manual editing, history, undo and advice
  (computed from the graph) need no model. For free-form AI, voice and spoken replies put `GEMINI_API_KEY=...` in `server/.env`.
- Use your own Supabase project instead of the local login: `server/.env.supabase.local` (see `server/.env.example`) and
  `npm run dev:api:supabase`; the browser needs `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in the root `.env`.
- A production-shaped preview with containers: `docker compose -f docker-compose.preview.yml up --build`, then `npm run build && npm run preview`.

## 2. Checks (what "good" looks like)

| Command | Proves | Needs |
|---|---|---|
| `npm run check` | types, all unit and API tests (real Postgres), contract boundaries | nothing |
| `npm run build && npm run check:artifacts` | the built web app has no secrets (A30): key shapes, server-only setting names, and the REAL secret values from your local env files | nothing |
| `npm run smoke:api -w @tinker/server` | the critical path against a running API (A31): sign-in, create, typed commands, reopen, retry, conflict, advice, restore, isolation, voice origin, delete | API running with dev login |
| `npm run check:production -w @tinker/server` | the API refuses bad production configuration and behaves as a deployed instance (no dev routes, strict CORS, forged tokens refused, voice origin) | local database |
| `npm run bench:api -w @tinker/server` | latency percentiles for a stated workload, with misses reported | API running with dev login |
| `npm run backup:drill -w @tinker/server` | backup, restore into a fresh database, verification, measured time (A32) | `DATABASE_URL` |
| `npm run check:supabase -w @tinker/server` | live JWKS, forged tokens, TLS, row level security, migration recorded | `.env.supabase.local` |
| `npm run check:gemini` / `check:voice` / `check:voice:api` | the real model, voice and spoken replies | `GEMINI_API_KEY` |

## 3. Configuration inventory

Server (all optional unless marked; defaults in `server/src/infrastructure/config/config.ts`; invalid values stop the start and name the variable, never the value).

| Variable | Default | Notes |
|---|---|---|
| `NODE_ENV` | development | `production` makes the three below required |
| `DATABASE_URL` | - | required to start. Server-only role. Never in the browser |
| `SUPABASE_URL` | - | required in production (token issuer and keys) |
| `CORS_ORIGINS` | localhost:5173 | required in production; exact origins, comma separated, no wildcard. Also guards the voice WebSocket |
| `DATABASE_SSL` | off | `verify` (+ `DATABASE_SSL_CA_FILE`) in production; `no-verify` is refused in production (LC4) |
| `AUTH_MODE` | supabase | `dev` only with `NODE_ENV=development` |
| `JWT_AUDIENCE` | authenticated | |
| `RATE_LIMIT_PER_MINUTE` | 120 | per user, in memory (single instance) |
| `GEMINI_API_KEY` | - | enables free-form AI, voice and spoken replies. Server only |
| `GEMINI_MODEL`, `GEMINI_THINKING_LEVEL`, `GEMINI_LIVE_MODEL`, `GEMINI_TTS_MODEL`, `GEMINI_TTS_VOICE` | see `.env.example` | measured defaults |
| `AI_DEADLINE_MS`, `AI_RATE_LIMIT_PER_MINUTE`, `AI_MAX_CONCURRENT` | 15000, 10, 2 | model requests only; plain commands cost no quota |
| `VOICE_MAX_SESSIONS`, `VOICE_MAX_SESSION_MS` | 20, 600000 | |
| `WORKER_POLL_MS`, `WORKER_LEASE_SECONDS` | 5000, 60 | the worker process |
| `HOST`, `PORT`, `LOG_LEVEL` | 127.0.0.1, 8787, info | containers set `HOST=0.0.0.0`; hosts usually inject `PORT` |

Browser (public by design; ship in the bundle): `VITE_API_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, optional `VITE_ENABLE_DEV_LOGIN`.
Anything else starting with `VITE_` makes `npm run check:artifacts` fail.

## 4. Release and rollout order

Schema changes are always additive and deployed BEFORE the code that needs them, so old and new code can run against the same database:

1. `git` tag the commit. CI (`.github/workflows/ci.yml`) must be green: typecheck, tests, boundaries, build, artifact scan, container build.
2. **Migrate**: run `npm run db:migrate -w @tinker/server` (or the connector) against the target database. A migration must be applicable while the old API is still running (add tables/columns; never rename or drop in the same release as the code change).
3. **API** (rolling): deploy the image; the platform health check is `GET /health`; readiness (database reachable) is `GET /health/ready`.
4. **Worker**: deploy the same image with command `npx tsx server/src/worker.ts`. Jobs are leased and idempotent, so old and new workers may overlap.
5. **Frontend**: deploy the static build last (it only calls routes that already exist).
6. Run `npm run smoke:api` equivalents against the deployed URL (see section 7) before announcing.
Rollback: redeploy the previous API image and frontend. Migrations are not rolled back (they are additive); data written by a newer version stays valid for the older one.

## 5. Diagnostics

- Every API call writes one structured line `{"msg":"request","route":"/v1/diagrams/:diagramId/commands","status":409,"ms":23,"code":"DIAGRAM_VERSION_CONFLICT","reqId":"..."}`; no bodies, tokens, prompts, ids or user text. The worker writes `job claimed / completed / fenced / will retry / dead-lettered` (with `tookOver` when it replaced a stalled worker). AI calls write `ai provider attempt` with milliseconds and outcome.
- Summarize any log file: `npm run dev:api 2>&1 | tee api.log` then `npm run log:report -w @tinker/server -- api.log` (latency p50/p95/p99 per route, conflicts, error codes, AI failures, job leases, voice sessions).
- A user reports "my change did not save": the browser shows Saved / Saving / Not saved / Conflict. A lost response is reconciled by the original request key (replay). A conflict keeps the draft and offers reload or re-apply.
- Jobs stuck? `SELECT type, status, attempt_count, last_error_kind, last_error FROM jobs WHERE status IN ('RUNNING','DEAD_LETTER')`. A RUNNING row with an expired `lease_expires_at` is taken over by the next worker automatically; a DEAD_LETTER row has used all 3 attempts and needs a human to read `last_error`.
- If AI times out nothing was changed (the commit is bound to the version the model saw).

## 6. Recovery

- **What the database provider gives you** (checked 2026-10-06, see `costs-and-limits.md`): the project is on the Supabase **Free** plan: no daily backups and no point-in-time recovery. Daily backups start at Pro (7 days); PITR is a paid add-on on Pro or higher (documented granularity: worst case 2 minutes; needs at least the Small compute add-on). The design targets RPO <= 5 min and RTO <= 60 min are therefore **not met on Free**; they are plausible on Pro with PITR, but a provider restore has not been drilled (it cannot be on Free).
- **What we can do ourselves, and have drilled**: `npm run backup:drill` takes a consistent read-only snapshot, restores it into a fresh database, and compares every table by checksum. Measured 2026-10-06: local database 21,675 rows (31 MB): export 2.9 s + restore 4.2 s = 7.1 s; Supabase project (62 rows): 1.8 s. The RPO of such a backup is simply its age: schedule it (hourly gives RPO <= 1 h) and keep copies outside the database provider.
- **Restore into production** (provider-independent): create an empty database, point `RESTORE_URL` at it, `npm run backup:restore -w @tinker/server -- <backup-dir>` (it applies the migrations, refuses a non-empty target, verifies checksums), then switch `DATABASE_URL`. Restore never mixes data into a non-empty database.
- **Soft-deleted diagrams** stay in the database for 30 days and are then purged by the worker. There is no recovery screen yet (LC35); until then recovery is an owner-authorized database operation.
- **Expired leases / jobs**: recovered by fenced leases (a stale worker cannot overwrite the new holder). Never replay by hand.

## 7. Deployment (direction: Cloudflare Pages + Railway + Supabase)

Nothing has been deployed from this repository yet; the files below are prepared and verified locally, not on a host (LC12).

- **Supabase** (Authentication > URL configuration): set Site URL to the web app's origin and add every origin you use (for example `https://app.example.com` and `http://localhost:5173`) to Redirect URLs, otherwise Google, password-reset and confirmation links are refused. (Authentication > Providers > Google): see section 8. (Authentication > Password security): turn on leaked-password protection (LC37).
- **API + worker on Railway** (two services from the same repo): both build the root `Dockerfile` (`railway.json` is the API service; for the worker service override the start command to `npx tsx server/src/worker.ts` and disable the health check). Variables for both: `NODE_ENV=production`, `DATABASE_URL`, `DATABASE_SSL=verify` + the provider CA (LC4), `SUPABASE_URL`, `CORS_ORIGINS=<web origin>`; the API also `GEMINI_API_KEY`. Railway terminates TLS and supports WebSockets; the voice session limit is 10 minutes, below typical idle/lifetime limits. A single API instance only (rate limits and voice sessions are in memory: LC9, LC32).
- **Web on Cloudflare Pages**: build command `npm run build`, output `dist`, variables `VITE_API_URL=https://<api host>`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`. `public/_redirects` gives single-page routing; `public/_headers` sets security headers (a Content-Security-Policy is deliberately not preset because it must name your API and Supabase origins; add one after the first deploy: `default-src 'self'; connect-src 'self' https://<api> wss://<api> https://<project>.supabase.co; img-src 'self' data:; style-src 'self' 'unsafe-inline'`).
- **After deploying**: run the smoke checks against the real URLs (section 2; `API_URL=https://<api> npm run smoke:api` needs a dev-login build, so in production use a real sign-in and the manual list: sign in, create, add, reload, second tab conflict, restore, voice), check `GET /health/ready`, and read the first hour of `log:report`.

## 8. Google sign-in (what you do, what the app does)

The app has the "Continue with Google" button, the return handling, password reset and the session-expired message. Google itself must be set up once:
1. Google Cloud console > APIs & Services > Credentials > Create OAuth client ID > Web application. Authorized redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback` (shown in Supabase under the Google provider).
2. Supabase > Authentication > Providers > Google: enable, paste the client ID and secret (they stay in Supabase, never in this repository or the browser).
3. Supabase > Authentication > URL configuration: Site URL and the Redirect URLs from section 7.
Until step 2 is done the button shows Supabase's message ("provider is not enabled") and nothing else changes.
