# Later checks

Verifications we consciously postponed. Each has a trigger (when it must be done), a way to verify, and a status.
Add new items here instead of leaving them in chat. Review this file at every milestone gate and before any release; an item
whose trigger has arrived is a blocker, not a note. Never mark an item done without evidence (command output or a user-run result).

| ID | Check | Why it matters | How to verify | Trigger | Status |
|---|---|---|---|---|---|
| LC1 | Supabase **transaction pooler** (port 6543) | Needed if the API ever runs as several instances or serverless; our startup settings (statement/idle timeouts) and transaction-pinned locks may behave differently behind it | Write `check:pooler`: with the 6543 string in `server/.env.supabase.local`, open many connections and run lock + version check + write inside rolled-back transactions; confirm one winner among concurrent writers and that the pool's startup parameters are accepted | Before adding a second API instance or serverless hosting (I9 at the latest) | open |
| LC2 | **Real Supabase key rotation** drill | Local simulation proves our logic, not Supabase's actual rotation flow or timing | On a test project: rotate the JWT signing key in the dashboard; sign in via api-demo before, during and after; confirm no outage and that a revoked key stops working within the cache age (5 min) | Before release (I9) | open |
| LC3 | **GitHub CI first run** | CI has never run; tests start embedded Postgres, whose Linux binary comes from the lockfile | Open a PR (or push to `main`) and read the workflow result; fix Linux-specific issues | When the first PR is opened | open |
| LC4 | Database TLS with **`DATABASE_SSL=verify`** | `no-verify` is encrypted but does not authenticate the server; production forbids it | Download the Supabase CA certificate, set `DATABASE_SSL=verify` + `DATABASE_SSL_CA_FILE`, run `npm run check:supabase` | Before production deploy (I9) | open |
| LC5 | **Latency** (p95 targets from Phase 1) | Each request does a user upsert transaction + membership queries with no caching; targets are 300 ms read/write, 500 ms load | Measure with an explicit workload and region (I9 plan); consider a short token/user cache only if needed (then revisit D09 revocation freshness) | I9 | open |
| LC6 | Vitest message "something prevents 2 Vite servers from exiting" | Probably a lingering handle in the test harness; process still exits and no Postgres or temp dirs are left | Run `npx vitest run --reporter=hanging-process` in `server/` and find the handle | Any time (low priority) | open |
| LC7 | Supabase **backups / PITR** vs RPO ≤ 5 min and RTO ≤ 60 min | The recovery targets are design goals, not guarantees | Check the project's plan capabilities; run a restore drill (I9 plan) | I9 | open |
| LC8 | Gemini model id (`gemini-3.8-flash`) and structured-output settings | Taken from the prototype, never verified against provider docs | Read current Gemini docs; run a live smoke test with a server-side key | I5 | open |
| LC9 | AI request caps (10/min, 2 concurrent) | Only the ordinary 120/min limit exists today | Build with the AI routes; add concurrency tests | I5 | open |
| LC10 | Scope conversation and revision IDs to the authorized diagram | No such routes exist yet | Add authorization tests when conversation/revision routes arrive | I5 / I8 | open |
| LC11 | Workspace/member management API | Roles other than OWNER can only be set in SQL today | Build invite/role routes, then test A13-A15 through them | When sharing is required | open |
| LC12 | Hosting compatibility (Cloudflare frontend, Railway API) | Only a direction, never exercised | Deploy a preview; verify CORS, env, health, TLS | I9 | open |
| LC13 | Revisions for presentation saves, rename, delete | Today only structural commands create revisions (decision recorded); restore semantics may need more | Decide with I8 restore design | I8 | open |

## Done (kept for the record)
| ID | Check | Evidence |
|---|---|---|
| LD1 | Real Supabase login and persistence | User signed in with a real Supabase user via api-demo; changes appeared in the Supabase tables (2026-10-05, user-run) |
| LD2 | Key rotation, revocation and provider-outage **logic**, simulated locally | `server/test/key-rotation.test.ts` (14 tests, fake clock + fake key server + real local HTTP); each guarded behaviour confirmed to fail when deliberately broken. Real Supabase rotation is LC2 |
| LD3 | Schema and RLS on a real Supabase project; TLS database connection | `npm run check:supabase` (all PASS) and connector-run advisor results (2026-10-05) |
