# @tinker/server

Fastify API (modular monolith). Contracts live in `../shared` (`@tinker/shared`); the browser imports only that package.

## Local setup
```bash
npm ci                         # repo root, installs all workspaces
cp server/.env.example server/.env
npm run dev:api                # http://127.0.0.1:8787  (GET /health)
npm run dev                    # frontend, http://localhost:5173
```
Configuration is validated at startup (`src/infrastructure/config/config.ts`); an invalid environment exits with a message that names variables but never prints values. `CORS_ORIGINS` (exact origins, no wildcard) is required when `NODE_ENV=production`. Never put server secrets in `VITE_*` variables.

## Checks (repo root)
| Command | What it does |
|---|---|
| `npm run typecheck` | `tsc -b` (frontend) + `tsc` in `shared/` and `server/` |
| `npm test` | Vitest in `shared/` and `server/` |
| `npm run check:boundaries` | import-boundary rules (`--strict` also fails on the legacy `VITE_*` key references that I4/I7 remove) |
| `npm run build` | frontend production build |
| `npm run check` | typecheck + tests + boundaries |

## Database (migrations only until I3)
```bash
docker compose up -d postgres            # local Postgres 17 on 127.0.0.1:54329
npm run db:migrate -w @tinker/server     # node-pg-migrate, reads DATABASE_URL from server/.env
npm run db:migrate:create -w @tinker/server -- add-users   # new migration in server/migrations/
```
No schema exists yet; the first migrations arrive with I3. Supabase is the hosting target (decision S4); the API will use a server-only role.

## Layout
```
src/app.ts                         Fastify factory (request ids, CORS, error envelope, 404)
src/main.ts                        process entry, graceful shutdown
src/infrastructure/{config,http,auth}
src/modules/diagrams/http          /v1/diagrams/:id/commands and /presentation (validate, then 501 until I3)
test/                              API and config tests (app.inject; no network or DB)
```
Protected routes authenticate first. Until the Supabase verifier lands in I3 the default authenticator answers 401 to every `/v1/diagrams/*` request; tests inject their own.
`npm start` runs through `tsx` and is a development convenience; the production build/start path is an I9 task.
