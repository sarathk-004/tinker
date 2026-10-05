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
