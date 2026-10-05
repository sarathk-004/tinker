# Development status

Updated: 2026-10-05
Active milestone: I3 complete and pushed (branch `implementation-3`) (stacked: main <- implementation-1 <- implementation-2 <- implementation-3). implementation-1 and implementation-2 are pushed; implementation-3 is committed locally only, nothing pushed. Next: I4 (durable manual editor).

## See it locally (three terminals)
1. `npm run dev:db -w @tinker/server` (Postgres), once: `npm run db:migrate -w @tinker/server`
2. `npm run dev:api` (needs `server/.env`: copy `server/.env.example`)
3. `npm run dev`, then open http://localhost:5173/api-demo.html (I3), http://localhost:5173/engine-demo.html (I2). The main editor at `/` is unchanged until I4.

## I3 completion record (verified 2026-10-05)
| Area | Paths | Verification |
|---|---|---|
| Schema, indexes, RLS | `server/migrations/1760000000000_initial-schema.sql` | up -> down -> up on Postgres 18.4 (also in `database-policy.test.ts` on a scratch DB); RLS on all 10 tables; non-owner role sees 0 rows and cannot insert |
| Token verification, user + personal workspace provisioning | `infrastructure/auth/{verifier,authenticator}.ts`, `modules/identity/users.ts` | `identity.test.ts`: valid, expired, wrong audience/issuer/key, tampered, `alg:none`, HS256, missing sub all 401; JWKS outage 503; 12 concurrent first requests create exactly 1 user/workspace/membership |
| Authorization (404 vs 403, role table) | `modules/workspaces/access.ts` | A13 (cross-workspace uniform 404 on every route), A14 (viewer 403 on all writes), editor cannot delete, A15 (revoked membership: no replay), mid-flight revocation aborts and releases the key |
| Create/list/load/rename/soft-delete, commands, presentation | `modules/diagrams/{http,application,persistence}` | `diagrams-api.test.ts` lifecycle tests incl. the gate scenario through HTTP |
| Idempotency, leases, replay | `infrastructure/idempotency/mutation-requests.ts` | A07 (10 simultaneous duplicates: one mutation), A08, A09 (changed body/version/path/method), A10 (replay after later edits does not regress), failure replay, create idempotency, 7-day expiry -> 410, crashed-holder takeover, live lease blocks, A12 fencing (late holder cannot commit) |
| Conditional update + revision + execution + response in one transaction | `diagram-service.ts` | A11: injected failures after the revision and before response storage roll everything back and release the key |
| Concurrency | same | A06: 2 and 10 simultaneous writers at one version: exactly one wins; stale/future versions never apply |
| Durability | | A05: API and pool replaced, identical document; also live (below) |
| Rate limits, request bounds | `infrastructure/http/rate-limiter.ts`, `app.ts` | unit + HTTP 429 with Retry-After; 1 MiB body cap |
Commands: `npm run typecheck` PASS; `npm test` 130 PASS (shared 17, server 113); `npm run check:boundaries` PASS; `npm run build` PASS (dist holds only the production app).
Live check on localhost (built-in browser against the running API and dev Postgres): signed in, created a diagram, added Orders and PostgreSQL, connected, inserted Redis (lands beside the stacked nodes at (300,115)), simulated a drag (v6), retried an edit (returned the original result with Idempotent-Replayed, server unchanged), stale edit refused with 409, reload after an API restart and re-login returned the same diagram at the same version. The live run found two bugs that unit tests missed (CORS did not expose `Idempotent-Replayed`; insert-between placed nodes far below) and both are fixed with tests.
Gate: acknowledged state survives API restart (tested and live); an exact retry returns its original result; two writes from the same version give one success and one conflict; cross-workspace access is denied.

## Deferred checks
See docs/later-checks.md (transaction pooler, real key-rotation drill, CI first run, TLS verify, latency, and more). Key rotation LOGIC was verified locally on 2026-10-05: new key adopted after the 10 s retry gap, a revoked key stops verifying within the 5-minute cache age, provider outages keep known keys working for up to 1 hour then fail with 503, unknown-key floods cause at most one fetch per 10-30 s. This replaced jose's built-in remote key cache, which turned a key-endpoint HTTP 500 into 401 and had no stale fallback.

## Supabase verification (project rnwbgjrzbliqvqradjcm)
Verified: JWKS reachable (one ES256 key; asymmetric only, which my verifier supports); forged token with the correct issuer and audience but a foreign key is rejected 401; garbage token rejected 401 (`npm run check:supabase -w @tinker/server`). Schema applied via the Supabase connector: 10 tables, RLS on all, `anon` and `authenticated` hold no privileges, advisors show only 10 INFO "RLS enabled, no policy" notes (intended). My SQL (user upsert, personal workspace, reservation, `FOR UPDATE`, conditional update, revision) ran on Supabase Postgres 17 as the `postgres` role (owner, bypasses RLS) inside a rolled-back transaction; no data left behind.
User-verified (2026-10-05): signed in with a real Supabase user through api-demo against the API in `dev:api:supabase` mode; diagram changes appeared in the Supabase tables. This covers items (1) and (2) below; I did not observe it myself (no credentials), so real-token claim shapes are confirmed only by that result. Still open: (3) pooler mode and key rotation.
Previously unverified, now resolved by the user's test except (3): (1) a real Supabase user token (confirms the `iss`/`aud`/claim shapes of real tokens), (2) the API's own connection to Supabase Postgres over TLS and the full API flow on it (needs the DB password in `server/.env.supabase.local`), (3) session pooler vs transaction pooler behaviour. Steps are in the README ("Using the real Supabase project").

## Limitations / risks (read these)
- Supabase items above that are still unverified; key rotation behaviour untested.
- CI (`.github/workflows/ci.yml`) has not run on GitHub; tests now start embedded Postgres (Linux binary package should install via the lockfile, unverified there).
- No workspace/member management routes; roles other than OWNER are only reachable through SQL today. Diagram list capped at 200, no pagination.
- No per-request token/user caching: each request does a user upsert transaction plus membership queries. p95 targets are unmeasured (I9).
- Dev login is unauthenticated by design and only exists with `AUTH_MODE=dev` + `NODE_ENV=development`; the dev signing key rotates on every API restart.
- Vitest prints "something prevents 2 Vite servers from exiting" at the end of the server suite (process still exits and no postgres/temp dirs are left); cause not investigated.
- Presentation saves, renames and deletes create no revision (decision recorded); history/restore behaviour for them is an I8 question.

## Next action (I4)
Durable manual editor: login (Supabase in production, dev login locally), workspace/diagram loading, React Flow mapping of canonical graph + presentation, every structural UI action through a command client with stable idempotency keys, per-diagram write serialization, conflict/draft recovery, saved/failed status, remove direct browser Gemini calls from the migrated path. Needs from the user: Supabase project (URL, anon key for the browser auth client) when real login is wanted; otherwise I4 can use the dev login.

## Handoff template
- Active task / milestone:
- Completed behavior:
- Changed files / commit:
- Commands run and outcomes:
- Decisions accepted or changed:
- Blockers / verification not run:
- Next concrete task:
