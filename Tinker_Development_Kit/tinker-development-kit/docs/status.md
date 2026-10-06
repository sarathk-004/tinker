# Development status

Updated: 2026-10-06
Active milestone: I9 implemented on branch `implementation-9` (plus the follow-ups of 2026-10-06: Supabase certificate verified, Google sign-in replaced by email verification, bring-your-own-key AI) (stack: main <- ... <- 8 <- 9). Branches 1-8 are pushed; implementation-9 is committed locally and NOT pushed. Release verdict (docs/release-readiness.md): the software is release-ready, the deployment is not: blockers B1-B9 need accounts, a paid plan or the user's approval. After I9 the user wants: later checks, UI changes, a few fixes, setup.

## See it locally
Terminals: `npm run dev:db -w @tinker/server`, then `npm run dev:api:supabase` (your Supabase project) or `npm run dev:api` (local dev login), then `npm run dev`; open http://localhost:5173/ and type in the command bar. Plain commands work with no key. For free-form requests put `GEMINI_API_KEY=...` in `server/.env` (or `server/.env.supabase.local`), restart the API, and run `npm run check:gemini` first (LC22).

## I9 completion record (verified 2026-10-06)
Full evidence table and blockers: `docs/release-readiness.md`. Costs: `docs/costs-and-limits.md`. How to run and ship: `docs/runbook.md`.
| Task | Evidence |
|---|---|
| Checks and critical paths on a fresh setup (A31) | `bash scripts/fresh-setup-check.sh`: empty clone, `npm ci`, typecheck, tests (17 + 338 + 121), boundaries, build, artifact scan, new database, 2 migrations, API, 26-step `smoke:api`, backup drill, worker: all passed (first run found and fixed a shebang/line-ending test failure and a flaky backup test) |
| Configuration, migrations, rollout sequence | `check:production` (14 checks: refuses missing settings, wildcard CORS and dev login in production; no dev routes; strict CORS; forged tokens; voice origin), runbook sections 3-4 (additive migrations before code; API, worker, then web) |
| Ownership, public table exposure, CORS/origins, secret-free artifacts (A30) | `check:supabase` RLS 11/11, `check:artifacts` (shapes + names + real local secret values, CI step), isolation in `smoke:api` and the API tests |
| Structured logs and metrics | request line (route pattern, status, ms, error code), worker job and lease lines, AI attempt latency; `log:report` percentiles, conflicts, failures, job leases; tested |
| p95 targets with an explicit workload (miss reporting) | `bench:api`: 20 users x 5 rounds x 8 ops; sequential p95 <= 37 ms; 20 concurrent p95 <= 272 ms; all targets met LOCALLY; hosted measurement pending (B8). The benchmark first reported wrong numbers (refused requests timed); fixed |
| Backups/PITR vs RPO/RTO and a recovery drill (A32) | Supabase is on the Free plan: no backups, no PITR (B1). Own drill: 21,675 rows 7.1 s; Supabase data 1.8 s; checksums match |
| Costs and limits checked against current plans | `costs-and-limits.md` (Supabase, Gemini, Railway, Cloudflare Pages, read 2026-10-06) |
| Hosting configuration and preview | `Dockerfile`, `.dockerignore`, `railway.json`, `docker-compose.preview.yml`, `public/_headers`, `public/_redirects`, CI container step prepared. NOT verified as a built image (Docker Desktop's engine did not start, B4) and NOT deployed (B2) |
| LC19 sign-in | Continue with Google, forgot password, new password after the reset link, confirmation landing, error-in-address handling, expired-session message: 11 tests with a fake Supabase client; the real Google round trip needs the user's two setup steps (runbook section 8) |
Follow-ups the same day (user decisions): the Supabase root certificate is verified end to end (`check:production:supabase`); email verification replaced Google sign-in (runbook section 8); bring-your-own-key AI (runbook section 9; `check:byok` live). Tests now: shared 17, server 360, frontend 143. New later-checks: LC38 SMTP, LC39 Turnstile, LC40 account deletion and export, LC41 apply `user_api_keys` to Supabase (needs approval), LC42 secret backup and rotation drill.
Fixes found by running the checks: plain commands no longer use AI quota; a returning user costs one read, not a write transaction (concurrent write p95 300-390 ms -> 222-264 ms); `.gitattributes` line endings.
Commands: `npm run typecheck` PASS; `npm test` PASS (shared 17, server 338, frontend 121); `npm run check:boundaries` PASS; `npm run build` + `npm run check:artifacts` PASS.

## I8 completion record (verified 2026-10-06)
| Task | Where | Evidence |
|---|---|---|
| Authorized revision listing; restore as a new version, never decrementing | `modules/history/*`, `shared/src/history.ts`, routes `GET /v1/diagrams/{id}/revisions[/{version}]`, `POST /v1/diagrams/{id}/restore` | 13 API tests: baseline revision on creation, newest-first paging, drags create none, restore => version+1 with a RESTORE revision and execution record, redo = restore the version we came from, can go back to empty, retry replays once, key reuse 409, stale version 409, unknown version 422 `REVISION_NOT_FOUND`, same content 422 `ALREADY_CURRENT`, two concurrent restores => exactly one wins; viewers read but cannot restore (403), strangers 404, deleted diagram 404 |
| Restore through the shared transaction and idempotency path | `history-service.ts` (`runIdempotent`, same lock, version check, atomic commit) | injected failure after the revision insert rolls everything back and the same key then succeeds |
| Postgres job claiming, short claim transaction, recoverable lease | `migrations/1761000000000_jobs.sql`, `modules/jobs/queue.ts` | 12 tests: operation-key dedupe, `FOR UPDATE SKIP LOCKED` (12 concurrent claimers, 5 jobs, no duplicates), lease + heartbeat |
| Fence stale workers, retry bounds, sanitized errors | `queue.ts`, `worker.ts` | a worker whose lease was taken over cannot complete, fail or heartbeat (fenced, result discarded); retry after 10 s then 60 s, third failure = dead letter; a job that crashes its workers every time is dead-lettered (bounded); stored errors are one line without URLs, tokens or stack traces; error kinds LEASE_EXPIRED / SCHEMA / EXTERNAL / INTERNAL |
| Revision pruning, expired execution cleanup, deletion purge | `modules/jobs/handlers.ts` | pruning needs BOTH outside the latest 100 AND older than 30 days; recent history beyond 100 and short or ancient short histories are kept; expired request bodies are dropped but the key stays a tombstone (the old key answers 410 and never re-executes), in-flight requests untouched, diagnostics after 90 days, tombstones after 90; purge removes only diagrams deleted more than 30 days ago with everything attached, one diagram per transaction, live and recently deleted diagrams untouched; every handler is safe to run twice |
| Defer export/deep-analysis workers | `jobs` table allows only the three implemented types | adding a type is a new migration |
| Crash after claim, duplicate worker, idempotent behaviour | `test/jobs/jobs.test.ts` | covered above |
Gate: restore creates a new canonical version (live: Undo took 3 nodes to 2 and Redo back to 3 in the real app, each as a new saved version); dead workers do not strand jobs (a crashed claim is retaken after its lease lapses, once); cleanup respects the retention and replay policy and current diagram state. The real worker process (`npm run worker`) was started against the dev database: it scheduled and completed the three maintenance jobs.
UI: Undo / Redo buttons in the header and Ctrl+Z, Ctrl+Shift+Z / Ctrl+Y (not while typing in a text field); a "Versions" tab in the sidebar listing saved versions with one-click Restore. Undo/redo are restores (durable, work across refresh and devices); drags create no versions so Undo steps over structural changes only.
Commands: `npm run typecheck` PASS; `npm test` PASS (shared 17, server 328, frontend 106); `npm run check:boundaries` PASS.

## I7 completion record (verified 2026-10-06)
| Task | Where | Evidence |
|---|---|---|
| Authenticated WebSocket lifecycle, origin check, token refresh, session ownership | `modules/voice/{routes,voice-session}.ts`, `shared/src/voice.ts` | Origin must be allowed (403 otherwise); token only in the first `hello` message (never the URL); bad/expired credentials 4401, strangers 4404, someone else's token in `auth` 4401; `auth` refreshes before expiry; one session per user (a newer one replaces the older, 4409); server-wide cap |
| Transcript/proposal/event schemas, capture format | `shared/src/voice.ts` (every server message is validated in tests), `src/voice/{pcm,capture}.ts` | 16 kHz mono Int16 PCM in 100 ms frames; AudioWorklet capture; encoder tests |
| Partials provisional; only an explicit tool call proposes | `gemini-live.ts`, `voice-session.ts` | partial transcripts change nothing (DB asserted); two tools only: `edit_diagram(request)` and `ask_about_diagram(question)`; unknown tools, wrong args and over-long text are refused |
| Version + stable operation ids; route to the existing handler | `voice-session.ts` | each proposal goes through `executeAiCommand` / `askAdvice` (same idempotency, version check, atomic commit) with the client-reported version; stale version => DIAGRAM_VERSION_CONFLICT and nothing changes; idempotency key derived from session + tool call id |
| Quotas, bounded buffers, cancellation, cleanup | `voice-session.ts` | chunk size, sustained audio rate, provider backpressure (drop, then close), max duration, idle timeout, hello timeout, max 3 pending proposals, `cancel`, timers and the model session released on every exit path |
| Reconnect without replay; duplicate tool events | `voice-session.ts`, `voiceClient.ts` | the same tool call id (also while the first runs, and after) applies once; a reconnect is a NEW session so nothing old is replayed; the browser re-syncs the diagram and conversation from the server before each start |
| No provider credentials in client voice configuration | `src/voice/*`, `gemini-live.ts` | the browser never sees a key or a model URL; the key is only in the server's outbound URL and is scrubbed from errors (test); built bundle contains no key |
Gate: spoken insertion works (fake provider in tests; LIVE with the real model and database: `npm run check:voice` and `npm run check:voice:api` => "Put Redis between Orders and PostgreSQL" spoken by a text-to-speech voice produced one new version with Redis between them; a spoken question changed nothing); duplicate events apply once; revoking access closes the session (4404) and a downgrade to viewer refuses edits but allows questions; losing the model or the connection leaves manual editing untouched and voice can simply be started again.
Spoken replies (added after the first hand-over): the assistant's answer to a SPOKEN request is read aloud. Voices: Gemini (server-synthesized, `POST /v1/diagrams/{id}/ai/speak`, accepts only the id of the caller's own stored assistant message, so it is not a general text-to-speech service) or the browser's built-in voice (free) or off. Default: Gemini when the server has a key, otherwise the browser voice; the user can switch in the speaker menu next to the microphone; a Gemini failure falls back to the browser voice. The microphone is held back while a reply plays so the assistant cannot hear itself. Live: the server read a stored answer aloud (about 12-18 s of audio, 5-9 s to produce it, so replies are shortened to about 220 characters when spoken; the full text stays on screen).
Live finding fixed: the model once called the edit tool twice (different ids) for one utterance, producing two Redis nodes. A request nearly identical to one made in the last 10 s is now treated as the same request (a failed request may be repeated); tested.
Commands: `npm run typecheck` PASS; `npm test` PASS (shared 17, server 293, frontend 90); `npm run check:boundaries` PASS; `npm run build` PASS.
Not verified here: a real microphone in a browser (the built-in browser pane blocks it) - see LC30.

## I6 completion record (verified 2026-10-06)
| Task | Where | Evidence |
|---|---|---|
| Authorized `POST /v1/diagrams/{id}/ai/ask` with bounded conversation context | `modules/ai/application/advice-service.ts`, `http/routes.ts`, `shared/src/ai.ts` | `view` access is enough (viewers may ask); stranger 404, no token 401, bad body 400, another user's conversation id 404; same 8-turn history bound as commands; uses the I5 rate limit, concurrency cap and 15 s deadline |
| Downstream, upstream and cycles computed without the model | `modules/analysis/graph-analyzer.ts` | 12 tests incl. loops, self-loops, 3000-node chain (no recursion), whole-word name matching with regex characters |
| Computed topology + diagram version given to the explainer | `application/advice.ts` | the prompt carries per-component reach as aliases (no UUIDs), loops, entry/end points; delimiters defanged; large diagrams only get reach lines for mentioned components |
| Validated highlight ids | `advice.ts` (`resolveHighlights`) | the model's aliases must name real components (an invented n42 is dropped); response `analysis` holds focus, downstream, upstream, affected ids and cycles |
| Advice never writes graph/presentation/revision state | `ask-api.test.ts` | version, graph, presentation, revision and execution counts are identical before and after (also for a VIEWER); only the conversation turn is stored |
| No model, or the model fails or returns junk: still an answer | `fallbackAnswer` | source `ANALYZER` with the same facts in words; works with no key at all |
Gate: "What happens if Orders goes down?" explains the computed dependencies; the diagram version and graph remain unchanged (tested over HTTP; live in the browser with the real Gemini key: answered about 2 s, Orders/Redis/PostgreSQL highlighted, 3 nodes and 2 edges unchanged).
UI: the command bar sends anything ending in "?" (except polite requests such as "can you add Redis?") or anything typed in Ask mode to advice; the Conversation tab shows "Tinker advice" with "Show on diagram" / "Clear" (highlight is view state, never saved).
Commands: `npm run typecheck` PASS; `npm test` PASS (shared 17, server 252, frontend 60); `npm run check:boundaries` PASS.

## I5 completion record (verified 2026-10-05)
| Task | Where | Evidence |
|---|---|---|
| Provider gateway interface + deterministic fake | `modules/ai/providers/{types,fake,gemini}.ts` | adapter tests with a fake `fetch` (key only in the header, never in URL/errors; response shapes; HTTP status mapping; abort = timeout); scripted fake provider used by all service tests |
| Parser fast path (explicit ids / unambiguous names) | `modules/ai/application/parser.ts` | 24 tests: gate command and variants, partial names, UUIDs, wiring when unconnected, reversed direction, several connections, unknown/ambiguous references, add/connect/disconnect/remove/rename, typed reset refused; "make the database faster" is NOT parsed as an add (a real bug found by the tests) |
| Gemini with validated structured output | `providers/gemini.ts`, `domain/model-output.ts`, `application/prompt.ts` | strict schema rejects unknown steps/fields, RESET, >8 steps, over-long text; prompt sends aliases only (no UUIDs), strips delimiter look-alikes, bounds history and diagram size. LIVE call NOT verified (LC22) |
| Interpretation bound to the captured version | `application/ai-service.ts` | stale expectedVersion refused before any provider call; a diagram changed WHILE the provider thinks => 409 at commit, nothing applied, same-key retry replays the 409 |
| Stable request body/hash across retries; persist validated interpretation | idempotency identity = validated request; executions stored as `PARSER_PLAN`/`AI_PLAN` with the commands | key reuse with other text/version => 409; exact retry replays; no second provider call |
| 15 s total deadline, cancellation, rate limit, concurrency cap | `application/interpret.ts`, `concurrency-limiter.ts` | slow provider => 504 within the deadline even when it ignores cancellation, late answer ignored (A20); 429 on the 3rd request/min test limit and on the 3rd simultaneous request; one upstream retry only inside the remaining deadline |
| Clarification instead of guessing | parser + plan executor | unknown alias from the model => 200 CLARIFICATION, nothing applied (A19) |
| Persist turns; link committed operations; no duplicate retry messages | `persistence/conversations.ts` | exact retry leaves exactly 2 messages; assistant turn metadata carries commandExecutionId and version; conversation id of another user/diagram => 404 before any work |
| Retry failures separate from graph state; late completion ignored | `mutation-requests.ts` (`runIdempotentPrepared`) | provider failures mark the key RETRYABLE_FAILED (3 bounded same-key attempts then 503 without calling the provider); lease fencing test (A12) and rollback test (A11) for the AI path |
Gate: "Put Redis between Orders and PostgreSQL" commits through the same transaction/service path as manual edits (tested over HTTP with the same result shape as manual INSERT_BETWEEN, and live in the real command bar); malformed output, timeout and stale version do not change the diagram (tests A19/A20 + stale/mid-flight).
Mutation checks: removing the commit-time version check, trusting model output without validation, and releasing instead of bounding retries were each caught by the tests (restored afterwards).
Commands: `npm run typecheck` PASS; `npm test` PASS (shared 17, server 220, frontend 58); `npm run check:boundaries` PASS; `npm run build` PASS (no Gemini references or key shapes in `dist`).
Live (built-in browser, real API + Postgres, no Gemini key): typed "add Orders", "add PostgreSQL", "connect Orders to PostgreSQL", then the gate command => 3 nodes, 2 edges; unknown name => clarification listing the components; duplicate => refused by the engine with the diagram unchanged; free-form text with no model => friendly "not available" and nothing changed; after refresh the diagram and 14 saved turns returned; the database shows 4 AI_COMMAND revisions and PARSER_PLAN executions.

## Limitations / risks (see later-checks.md LC22-LC28)
- The real Gemini endpoint has never been called. Request/response shapes come from the Interactions API reference; documentation summaries disagreed on where the output text lives, so parsing is tolerant. Run `npm run check:gemini` with a key before relying on free-form AI (LC22). Latency is unmeasured (LC23).
- AI limits are in memory for a single API instance (D10, LC9). No global spend cap or usage metrics (LC26).
- Typed RESET is refused on purpose (no undo yet). Voice is not built (LC28). Conversation messages are never pruned (LC27).
- A failed typed command that did not reach a stored outcome (provider failure, rate limit, network) is shown in the chat only for the session; it is not persisted.
- Prompt-injection defences were tested with scripted attacks, not a real model (LC24).

## Earlier milestones (details in git history, decisions.md and later-checks.md)
I1 contracts/API foundation; I2 pure engine; I3 persistence, identity, authorization, idempotency, RLS, Supabase verified; I4 durable editor (sign-in, serialized idempotent writes, conflict drafts, browser Gemini code removed).

## Next action (after I9)
The user wants, in order: later checks (`docs/later-checks.md`), UI changes, a few fixes, setup. Start by asking which later checks to take first; the ones that need the user are LC30 (microphone), LC37 (leaked-password protection), the Google setup (runbook section 8), LC4 (database CA), LC26 (Gemini budget alert). Release blockers B1-B9 are in `docs/release-readiness.md`.

## Handoff template
- Active task / milestone:
- Completed behavior:
- Changed files / commit:
- Commands run and outcomes:
- Decisions accepted or changed:
- Blockers / verification not run:
- Next concrete task:
