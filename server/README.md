# @tinker/server

Fastify API (modular monolith). Contracts live in `../shared` (`@tinker/shared`); the browser imports only that package.

## Local setup (no Docker needed)
```bash
npm ci                                   # repo root, installs all workspaces
cp server/.env.example server/.env       # AUTH_MODE=dev gives a local login without Supabase
npm run dev:db  -w @tinker/server        # terminal 1: real Postgres on 127.0.0.1:54329 (data in server/.data/)
npm run db:migrate -w @tinker/server     # once, and after pulling new migrations
npm run dev:api                          # terminal 2: API on http://127.0.0.1:8787 (GET /health, /health/ready)
npm run dev                              # terminal 3: frontend on http://localhost:5173
```
Open http://localhost:5173/api-demo.html (saved diagrams) or /engine-demo.html (pure engine). Both are development-only pages.
Configuration is validated at startup (`src/infrastructure/config/config.ts`); an invalid environment exits with a message that names variables but never prints values.
Production needs `DATABASE_URL`, `SUPABASE_URL` and `CORS_ORIGINS` (exact origins, no wildcard) and rejects `AUTH_MODE=dev`. Never put server secrets in `VITE_*` variables.

## Using the real Supabase project
The project URL is in `server/.env.supabase.local` (gitignored). The schema is already applied there. To run the API against it:
1. In Supabase: Connect > Session pooler, copy the Postgres connection string and put it in `server/.env.supabase.local` as `DATABASE_URL=...` (plus `DATABASE_SSL=no-verify` for local development). Never paste it into chat or commit it.
2. `npm run check:supabase -w @tinker/server` checks the key set, forged-token rejection, TLS connection and RLS. Optional: `SUPABASE_ACCESS_TOKEN=<a real user JWT>` in the same file verifies a live token.
3. Stop the dev-mode API, then `npm run dev:api:supabase`.
4. Open http://localhost:5173/api-demo.html, use "1b. Sign in with Supabase" with the publishable key and a user created in Supabase (Authentication > Users). The API verifies that real token against Supabase's published keys.

## Typed commands and Gemini (I5)
Plain typed commands ("put Redis between Orders and PostgreSQL") are understood by a deterministic parser and need no key. Free-form requests go to Gemini through the server only.
1. Put `GEMINI_API_KEY=...` in `server/.env` (or `server/.env.supabase.local`). Never in a `VITE_*` variable, never in chat. Optional: `GEMINI_MODEL` (default `gemini-3.5-flash-lite`), `GEMINI_THINKING_LEVEL` (default `low`), `AI_DEADLINE_MS` (15000), `AI_RATE_LIMIT_PER_MINUTE` (10), `AI_MAX_CONCURRENT` (2).
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
