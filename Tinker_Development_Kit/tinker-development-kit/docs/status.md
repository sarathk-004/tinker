# Development status

Updated: 2026-10-06
Active milestone: I6 implemented on branch `implementation-6` (stack: main <- implementation-1 <- ... <- 5 <- 6). Branches 1-5 are pushed; implementation-6 is committed locally and NOT pushed. Next: I7 (voice). Reminder for I9: add "Continue with Google" sign-in (LC19).

## See it locally
Terminals: `npm run dev:db -w @tinker/server`, then `npm run dev:api:supabase` (your Supabase project) or `npm run dev:api` (local dev login), then `npm run dev`; open http://localhost:5173/ and type in the command bar. Plain commands work with no key. For free-form requests put `GEMINI_API_KEY=...` in `server/.env` (or `server/.env.supabase.local`), restart the API, and run `npm run check:gemini` first (LC22).

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

## Next action (I7)
Voice: realtime voice session that converges on the same command path (typed commands already do). Read the Phase 3 voice notes first; the wire contract is unspecified there (decision needed). Before I7, decide whether `ask` should also be reachable by voice.

## Handoff template
- Active task / milestone:
- Completed behavior:
- Changed files / commit:
- Commands run and outcomes:
- Decisions accepted or changed:
- Blockers / verification not run:
- Next concrete task:
