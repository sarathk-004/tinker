# @tinker/server

Fastify API (modular monolith). Contracts live in `../shared` (`@tinker/shared`); the browser imports only that package.

## Settings: ONE `.env` file
All settings live in a single git-ignored file at the repository root: `.env` (copy `.env.example`). The web app (Vite) reads only its `VITE_*` lines; the API and every script read the rest (`--env-file=../.env`). Never put a secret on a `VITE_*` line.

## Run it
Two ways, same code:
- **Against your Supabase project (real sign-in with email verification)**: the `.env` holds `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_URL` (optional: falls back to the VITE one), `DATABASE_URL` (the Supabase Postgres string), `DATABASE_SSL=verify` and `DATABASE_SSL_CA_FILE` (the certificate in `server/certs/`).
  ```bash
  npm ci                               # once
  npm run dev:api                      # API on :8787 (reads .env)
  npm run dev                          # web app on :5173
  npm run worker -w @tinker/server     # optional background worker
  ```
- **Fully local, no Supabase (developer login, throw-away database)**:
  ```bash
  npm run dev:db -w @tinker/server           # terminal 1: real Postgres on :54329 (data in server/.data/)
  npm run db:migrate:local -w @tinker/server  # once, and after pulling migrations
  npm run dev:api:local                       # terminal 2: API with the "Developer login" (ignores the DATABASE_URL in .env)
  npm run dev                                 # terminal 3
  ```
`npm run db:migrate -w @tinker/server` applies migrations to the database in `.env` (your Supabase project); use `db:migrate:local` for the local one.
Configuration is validated at startup (`src/infrastructure/config/config.ts`); an invalid environment exits with a message that names variables but never prints values.
Production needs `DATABASE_URL`, `SUPABASE_URL`, `CORS_ORIGINS` (exact origins, no wildcard) and and, only if you ever turn on `AI_KEY_MODE=user`, `KEY_ENCRYPTION_SECRET`, and rejects `AUTH_MODE=dev`.

## Checking the Supabase wiring
`npm run check:supabase -w @tinker/server` checks the key set, forged-token rejection, TLS connection (verified with the certificate) and RLS. Optional: `SUPABASE_ACCESS_TOKEN=<a real user JWT>` in `.env` verifies a live token.

## Typed commands and Gemini (I5)
Plain typed commands ("put Redis between Orders and PostgreSQL") are understood by a deterministic parser and need no key. Free-form requests go to Gemini through the server only.
1. Put `GEMINI_API_KEY=...` in `.env`. Never in a `VITE_*` variable, never in chat. Optional: `GEMINI_MODEL` (default `gemini-3.5-flash-lite`), `GEMINI_THINKING_LEVEL` (default `low`), `AI_DEADLINE_MS` (15000), `AI_RATE_LIMIT_PER_MINUTE` (10), `AI_MAX_CONCURRENT` (2).
2. `npm run check:gemini` makes a few real calls (no database, no diagrams) and prints PASS/FAIL lines. Share those lines if something fails; they contain no key.
3. Restart the API. `/v1/me` then reports `features.aiModel: true`.
Without a key the API still serves typed parser commands and everything manual.

## Checks (repo root)
| Command | What it does |
|---|---|
| `npm run typecheck` | `tsc -b` (frontend) + `tsc` in `shared/` and `server/` |
| `npm test` | Vitest in `shared/` and `server/` |
| `npm run check:boundaries` | import-boundary rules (`--strict` also fails on the legacy `VITE_*` key references that I4/I7 remove) |
| `npm run build` | frontend production build |
| `npm run check` | typecheck + tests + boundaries |

## Database
`npm run db:migrate -w @tinker/server` applies `server/migrations/*.sql` (node-pg-migrate, `-- Up/Down Migration` markers); `db:migrate:down` reverts the last one; `db:migrate:create -- <name>` scaffolds a new file.
Row level security is on for every table with no policies: only the owning server role can read or write, even if a Supabase role is granted access by mistake.
`docker-compose.yml` remains as an alternative Postgres if you prefer Docker. Supabase is the hosting target (decision S4) and has not been exercised yet.
Tests (`npm test -w @tinker/server`) start their own throwaway Postgres on a random port; they never touch the dev database.

## Layout
```
src/app.ts                                   Fastify factory (request ids, CORS, error envelope, health, route wiring)
src/main.ts                                  process entry: config, pool, verifier, graceful shutdown
src/infrastructure/{config,http,auth,database,idempotency}
src/modules/identity                         user + personal workspace provisioning, dev login
src/modules/workspaces/access.ts             roles and authorization (404 vs 403)
src/modules/diagrams/domain                  pure engine (no I/O)
src/modules/diagrams/{application,persistence,http}   service, SQL, routes
migrations/                                  versioned SQL
test/                                        unit + integration tests (real Postgres)
```
Every protected route runs: authenticate -> rate limit -> request shape -> authorize -> idempotency reservation -> version/domain checks -> atomic commit.
`npm start` runs through `tsx` and is a development convenience; the production build/start path is an I9 task.
