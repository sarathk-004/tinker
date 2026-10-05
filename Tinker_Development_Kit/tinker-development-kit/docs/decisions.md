# Accepted decision records

Accepted records take precedence over the PROPOSED text in contract-decisions.md.
Format: ID; status; date; decision; rationale; affected; verification; migration consequences.
Date for all records below: 2026-10-05 (I0). "User" = explicit answer in chat; "default" = technical default recorded under I0 authority, open to veto.

## Stack and platform
| ID | Status | Decision | Source |
|---|---|---|---|
| S1 | accepted | Package manager npm (existing package-lock.json); Node 24; TypeScript strict | user (approved) |
| S2 | accepted | Existing Vite/React frontend stays at repo root. Add npm workspaces `shared/` (Zod schemas + DTOs) and `server/` (API). Frontend imports only `shared`. | user |
| S3 | accepted | API: Fastify. Validation: Zod (shared). DB: PostgreSQL via `pg` with plain SQL migrations (node-pg-migrate). Tests: Vitest (domain/API/integration) | user |
| S4 | accepted | Auth + Postgres: Supabase Auth and Supabase Postgres; API verifies JWT issuer/audience/signature/expiry via JWKS, uses a server-only DB role, public API exposure of app tables disabled (D09). Hosting direction Cloudflare/Railway remains unverified until I9. | user |
| S5 | accepted (default) | Gemini via server-side SDK only; model id and structured-output config verified from current docs at I5/I7. Prototype id `gemini-3.8-flash` is unverified. | default |

## Product/semantic decisions (user answers)
| ID | Status | Decision |
|---|---|---|
| P1 | accepted | REMOVE_NODE = plain removal: delete node, all incident edges and its presentation entry atomically. No bridging by default. An explicit "Remove and reconnect" command (e.g. REMOVE_NODE_RECONNECT, schema defined in I1) may be added later with defined semantics: for each incoming x->node and outgoing node->y with x != y and no existing x->y edge, create one edge with new UUID, relationship = incoming edge's relationship if equal to the outgoing one else empty, metadata empty; atomic with the removal. Not required for I2 gate. |
| P2 | accepted | Layout: persisted positions are preserved on structural commands. Only newly created nodes get a dagre-derived initial position (computed server-side or by shared pure helper; must be deterministic). An explicit "Auto layout" action recomputes all positions as a presentation save (versioned, no structural revision). Highlight/dim/animation stay ephemeral. |

## Contract decisions D01–D12 (resolution for I0 gate)
| ID | Status | Resolution |
|---|---|---|
| D01 | accepted (default) | As proposed: generic `mutation_requests`, unique actor_id+idempotency_key, canonical request hash, stored status/body replay, reauthorize before replay, IDEMPOTENCY_KEY_REUSED. |
| D02 | accepted (default) | As proposed: short reservation transaction, lease_token, 60 s lease, commit rechecks lease, auth, version. |
| D03 | accepted (default) | As proposed: 7-day full replay, 30-day tombstones; RETRYABLE_FAILED max 3 attempts. Final error-code list is an I1 deliverable (`shared`). |
| D04 | accepted (default, amended) | DB-generated UUID (v4 via `gen_random_uuid()` unless v7 verified on target Postgres). Client temp ids for optimistic adds. Prototype ids never become persisted ids; no legacy import is needed (repo-map: no persisted data). Server resolves human names/legacy tokens to UUIDs before command validation. |
| D05 | accepted (default) | As proposed; positions PATCH merges by node id; combined with P2. |
| D06 | accepted with open items | Caps as proposed (500/2000/1 MiB/120/160/8 KiB) pending UX check. NodeKind reconciliation: keep prototype 9 kinds {client, gateway, service, database, cache, queue, storage, external, generic}. Domain node = {id, name(label), kind(type), technology(subType), metadata}; `awsIcon` and `description` stored in `metadata` (icon is derivable from technology; metadata.icon is user override). Resolved in I1: edges are directed; the prototype's bidirectional marker is `edge.metadata.bidirectional` (not interpreted by the engine); duplicate edge = same source, target and relationship; parallel edges with different relationships are allowed; self-loops rejected; renameNode does NOT re-infer icon/technology (prototype did; server inference runs only on add/insert when technology absent). groupNodes/subType-as-group dropped from command union (becomes metadata.group later if needed). Client undo replaced by revision restore (I8); local undo may remain as UI sugar only if it issues compensating commands. INSERT_BETWEEN requires edgeId when parallel edges exist; both replacement edges copy original relationship and metadata. |
| D07 | accepted (default) | As proposed (15 s deadline, one retry within deadline). |
| D08 | PENDING | Voice wire contract; resolve before I7. |
| D09 | accepted (default) | 401 unauthenticated; uniform 404 for inaccessible diagram; 403 for insufficient role in known workspace; atomic personal-workspace bootstrap; Supabase JWT verification per S4. Revocation freshness: tokens verified per request; membership checked in DB per request (no cache in MVP). |
| D10 | accepted (default) | Single API instance, in-memory limits 120/10 per user per minute, 2 concurrent AI. Documented limitation. |
| D11, D12 | PENDING | Resolve before I8. |

## Source conflicts surfaced
1. Phase 1 command vocab (add/connect/disconnect/insert/remove/rename/highlight/explain) vs prototype (also updateNode, groupNodes, deleteSelected, undo, applyLayout, reset). Resolved: command union = add, update (name/kind/technology/metadata), remove, connect (with relationship/metadata), disconnect, insert, rename, reset; highlight/explain are transient/advisory; group/undo/layout per D06/P2.
2. I2 "remove incident edges" vs prototype bridging: resolved by P1.
3. Prototype Gemini tool enum omits `external`: server schema includes it.
4. Prototype `disconnect` removes both directions; server DISCONNECT will take edge id or (source,target) and remove only matching directed edge(s); both-direction removal needs two explicit commands. (default; confirm in I2 tests)

## I1 contract choices (2026-10-05, default)
- Schemas live in `shared/src` (Zod 4). NodeKind uses UPPERCASE per the LLD; `NODE_KIND_FROM_LEGACY` maps prototype lowercase types.
- Commands: ADD_NODE, REMOVE_NODE, RENAME_NODE, UPDATE_NODE (kind/technology/metadata; `technology:null` clears; metadata replaces), CONNECT, DISCONNECT (edgeId XOR source+target), INSERT_BETWEEN (optional edgeId), RESET. All schemas are strict (unknown fields rejected). New-node commands carry no id; the server assigns UUIDs (D04).
- Version counter starts at 1; `expectedVersion` is an integer >= 1.
- Error codes finalized (D03) in `shared/src/errors.ts` with a retry-policy table; additions to the LLD list: NOT_FOUND 404, PAYLOAD_TOO_LARGE 413, IDEMPOTENCY_RESULT_EXPIRED 410, INTERNAL_ERROR 500, NOT_IMPLEMENTED 501 (I1 stubs only), SERVICE_UNAVAILABLE 503. Malformed envelope/headers = INVALID_REQUEST; invalid `command` = INVALID_COMMAND.
- Idempotency-Key: printable ASCII, 8-128 chars. Request body limit 1 MiB. Validation error details carry paths and messages only, never submitted values.
- Authentication runs before validation on every `/v1/diagrams/*` route (scoped hook); the I1 default authenticator rejects everything with 401 until I3.

## I2 engine choices (2026-10-05, default)
- Engine: `server/src/modules/diagrams/domain` (`applyCommand(doc, command, newId)`): pure, returns `{ok,value}` or `{ok:false,error:{reason,message,details}}`; reasons are the shared DOMAIN_ERROR_REASONS and map to DOMAIN_VALIDATION_FAILED (422) with `details.reason`. A post-condition check throws if the engine ever produces an invalid document (a bug, never a user error).
- Prototype behaviours consciously changed: addNode of an existing id (no-op) -> ids are server UUIDs, same-name nodes are allowed; insertBetween used to drop relationship and delete both directions -> now removes one directed edge and both replacement edges copy relationship and metadata; disconnect removed both directions -> removes exactly one directed edge (edgeId, or source+target if unambiguous); renameNode re-inferred icon/subType -> rename touches only the name.
- Placement (P2 refinement): new nodes start at the insert midpoint (INSERT_BETWEEN) or the dagre position (ADD_NODE), then move to the nearest free spot (40 px clearance, alternating down/up in 130 px steps) so they never overlap and no existing node moves. Found by checking the first version in the browser: preserving positions alone stacked Redis on PostgreSQL.
- Dev preview: `/dev/engine/*` API routes exist only when NODE_ENV=development (404 in test/production) and `engine-demo.html` + `src/dev/engine-demo.ts` (not in the production build). Remove or keep behind the flag once the real editor (I4) is the way to see changes.

## I3 persistence and API choices (2026-10-05, default; veto welcome)
- Local database without Docker: `embedded-postgres` (real Postgres 18.4 binaries, devDependency) powers `npm run dev:db -w @tinker/server` (persistent, loopback, throwaway credentials) and an isolated per-run cluster for tests. Docker Compose file kept as an alternative. Target hosting remains Supabase Postgres (S4) and was not exercised.
- Tables as in LLD section 2 plus `workspaces.personal_for_user_id` (unique bootstrap key, D09) and generic `mutation_requests` (D01) linked from `command_executions`. `command_executions.idempotency_key/payload_hash` of the LLD are replaced by the link to `mutation_requests`. All tables have RLS enabled with no policies; anon/authenticated roles are revoked when present.
- Version semantics: new diagram = version 1; every durable change (command, presentation save, rename, delete) = +1. Revisions (MANUAL_COMMAND) only for structural commands; presentation saves, renames and deletes create none (supersedes nothing; revisit with I8 restore).
- Authorization order: authenticate -> rate limit -> request shape (params, headers, body schema) -> authorize (404 for non-members/deleted, 403 for insufficient role) -> idempotency reservation -> version/domain checks -> atomic commit that re-authorizes. Replays always pass authorization first, so revoked or deleted access never replays; a retried DELETE after the diagram is gone answers 404 (D09).
- Stored outcomes: success and deterministic failures (409 version conflict, 422 domain refusal) are stored and replayed (D03). Auth failures and infrastructure errors are not cached: the reservation is released so the key can be retried. Replay window 7 days, then 410 IDEMPOTENCY_RESULT_EXPIRED (cleanup job in I8). Lease 60 s, MAX_ATTEMPTS 3 (used by the I5 provider path).
- Request hash = sha256 of canonical JSON {api v1, method, resource path, validated body}; expectedVersion is part of the body (DELETE: the validated query).
- DELETE contract: `DELETE /v1/diagrams/{id}?expectedVersion=n` (soft delete, version +1). Empty bodies with `Content-Type: application/json` are accepted.
- Auth: Supabase JWKS verification (`jose`, asymmetric algorithms only, issuer `<SUPABASE_URL>/auth/v1`, audience `authenticated`); user mapped by `sub` to `users.external_auth_id`; no token or membership caching in the MVP (revocation takes effect on the next request; cost to be measured in I9). Local development login (`AUTH_MODE=dev`, `POST /dev/auth/login`) signs tokens with a throwaway in-memory key and exists only if explicitly enabled AND NODE_ENV=development; production config rejects it and requires SUPABASE_URL, DATABASE_URL and CORS_ORIGINS. The dev key changes whenever the API restarts, so sessions end on restart.
- Rate limit: fixed window, in-memory, per user, 120 requests/minute (`RATE_LIMIT_PER_MINUTE`), 429 with Retry-After (single-instance only, D10).
- CORS exposes `x-request-id`, `idempotent-replayed` and `retry-after` so the I4 client can read them.
- Workspace/member management routes (create workspace, invite, roles) are NOT built; tests grant roles directly in SQL. Diagram listing is capped at 200 without pagination.
