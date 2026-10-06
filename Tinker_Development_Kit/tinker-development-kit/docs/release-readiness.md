# Release readiness (I9), 2026-10-06

Verdict: **the software is release-ready; the deployment is not.** Everything that can be demonstrated on this machine passes with
evidence. What stands between this and real users is an account, plan or approval decision, not code. Blockers are listed first because the
gate says unresolved ones must be stated, not hidden.

## Release blockers (must be settled before real users)
| # | Blocker | Why | Who / what |
|---|---|---|---|
| B1 | **Supabase project is on the Free plan**: no daily backups, no point-in-time recovery, paused after 1 week of inactivity | The design targets RPO <= 5 min / RTO <= 60 min cannot be met, and a paused database is an outage. Provider-side restore therefore could not be drilled | Decision and payment: Pro ($25) + Small compute ($15) + PITR ($100 / 7 days) is about $140 / month (costs-and-limits.md). Until then rely on `backup:drill` on a schedule |
| B2 | **Nothing is deployed** (LC12). No Cloudflare or Railway account is connected | The gate: "deployment completion requires actual deployment verification" | You create the accounts; then follow runbook section 7 and re-run the checks against real URLs |
| B3 | **CI has never run** (LC3) | The workflow is written (now also scans the build and builds the container) but only runs on a push to `main` or a pull request, and pushes of PRs need your word | Open the first PR when you are ready; read the result |
| B4 | **The container image was not built here**: Docker Desktop is installed but its engine would not start (waited about 8 minutes) | The Dockerfile, `.dockerignore`, `docker-compose.preview.yml` are untested as a built image | Start Docker Desktop once and run `docker build -t tinker-server .`; CI builds it on the first run too. The same code was verified fresh-cloned and in production mode without a container |
| B5 | ~~Production database TLS (LC4)~~ **resolved 2026-10-06**: you added the Supabase root certificate (`server/certs/supabase-ca.crt`, valid to 2031); the production-mode checks now pass against your Supabase database with `DATABASE_SSL=verify` (a connection without the certificate is refused, with it accepted) | | Remember to set `DATABASE_SSL_CA_FILE=/app/server/certs/supabase-ca.crt` on the host (the image contains the file) |
| B6 | **Email sign-up needs custom SMTP** (new) | Supabase's built-in email sender only delivers to your own team members and is limited to 2 emails an hour, so a stranger would never get a confirmation link | You choose a transactional email provider and verify a sending domain (runbook section 8, step 2) |
| B7 | **A real microphone** was tried by you in Chrome (done); **leaked-password protection** is Pro-only (tied to B1); the **password strength rules** are set to 10 characters with all four classes (done) | Supabase advisor warning remains while on Free | Upgrade with B1 |
| B8 | **No hosted-region latency measurement** (LC5): all timings below are from this laptop to a local API and database | A laptop talking to a local database says nothing about a hosted region | After B2, run `bench:api` against the deployed API in dev-auth preview mode or measure real sign-in traffic with `log:report` |
| B9 | **The operator's Gemini key**: with the production default (`AI_KEY_MODE=user`) nothing runs on it, so the exposure is gone; if you choose `server` or `user_or_server` a budget alert and key restriction are still needed (LC26) | Per-user limits exist, no global cap | Only if you keep an operator key |

Not blockers, but known and listed in later-checks.md: transaction pooler (LC1), a real key-rotation drill (LC2), several single-instance in-memory
limits (LC9, LC32), no browser end-to-end suite (LC16), no deleted-diagram recovery screen (LC35), worker restarts/alerts (LC36).

## Evidence for the gate (what passes, how to repeat it)
| Item | Result | Repeat with |
|---|---|---|
| **A31 fresh install and migration** | In an empty clone with no local files: `npm ci`, typecheck, all tests (shared 17, server 338, web 121), boundaries, build, artifact scan, a new database, 2 migrations, API up, the 26-step smoke path, the backup drill, and the worker completing its jobs: all passed (run twice; the first run caught two real problems, below) | `bash scripts/fresh-setup-check.sh` |
| **A30 no secrets in the built frontend** | 3 files scanned; 7 secret shapes, 5 server-only names and 6 real local secret values (your Gemini key, database URLs) checked: none present | `npm run build && npm run check:artifacts` (also a CI step) |
| **A32 recovery drill** | Local database, 21,675 rows (31 MB): export 2.9 s, restore into a fresh database 4.2 s, every table matched by checksum, **7.1 s** end to end. Your Supabase project (62 rows): export 1.3 s, restore 0.5 s, verified, 1.8 s. A restore refuses a tampered file and a non-empty target. The provider's own backups could not be drilled on the Free plan (B1) | `npm run backup:drill` and `backup:drill:supabase` (the latter only reads Supabase) |
| Ownership, isolation, public tables, CORS, secrets | strangers get 404 everywhere (incl. history, restore, advice, speech, voice); viewers read but cannot write; row level security on 11/11 tables on Supabase (`check:supabase`); no browser role can read anything; CORS and the voice WebSocket accept only the configured origin; production refuses wildcards, missing settings and dev login | `npm test`, `check:supabase`, `check:production` (14 checks) |
| Critical paths end to end | sign-in, create, typed commands, move, reopen identical, retry replays once, same key different request refused, stale write conflicts, advice changes nothing, restore makes a new version, isolation, voice origin and hello, delete: 26 checks pass against a running API | `npm run smoke:api` |
| Structured logs and metrics | one line per API request with route pattern, status, milliseconds and error code (never ids, bodies, tokens or user text); worker job claim/complete/fence/retry/dead-letter with lease takeovers; AI attempt latency and failures; `log:report` summarizes them | `npm run log:report -w @tinker/server -- api.log` |
| **p95 latency, measured, local** | 20 users x 5 rounds x 8 operations, 20-node diagrams, zero failed requests. Sequential: every p95 <= 37 ms (open diagram 10 ms). 20 users at once: p95 open diagram 272 ms, writes 222-264 ms, reads 113-121 ms. All within the design targets (300 ms read/write, 500 ms open). Location: this laptop (i7-1360P, 16 cores) to a local API and local Postgres, 0-2 ms network baseline | `npm run bench:api -w @tinker/server` |
| AI latency (live, earlier in I5-I7) | typical free-form answer 1.5-2.5 s, occasional 7-13 s (first attempt capped at half of the 15 s deadline, then one retry); spoken replies take about half the audio length to produce (5-9 s) | `check:gemini`, `check:voice:api` |
| Costs and limits | read from the providers' own pages and dated | `costs-and-limits.md` |
| Hosting configuration | `Dockerfile`, `.dockerignore`, `railway.json`, `docker-compose.preview.yml`, `public/_headers`, `public/_redirects`, CI container step; settings and rollout order in the runbook. Prepared and reviewed, **not deployed** (B2, B4) | runbook section 7 |

## What the I9 checks found and fixed (the point of running them)
1. **Plain commands used up the AI quota** (found while designing the benchmark): every typed command, even "add Orders" that never touches a model, counted against the 10-per-minute AI limit, so a user typing quickly would be refused. Now only requests that actually need the model count. Test added.
2. **Every request ran a four-statement write transaction** just to find the user: five database round trips and a row lock per request, painful on a hosted database. A returning user now costs one read and no write. Reads got about 30% faster and concurrent write p95 fell from 300-390 ms to 222-264 ms. Test added (proves one query, no transaction, row untouched).
3. **The first benchmark was wrong** (refused requests were being timed, flattering the numbers). Only successful requests are timed now, failures are counted and shown; the report says where it was measured.
4. **A script with a `#!` first line broke the test suite on a fresh Windows checkout** (line endings). The shebang is gone and `.gitattributes` fixes the line-ending policy.
5. **A test that compared a table's row count before and after an export was flaky** because other test files share the database. It now uses an isolated copy.
6. Fresh-setup cleanup left servers running; the script now stops everything it started.
7. The backup checksum comparison first failed on the Supabase data for the wrong reason (timestamps rendered in different time zones); both sides now use UTC.

## Sign-in (LC19, built this milestone)
"Continue with Google", forgot password (neutral answer, no account probing), choose a new password after following the reset link, email-confirmation landing,
errors returned in the address are shown in plain words and one-time parameters are removed from the address bar, and an expired session returns to sign-in with
"Your session expired. Please sign in again; your saved diagrams are safe." Covered by 11 tests against a fake Supabase client. The real Google round trip needs B6.

## Added after the first hand-over (2026-10-06)
- **Sign-up with email verification replaces Google sign-in** (your decision): password rules checklist, "check your email" screen with resend, neutral answers (no account probing), optional Turnstile bot check, an API-side email-confirmed check (403 `EMAIL_NOT_VERIFIED`), and a strict Content-Security-Policy generated at build time (the built app loads under it with zero violations).
- **People bring their own AI key** (your decision): production default `AI_KEY_MODE=user`; keys checked with Google, sealed with AES-256-GCM, bound to their owner, never returned or logged, removable, rotatable. Verified live with the real model (`npm run check:byok`).
- **The `user_api_keys` table is applied to Supabase** (2026-10-06, with your approval) as well as locally: BYOK can work there. Email delivery: Resend chosen; waiting for the sending domain and the key to be entered in Supabase (B6).
- **The Supabase certificate is verified** and the production-mode checks pass against Supabase.
