# Development status

Updated: 2026-10-05
Active milestone: I1 implemented on branch `implementation-1` (awaiting push/CI) -> next I2 — Diagram domain engine.
Repository: github.com/sarathk-004/tinker. I0 findings: repo-map.md, decisions.md. Graphify index `graphify-out/` is gitignored and was built at 6e0130d (pre-I1; stale for `shared/` and `server/`).

## I1 completion record (verified 2026-10-05)
| Task | Paths | Verification |
|---|---|---|
| Workspaces, frontend preserved | `package.json` (workspaces shared, server; root deps `@tinker/shared`), `shared/`, `server/`, `src/contracts/index.ts` | `npm run build` PASS (frontend untouched apart from the contracts re-export); `npx vite` serves `/` and `/src/contracts/index.ts` (200) |
| Validated config, health, request IDs, error envelope | `server/src/{app,main}.ts`, `server/src/infrastructure/{config,http,auth}/*` | `npm test -w @tinker/server`: 16 PASS (config rules, request-id echo/regeneration, 404/400/401/413/501 envelopes, CORS allow/deny, no value echo). Live run: `GET /health` 200 with `x-request-id`; unauthenticated command 401 envelope; `NODE_ENV=production` without `CORS_ORIGINS` exits 1 |
| Graph/presentation/command schemas, NodeKind, errors, limits, DTOs | `shared/src/*` | `npm test -w @tinker/shared`: 17 PASS (integrity, limits, 9 command types valid / 14 malformed rejected, finite coords, error-code/status/retry tables) |
| Boundary checks + CI | `scripts/check-boundaries.mjs`, `.github/workflows/ci.yml` | boundary script PASS and verified to FAIL on injected violations (src->server, node:fs in src, react in shared, src from server); `--strict` fails on legacy VITE_* refs. CI workflow NOT yet run on GitHub. |
| DB migrations/run scripts + docs | `server/migrations/`, `docker-compose.yml`, `server/README.md`, `server/.env.example` | NOT verified: Docker daemon not running here, no local Postgres. `node-pg-migrate` CLI loads (0.1.0 banner) but `db:migrate` was never run against a database. I1 checkbox left unchecked for this item. |
Totals: `npm run typecheck` PASS, `npm test` 33 PASS, `npm run check:boundaries` PASS (with legacy warnings), `npm run build` PASS.

Gate: frontend and API start locally (verified); malformed command input is rejected consistently (verified via app tests with an injected authenticator; production default is 401 for all protected routes until I3); browser imports contract schemas only through `src/contracts` (boundary-checked).

## Limitations / risks
- Command execution, auth, idempotency and persistence are stubs (501/401) by design; no DB schema yet.
- Migration tooling unverified against a live Postgres (blocker for claiming that checkbox).
- `server` `start` uses tsx (dev convenience); production build/start is I9.
- Legacy browser Gemini key paths remain until I4/I7 (boundary script warns).
- Zod 4 / Fastify 5 / Vitest 5 versions were taken from the npm registry at install time, not compared with other candidates.

## Next action (I2)
Implement the framework-independent diagram engine in `server/src/modules/diagrams/domain` (ADD/REMOVE/RENAME/UPDATE/CONNECT/DISCONNECT/INSERT_BETWEEN/RESET) against `@tinker/shared` types, with injected ID generation, immutability and atomicity tests, decisions P1/P2/D06, and the downstream-traversal analyzer. Gate: Orders -> PostgreSQL becomes Orders -> Redis -> PostgreSQL with one valid operation; invalid operations leave the input unchanged.
Before I3: Supabase project URL/keys, working Postgres (Docker Desktop daemon or Supabase) to verify migrations. Later: D08 (I7), D11-D12 (I8).

## Handoff template
- Active task / milestone:
- Completed behavior:
- Changed files / commit:
- Commands run and outcomes:
- Decisions accepted or changed:
- Blockers / verification not run:
- Next concrete task:
