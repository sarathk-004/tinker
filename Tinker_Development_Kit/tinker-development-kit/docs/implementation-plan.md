# Phase-wise implementation plan

Use I0–I9 for implementation milestones; Design Phases 1–3 remain reference documents.
All boxes begin unchecked because the real repository has not been inspected.
A milestone gate means demonstrated behavior, not files merely created.

| Milestone | Outcome | Dependencies |
|---|---|---|
| I0 | Verified prototype map and migration plan | Repository access |
| I1 | Runnable scaffold and shared contracts | I0 |
| I2 | Deterministic graph engine | I1 |
| I3 | Protected persistence and safe command API | I2 |
| I4 | Durable manual editor: first working model | I3 |
| I5 | Typed intent through server-side AI | I4 |
| I6 | Read-only architecture advice | I5 |
| I7 | Voice through the same command path | I5; realtime contract |
| I8 | Revision recovery and maintenance jobs | I4; retention/lease decisions |
| I9 | Release candidate and operational checks | Required product milestones |

I6 and I8 may be built independently after prerequisites; this does not authorize simultaneous edits.
No time estimate is attached until I0 measures the existing code and test baseline.

## I0 — Repository audit and design closure
Read: source Phase 1, architecture, contract-decisions.
- [x] Inspect package manifests, lockfiles, repository instructions, branch/status, CI and runtime versions.
- [x] Identify canvas components, Zustand stores, mutation helpers, parser, Gemini orchestration, voice transport and layout code.
- [x] Run existing build/check scripts; record baseline failures separately.
- [x] Populate repo-map with exact paths and real commands; classify code as keep/extract/replace.
- [x] Identify existing persistent data and legacy ID formats before planning import.
- [x] Record package manager, API framework, validation library, DB migration tool and auth integration choices.
- [x] Resolve D01–D06 and D09–D10 before I3; resolve later decisions before their affected milestones.
- [x] Record source conflicts and clarify material product choices; routinely document technical defaults within authorized scope.
Gate: a reviewer can identify every mutation entry point and the proposed migration path. No browser secret remains enabled in the new production path.
Evidence: baseline command results, source paths, decision records. No claim that Phase 1 accurately describes current code without inspection.

## I1 — Foundation and shared contracts
Read: architecture, Phase 3 sections 3/8/9/12/15.
- [x] Preserve the existing frontend; add backend/modules and shared contracts using repository conventions.
- [x] Add validated configuration, health endpoint, request IDs and consistent errors.
- [x] Define graph/presentation runtime schemas, complete NodeKind enum and all command discriminated unions.
- [x] Define canonical diagram responses, errors, UUID/version constraints and limits.
- [ ] Add DB migrations/run scripts and local setup docs using actual choices. (scripts, compose file and docs added; NOT run against a database: Docker daemon unavailable)
- [x] Add contract boundary checks and CI for meaningful existing scripts.
Gate: frontend and API start locally; malformed command input is rejected consistently; browser imports only contract DTOs/schemas, not backend logic.

## I2 — Diagram domain engine
Read: Phase 3 section 8; acceptance domain cases.
- [ ] Extract framework-independent add/remove/rename/update/connect/disconnect/insert/reset operations.
- [ ] Inject ID generation into the engine rather than binding tests to DB or clock.
- [ ] Remove incident edges and presentation entries on node deletion.
- [ ] Reject unknown endpoints, duplicates, unsupported self-loops and ambiguous insert operations.
- [ ] Preserve relationship/metadata semantics or document the chosen replacement policy.
- [ ] Add deterministic downstream traversal with cycle protection.
- [ ] Verify input immutability, referential integrity and atomic insertion failures.
Gate: Orders → PostgreSQL becomes Orders → Redis → PostgreSQL with one valid operation. Invalid operations leave the input document unchanged.

## I3 — Identity, persistence and command API
Read: contract-decisions D01–D06/D09–D10, Phase 3 sections 2/5–7/9/13/17.
- [ ] Create schema constraints/indexes once, with versioned migrations.
- [ ] Verify managed tokens server-side; map identities to internal users.
- [ ] Provision personal workspace/membership atomically and idempotently.
- [ ] Implement authorized create/list/load/rename/soft-delete routes.
- [ ] Implement command and presentation routes with expectedVersion.
- [ ] Implement operation reservation, payload hashing, stored response replay and lease fencing.
- [ ] Execute conditional update + revision + execution completion in one transaction.
- [ ] Reauthorize retries and scope conversation/revision IDs to the authorized diagram.
- [ ] Bound requests and implement stated single-instance rate/concurrency rules.
- [ ] Verify DB access policies and prevent public table exposure.
- [ ] Integration-test concurrent duplicate keys, stale versions, replay after later edits, revoked access and rollback.
Gate: acknowledged state survives API restart; an exact retry returns its original result; two writes from the same version produce one success and one conflict. Cross-workspace access is denied.

