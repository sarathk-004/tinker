# Contracts to resolve before coding

Status: PROPOSED. These are new implementation recommendations closing gaps in the design docs.
During I0, accept or revise each applicable choice in a small decision record.
Do not describe a proposal as an already agreed requirement.

## D01 — Response replay and scope
Use a generic mutation_requests table for every persistent mutation, including creates without a diagram ID.
Retain command_executions for diagram command diagnostics; link it to the generic request.
Unique actor_id + idempotency_key across routes. Hash a canonical representation of API version,
HTTP method, resource path, expectedVersion and validated original body.
Never hash provider-generated output as the original request.
Store status_code and complete response_body for stable replay.
Authorization must be rechecked before replay. Do not disclose stale protected results after revocation/deletion.
Reject a changed request hash with IDEMPOTENCY_KEY_REUSED.
Replayed state can be older than the current diagram; include operation result version and replay marker,
and never reconcile it over a newer acknowledged client version. Fetch latest if needed.

## D02 — Reservation and crash recovery
Reserve in a short transaction before provider work. Fields: status, lease_expires_at, lease_token,
attempt_count, request_hash, response_status/body, timestamps and operation context.
Duplicate active lease returns REQUEST_ALREADY_PROCESSING without holding open a long transaction.
After expiration, atomically acquire a new lease token; old holders cannot commit.
During commit lock the reservation, check current lease ownership and expiration, reauthorize,
validate current document version and persist diagram/revision/execution/terminal outcome atomically.
Every late/cancelled provider callback must fail the lease check.
Start with a 60-second lease proposal for a 15-second total interpretation deadline.
Expired reservation alone never proves a mutation failed: committed outcomes are stored atomically.

## D03 — Failures and retention
Schema-invalid requests before reservation may be rejected without durable reservation.
Store terminal domain/version/auth-independent outcomes after reservation; exact retry replays them.
For transient provider failure, mark RETRYABLE_FAILED with no mutation and permit an atomic same-key
reacquisition with bounded attempts. Report final unavailable outcome when attempts are exhausted.
An authorization failure is never cached as a reusable authorization grant.
Guarantee full response replay for 7 days initially; afterward retain compact key/hash/outcome tombstones
for 30 days. A tombstone returns an expired-result error and requires reconciliation, never re-execution.
Document that beyond the full retention window clients must create a new logical operation intentionally.
Finalize error codes and frontend retry policy before implementation. Cleanup excludes active reservations.

## D04 — UUIDs and provisional nodes
Use supported database-generated UUIDs for durable server-created entities; v4 is acceptable if v7 support is uncertain.
Optimistic additions use client-only temporary IDs. Queue dependent commands until canonical UUID mapping arrives.
Manual structural writes are serialized per diagram. The same logical retry retains its original payload/key.
Legacy import allocates new UUIDs and remaps all edges/positions atomically; reject unresolved references.
Do not silently change ADD_NODE's ID contract in frontend only.

## D05 — Document response and presentation merge
Return complete canonical graph + presentation + version for durable document mutations.
Presentation PATCH merges provided positions by node ID; absent entries remain unchanged.
Reject unknown nodes and non-finite coordinates/invalid zoom. Deletion prunes positions.
Graph/presentation referential integrity is validated together.
Metadata rename/deletion/restore participate in the one version counter and idempotency.
Viewport shared persistence follows the current LLD; record an explicit decision if making it user-specific.
AI results arriving after a drag-save may conflict; preserve intent and request explicit retry against latest state.

## D06 — Complete command semantics and limits
Specify all discriminated schemas before handlers. Candidate NodeKind values must be reconciled with actual prototype.
INSERT_BETWEEN must identify a unique edge; if parallel edges are supported, require edgeId.
Define whether both replacement edges copy the original relationship and metadata.
Empty names, unknown kinds and immutable ID changes are rejected.
RESET clears graph and related positions but still creates a new version.
Proposed initial caps: 500 nodes, 2,000 edges, 1 MiB graph/presentation payload, 120-character node name,
160-character diagram name, 8 KiB command text. Verify UX and provider budget before acceptance.
Highlight is transient; explain is advisory. Undo is not in the original command union:
start with explicit revision restore, then define undo separately if the product requires it.

## D07 — Conversation and AI deadline
Authorize conversation owner and its diagram on every request. Bound context by token/byte budget as well as turn count.
Store each original user message once per logical request and assistant outcome once per attempt policy.
Interpret outside DB transactions. One 15-second wall-clock deadline includes all provider retries.
Cancel late results and lease-fence commits. At most one upstream retry within the remaining deadline.
Model selection and structured-output configuration are verified from current Gemini documentation.

## D08 — Voice wire contract
Pending exact Gemini Live integration. Define authenticated connection, audio format, start/stop,
partial/final transcript, command proposal, command result, cancel, error and reconnect events.
A tool event carries a stable operation ID and captured expectedVersion.
Never mutate per partial transcript. Preserve final-event deduplication across reconnect.
Set a bounded session duration, audio buffer and per-user concurrency policy before implementation.

## D09 — Permissions and identity provisioning
Unauthenticated is 401. For inaccessible diagram IDs, propose uniform 404 to reduce cross-tenant disclosure.
For a known authorized workspace with insufficient role, return 403.
Conversation/revision/request replay authorization is tied to current membership and deletion status.
Provision user + personal workspace + owner membership atomically with unique bootstrap key.
AI advisory viewing follows diagram read permission; AI commands require edit permission.
Verify token issuer/audience/signature/expiry with the managed provider; do not trust user IDs from bodies.
Record revocation freshness and session-token caching policy. Select least-privilege DB access strategy.

## D10 — Initial rate limits and scaling
Choose single API instance initially: in-memory counters may enforce 120 ordinary and 10 AI requests/minute/user,
with maximum two AI requests concurrently. Restart resets counters; explicitly document this limitation.
Before adding instances, migrate quotas/semaphores to shared storage with atomic leases.
Do not claim per-user aggregate enforcement from independent process-local counters.
Separate health/diagnostic routes and WebSocket session quotas.

## D11 — Retention, deletion and restore
Propose keeping the latest 100 structural revisions while pruning non-latest revisions older than 30 days;
this is an intersection bound, not unlimited retention until either criterion happens.
Latest canonical state is never pruned. Explain the resulting history window in product copy.
Soft-delete recovery window: 30 days; choose owner recovery API and purge cascade.
Restore creates version current+1 with expectedVersion, idempotency and a RESTORE revision.
Decide whether explicit pinned checkpoints receive longer retention before adding that feature.

## D12 — Worker leases
Claim eligible jobs using a short transaction with FOR UPDATE SKIP LOCKED, mark RUNNING, set lease/token,
increment attempts, commit, then process outside the transaction.
Heartbeat long jobs; reclaim expired leases; completion requires current token.
Retry schedule proposal: 10 seconds then 60 seconds, maximum 3 attempts.
Unique operation_key deduplicates enqueue; external side effects must also be idempotent.
Fence old workers at artifact publication, not merely at DB status completion.
Expired lease, schema failure and external failure have distinct diagnostic states.

## Decision record format
ID; status (proposed/accepted/superseded); date; selected behavior; rationale;
affected contracts; verification cases; compatibility/migration consequences.
Accepted records take precedence over historical proposals.

