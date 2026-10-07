# Runbook: run it, check it, ship it, recover it

Written in I9 against the real repository (2026-10-06). Every command below was run; where something could not be run here it says so.
No secret appears in this file: values are placeholders, real ones live in `.env` (git-ignored) or the host's secret store.

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
  (computed from the graph) need no model. For free-form AI, voice and spoken replies put `GEMINI_API_KEY=...` in `.env`.
- Use your own Supabase project instead of the local login: `.env` (see `.env.example`) and
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
| `npm run check:supabase -w @tinker/server` | live JWKS, forged tokens, TLS, row level security, migration recorded | `.env` |
| `npm run check:byok -w @tinker/server` | bring-your-own-key with the real model: nothing runs without a key, a bogus key is refused, a real key is stored encrypted and runs the person's request, removal switches it off, the key is in no log | `GEMINI_API_KEY` (only as the key the simulated person pastes) |
| `npm run check:production:supabase -w @tinker/server` | the same production-mode checks against your Supabase database with the certificate VERIFIED | `.env`, `server/certs/supabase-ca.crt` |
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
| `REQUIRE_VERIFIED_EMAIL` | true | refuse tokens whose email address was never confirmed (on top of Supabase's "Confirm email") |
| `AI_KEY_MODE` | **server** everywhere (the key stays on our side only) | whose model key the AI runs on: `server`, `user` (each person brings their own) or `user_or_server` |
| `KEY_ENCRYPTION_SECRET` | - | **required unless `AI_KEY_MODE=server`**: 32 random bytes in base64, seals people's stored API keys. Host secret store only |
| `KEY_ENCRYPTION_SECRET_PREVIOUS` | - | retired secret(s) while rotating (comma separated) |
| `JWT_AUDIENCE` | authenticated | |
| `RATE_LIMIT_PER_MINUTE` | 120 | per user, in memory (single instance) |
| `GEMINI_API_KEY` | - | enables free-form AI, voice and spoken replies. Server only |
| `GEMINI_MODEL`, `GEMINI_THINKING_LEVEL`, `GEMINI_LIVE_MODEL`, `GEMINI_TTS_MODEL`, `GEMINI_TTS_VOICE` | see `.env.example` | measured defaults |
| `AI_DEADLINE_MS`, `AI_RATE_LIMIT_PER_MINUTE`, `AI_MAX_CONCURRENT` | 15000, 10, 2 | model requests only; plain commands cost no quota |
| `AI_DAILY_LIMIT`, `VOICE_DAILY_LIMIT` | 20, 10 | per person per UTC day: model requests (free-form command, model-explained question, spoken reply) and voice sessions. Plain parser commands are free. Counted in Postgres (`usage_daily`), so restarts cannot reset it. |
| `AI_GLOBAL_DAILY_LIMIT`, `VOICE_GLOBAL_DAILY_LIMIT` | 1000, 100 | the whole service per day (budget breaker): when reached, model features pause for everyone until 00:00 UTC. |
| `VOICE_MAX_SESSIONS`, `VOICE_MAX_SESSION_MS` | 20, 600000 | |
| `WORKER_POLL_MS`, `WORKER_LEASE_SECONDS` | 5000, 60 | the worker process |
| `HOST`, `PORT`, `LOG_LEVEL` | 127.0.0.1, 8787, info | containers set `HOST=0.0.0.0`; hosts usually inject `PORT` |

Browser (public by design; ship in the bundle): `VITE_API_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, optional `VITE_ENABLE_DEV_LOGIN` and `VITE_TURNSTILE_SITE_KEY` (the bot-check site key).
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

- **Supabase**: follow section 8 (email confirmation, custom SMTP, URL configuration, password rules, optional CAPTCHA). The API variables for a `user`-mode deployment are in section 3 (`KEY_ENCRYPTION_SECRET` is required).
- **API + worker on Railway** (two services from the same repo): both build the root `Dockerfile` (`railway.json` is the API service; for the worker service override the start command to `npx tsx server/src/worker.ts` and disable the health check). Variables for both: `NODE_ENV=production`, `DATABASE_URL`, `DATABASE_SSL=verify`, `DATABASE_SSL_CA_FILE=/app/server/certs/supabase-ca.crt` (the image contains the certificate), `SUPABASE_URL`, `CORS_ORIGINS=<web origin>`, `KEY_ENCRYPTION_SECRET`. `GEMINI_API_KEY` only if you choose `AI_KEY_MODE=server` or `user_or_server`. Railway terminates TLS and supports WebSockets; the voice session limit is 10 minutes, below typical idle/lifetime limits. A single API instance only (rate limits and voice sessions are in memory: LC9, LC32).
- **Web on Cloudflare Pages**: build command `npm run build`, output `dist`, variables `VITE_API_URL=https://<api host>`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` (and `VITE_TURNSTILE_SITE_KEY` if you use the bot check). The build writes `dist/_headers` with security headers and a **Content-Security-Policy generated from those same settings** (scripts only from the site itself; connections only to the site, the API and its WebSocket, and Supabase; no framing, no plugins). `public/_redirects` gives single-page routing. Review it locally with `npm run build && npm run preview:headers` (serves `dist` the way Pages will, applying the headers); the built app was loaded under the policy with zero violations (2026-10-06).
- **Web on Vercel instead of Cloudflare Pages** (the user's choice, 2026-10-06): `vercel.json` already carries the single-page rewrite and the static security headers; the build also writes the Content-Security-Policy into `dist/index.html` as a `<meta>` tag, so it applies on Vercel too (framing is refused by the `X-Frame-Options` header). Set `VITE_API_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` in the Vercel project settings. **Vercel cannot host the API**: it is a long-running server with WebSockets (voice) and a separate worker, so it runs on Railway (or any host that runs a container). An old Vercel project of the pre-migration prototype may still hold a `VITE_GEMINI_API_KEY` in its settings: delete it and rotate that key (LC18).
- **After deploying**: run the smoke checks against the real URLs (section 2; `API_URL=https://<api> npm run smoke:api` needs a dev-login build, so in production use a real sign-in and the manual list: sign in, create, add, reload, second tab conflict, restore, voice), check `GET /health/ready`, and read the first hour of `log:report`.

## 8. Sign-up with email verification (what is built, what you set in Supabase)

**In the app:** create account (password checked against the same rules Supabase enforces: 10+ characters with lowercase, uppercase, digit and symbol, with a live checklist), a "check your email" screen with a resend button (once a minute), sign-in before confirming shows the same screen, forgot password and choose-new-password, errors in plain words, and an expired session returns to sign-in with an explanation. Sign-up, sign-in and password-reset answers are identical whether or not an address already has an account (no account probing). Optional bot check (Cloudflare Turnstile) on all three forms.
**On the API:** a token is accepted only if its signature, issuer, audience and expiry are valid AND its email address is confirmed (`REQUIRE_VERIFIED_EMAIL`, default on): a defence in depth in case Supabase's "Confirm email" is ever switched off. An unconfirmed token gets a clear 403 `EMAIL_NOT_VERIFIED`, and nothing is created for it.
**In the browser:** PKCE sessions, a strict Content-Security-Policy (see section 7) so injected script cannot run or send the session anywhere, and the session lives in supabase-js storage (no Gemini or database secret is ever in the browser).

Supabase dashboard settings (project `rnwbgjrzbliqvqradjcm`), in this order:
1. **Authentication > Sign In / Providers > Email**: provider enabled; **Confirm email ON**; Secure email change ON; password rules: minimum length 10, all four character classes (done 2026-10-06). Leaked-password protection needs the Pro plan.
2. **Authentication > Emails > SMTP Settings: set up custom SMTP.** This is not optional for real users: Supabase's built-in sender only delivers to your own team members and is limited to **2 emails an hour** (it says so in its docs), so strangers would never receive a confirmation link. Use a transactional provider (Resend, Postmark, SES, SendGrid...), verify your sending domain with SPF/DKIM, then set the per-hour limit under Authentication > Rate Limits. **With Resend:** add and verify your domain in Resend (DNS records), create an API key with sending access only, then in Supabase enter host `smtp.resend.com`, port `465`, username `resend`, password = the Resend API key, and a sender address on the verified domain. The key lives only in the Supabase dashboard.
3. **Authentication > URL Configuration**: Site URL = the web app origin; Redirect URLs = every origin you use (for example `https://app.example.com/**` and `http://localhost:5173/**`). Confirmation and reset links are refused otherwise.
4. **Authentication > Rate Limits**: keep sign-ups and sign-ins at the defaults or lower (defaults: 30 per 5 minutes per address; one email per minute per user).
5. **Authentication > Attack Protection > CAPTCHA** (recommended once the app is public): create a Cloudflare Turnstile widget, paste the SECRET key into Supabase, put the SITE key in `VITE_TURNSTILE_SITE_KEY`, rebuild.
6. **Authentication > Emails > Templates**: confirm the "Confirm signup" and "Reset password" templates name the app and keep `{{ .ConfirmationURL }}`; keep the link lifetime short (the default is one hour; 15 minutes is tighter).
Keep **anonymous sign-ins and unused providers disabled**.

## 9. People bring their own AI key (and nothing runs on yours)

`AI_KEY_MODE` decides whose Gemini key the AI uses: `server` (your `GEMINI_API_KEY` for everyone: development), `user` (not used: each person adds their own key; with none, only plain commands, editing, history and computed advice work), or `user_or_server`.
- A person adds the key under "Add AI key" (header). The browser sends it once over HTTPS; the server **checks it with Google** (a free request that lists one model), **seals it with AES-256-GCM** under `KEY_ENCRYPTION_SECRET` (bound to the person's id, so a copied row does not open for anyone else), and stores only ciphertext plus its last four characters. It is decrypted in memory for the single request that needs it, never returned by any route, never logged (a test scans the logs), never kept in the browser. Removing it deletes the row. Typed commands, advice, spoken replies and voice each use the key of the person asking.
- Submitting keys is limited to 5 a minute per person, so the endpoint cannot be used to test guessed keys.
- **Secret handling:** generate `KEY_ENCRYPTION_SECRET` once (`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`) and keep it ONLY in the host's secret store. If the database leaks without the secret, the keys stay sealed; if the secret leaks without the database, there is nothing to open. Back the secret up separately from the database: without it every stored key is unreadable (people would simply add theirs again). **Rotate**: set the new value as `KEY_ENCRYPTION_SECRET`, put the old one in `KEY_ENCRYPTION_SECRET_PREVIOUS`, run `npm run rotate:ai-keys -w @tinker/server` (prints counts only), and remove the old secret when it reports 0 unreadable.
- Costs and limits then belong to each person's own Google account (their own free tier or billing), which is the point. The app's per-person limits (10 model requests a minute, 2 at once, 10-minute voice sessions) still protect the server.
- Not built (deliberately): other providers than Gemini, sharing a key across a workspace, usage display.