## I4 — Durable manual editor
Read: Phase 3 sections 16/5; acceptance browser cases.
- [ ] Add login/workspace/diagram loading flows using existing UI.
- [ ] Map canonical graph and presentation into React Flow.
- [ ] Route every structural UI action through the command client.
- [ ] Serialize document writes per diagram, including drag-end saves and metadata writes.
- [ ] Keep optimistic working state separate from acknowledged state and transport retries.
- [ ] Use stable request keys for retries; reconcile full document responses.
- [ ] Preserve draft and stop queued writes on conflict; expose reload/recovery behavior.
- [ ] Implement explicit pending/saved/failed status and safe navigation behavior.
- [ ] Import legacy diagrams once with UUID mapping and validation if existing data needs it.
- [ ] Remove direct browser Gemini calls from the migrated production path.
Gate: sign in, create diagram, add/connect/insert/drag, refresh, and recover the same diagram. In a two-tab stale-write demo, no silent overwrite occurs. Manual editing works with AI disabled.
This is the first durable working model. Do not wait for voice or a worker to demonstrate it.

## I5 — Typed command interpretation
Read: Phase 3 sections 10–12; D07; provider documentation at implementation time.
- [ ] Implement provider gateway interface and deterministic fake for tests.
- [ ] Implement simple parser fast path using explicit IDs/unambiguous name resolution.
- [ ] Interpret ambiguous text through server-side Gemini with validated structured output.
- [ ] Bind interpretation to the captured diagram version; reject if state changes meanwhile.
- [ ] Keep original AI request body/hash stable across retries; persist validated interpretation.
- [ ] Enforce total 15-second deadline, cancellation, rate limit and concurrency cap.
- [ ] Treat unknown references/ambiguous names as clarification rather than guesses.
- [ ] Persist conversation turns and link committed operations without duplicate retry messages.
- [ ] Keep retry failures separate from graph state; ignore late provider completion after cancellation.
Gate: typed “Put Redis between Orders and PostgreSQL” commits through the same API service as manual insertion. Malformed output, timeout and stale version do not change the diagram.
Live provider smoke test requires a configured server credential; fake-provider tests do not prove live connectivity.

## I6 — Read-only architecture advice
Read: Phase 3 sections 10/11; deterministic graph analyzer.
- [ ] Implement authorized ai/ask and bounded conversation context.
- [ ] Compute downstream dependencies and cycles without relying on the model.
- [ ] Provide computed topology and diagram version to the explanation provider.
- [ ] Return validated highlight IDs for transient UI display.
- [ ] Verify advice never writes graph/presentation/revision state.
Gate: “What happens if Orders goes down?” explains the computed dependencies; diagram version and graph remain unchanged.

## I7 — Voice integration
Read: D08 and current provider/browser audio documentation.
- [ ] Define authenticated WebSocket lifecycle, origin checks, token refresh and session ownership.
- [ ] Define transcript/proposal/event schemas and browser capture format.
- [ ] Keep partial transcripts provisional; only explicit finalized tool events propose commands.
- [ ] Capture version and stable operation IDs; route to the existing handler.
- [ ] Apply quotas, bounded buffers, cancellation and session cleanup.
- [ ] Reconnect without replaying committed commands; verify duplicate tool events.
- [ ] Remove provider credentials from client voice configuration.
Gate: spoken insertion works; duplicate events apply once; permission revocation/reconnect is handled; losing voice connection does not break manual editing.
Typed-command completion does not imply voice readiness.

## I8 — History, restore and maintenance
Read: D11–D12; Phase 3 sections 4/14.
- [ ] Implement authorized revision listing and restore as a new version, never decrementing version.
- [ ] Restore graph and presentation through the shared transaction/idempotency path.
- [ ] Implement Postgres job claiming with short claim transaction and recoverable lease.
- [ ] Fence stale workers, enforce retry bounds, and store sanitized errors.
- [ ] Implement revision pruning, expired execution cleanup and deletion purge.
- [ ] Defer export/deep-analysis workers until those features have explicit acceptance criteria.
- [ ] Verify crash after claim, duplicate worker execution and idempotent artifact behavior.
Gate: restore creates a new canonical version; dead workers do not strand jobs; cleanup respects retention/replay policy and current diagram state.

## I9 — Release readiness
Read: runbook and acceptance release cases.
- [ ] Run relevant checks and end-to-end critical paths on a fresh setup.
- [ ] Validate configuration, migrations and backward-compatible rollout sequence.
- [ ] Verify ownership checks, public table exposure, CORS/origins and secret-free frontend artifacts.
- [ ] Add structured logs and metrics for command latency, conflicts, AI failures and job leases.
- [ ] Measure p95 targets with an explicit workload/region; report misses rather than assuming goals.
- [ ] Validate managed backup/PITR capabilities against RPO/RTO; run a recovery drill.
- [ ] Document costs/limits only after checking current provider plans.
- [ ] Prepare hosting configuration and review the runnable preview before deployment.
Gate: critical behaviors pass with evidence; unresolved release blockers are stated. Deployment completion requires actual deployment verification.

## Task completion record
For each checked task record: task ID, affected files, verification command/result, notable limitations.
Keep long historical output out of status.md; link to relevant evidence or commit.

