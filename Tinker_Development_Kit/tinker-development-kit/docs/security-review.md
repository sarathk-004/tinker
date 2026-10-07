# Security and concurrency review (2026-10-07, branch implementation-9)

Scope: a read-through of the API (auth, authorization, idempotency, commands, AI, voice, jobs, database pool, config), the migrations,
the web app's risky spots, the git history for secrets, and `npm audit`. It was a static review: nothing was attacked live, the local
test database was off, and the Supabase and Vercel dashboards were not inspected.

Ratings: HIGH = fix before real users. MEDIUM = fix soon, or accept knowingly. LOW = note it.

## What is solid (checked, no action)
- Authorization runs on every request and again inside the commit transaction; non-members get a uniform 404 (no tenant disclosure).
- Token checks pin the algorithm, issuer, audience and expiry; the key cache handles rotation, outages and unknown-key floods (30 s cooldown).
- All SQL is parameterized; request bodies are schema-validated and size-capped (1 MB); error answers never echo submitted values.
- Edits are race-safe: the diagram row lock, a conditional `version = expected` update, and the idempotency lease with a fencing token mean a
  late or duplicate request can never commit twice. Job claims use `SKIP LOCKED` plus lease tokens. Reservation, diagram and job locks do not form cycles in the normal paths.
- AI output is untrusted: it must pass a strict schema, uses aliases instead of ids, and is dry-run before commit. Prompt-injection blast radius is "edit the caller's own diagram".
- Row-level security is on for every table and `anon`/`authenticated` have no grants, so Supabase's public API cannot read your data.
- `npm audit` (production dependencies): 0 vulnerabilities. Git history: no real keys (only fake test strings); `.env` is ignored and only `.env.example` is tracked.
- The web build ships only `index.html`; the two dev demo pages (which use `innerHTML`) are not in `dist`. `dangerouslySetInnerHTML` is used only for bundled AWS icons.

## Status of the findings (updated 2026-10-07)
- H1 fixed: 20 model requests and 10 voice sessions per person per UTC day, plus a service-wide ceiling (1000 and 100); counted in Postgres (`usage_daily`, migration 1763000000000). Needs the migration applied to Supabase and, outside the code: Turnstile on sign-up (LC39) and a Google spend cap.
- H2 fixed: dropped idle connections are logged, process-level handlers exit gracefully, shutdown is bounded to 10 s.
- M5 fixed (purge lock order and `lock_timeout`), M6 fixed (`no-store`, `nosniff`), L1 fixed (warning), L5 fixed (`textContent`).
- M1 is unchanged by design: keep Supabase "Confirm email" ON (the production checklist item).
- M2, M3, M4, L2, L3, L4 remain open and are accepted for now.

## Findings

### HIGH
**H1. Nothing caps AI spend per person or overall (operator key).** Limits are per minute only (10 AI/min, 2 at once). One account can use about 14,000 AI calls a day,
`/ai/speak` (text to speech) has no AI rate limit at all (only the general 120/min and the 2-at-once cap), voice sessions cost per minute, and sign-up is open to any address.
Many free accounts multiply it. Fix: daily per-person quotas (commands, questions, speech, voice minutes), a global daily budget breaker that turns model features off
until reset, Turnstile on sign-up (LC39), and a Google spend cap and budget alert.

**H2. A database connection hiccup can crash the API.** `pg.Pool` emits `error` for idle connections the server drops (Supabase's pooler does this on restarts and failovers);
with no listener Node treats it as uncaught and exits. There is also no `unhandledRejection` handler, and shutdown has no timeout (a stuck request or open voice socket can block it forever).
Fix: `pool.on('error', log)`, process-level handlers, and a shutdown deadline.

### MEDIUM
**M1. The "email verified" check can be faked by the user.** The API trusts `user_metadata.email_verified`, which a signed-in user can edit themselves through Supabase. The real gate is Supabase's
"Confirm email" setting (no session until confirmed), so this is a safety net that does not hold if that setting is ever switched off. Fix: keep the Supabase setting on and add it to the production checklist and a
`check:supabase` assertion; do not describe the API check as a second lock.

**M2. No limits on stored data.** No cap on diagrams per workspace (the list shows only 200, the rest become invisible but still stored), on conversation messages, on revisions between prune runs (the prune job keeps them for a window), or on idempotency rows
(each stores a full response). One account can fill the free database. Fix: per-person caps (for example 100 diagrams, a message cap per conversation) and a storage alert.

**M3. Rate limiting happens after the database work.** A request is authenticated (signature check plus a user lookup in the database) before the limiter runs, so an over-limit client still costs a database read each time, and invalid-token floods cost CPU. There is no per-IP limit. Fix: an IP limiter in front (host or Fastify), and
count the request before the lookup where the token's subject is already known.

**M4. Limits live in one process's memory** (rate limiter, AI concurrency, voice session count). Fine for one instance (documented as D10), but overlapping deploys or a second instance double the allowance and restarts reset it. Fix before scaling: shared counters (Postgres or Redis).

**M5. Lock-order inversion between purge and commands (theoretical deadlock).** Commands lock the idempotency row, then the diagram row. The purge job locks the diagram row, then deletes its idempotency rows. Only reachable if a request arrives for a diagram deleted 30+ days ago at the moment it is purged; Postgres would abort one side (error 40P01), costing a failed request or a job retry.
Fix: have the purge take the same order, or skip locked rows with a short `lock_timeout`.

**M6. API answers carry no cache or sniffing headers.** JSON with personal data has no `Cache-Control: no-store` or `X-Content-Type-Options`; a shared cache could keep it. Fix: set both on every `/v1` response.

### LOW
- **L1. `NODE_ENV` defaults to `development`.** If a deploy forgets it, the unauthenticated `/dev` engine preview routes are mounted and production-only checks relax. The Dockerfile sets production, so this only bites hand-run deploys. Fix: log a loud warning (or refuse) when a hosted `SUPABASE_URL` is set without `NODE_ENV=production`.
- **L2. The Supabase session lives in `localStorage`** (supabase-js default), readable by any script that runs on the page. The CSP (`script-src 'self'`) is the defence; `style-src 'unsafe-inline'` is needed by React Flow. Accepted risk; keep the CSP strict.
- **L3. Voice: a global cap of 20 sessions** can be filled by 20 accounts, locking everyone else out. Fix with the per-person quotas in H1.
- **L4. Workspace sharing is not built yet.** When it is, one member's component names reach another member's AI prompt (the same prompt-injection surface with a second person). Re-review then.
- **L5. `src/dev/api-demo.ts` writes diagram names with `innerHTML`.** Dev-only (not in the production build) but a stored XSS if anyone ever deploys it. Fix: use `textContent`.

## Not covered (needs you or a live test)
- Supabase dashboard: Confirm email on, sign-up rate limits, SMTP, redirect URLs, leaked-password protection (Pro only).
- Vercel project: leftover `VITE_GEMINI_API_KEY` (delete and rotate), env vars set for production only.
- A live concurrency/load run on the hosted setup, and the container image (still unbuilt, B4).
- Penetration testing of a deployed instance.
