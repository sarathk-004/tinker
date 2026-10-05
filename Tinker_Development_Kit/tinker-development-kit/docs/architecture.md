# Agreed architecture

Source: design phases 1–3 in docs/sources/. This is a compact navigation aid.

## Product and scope
Tinker turns manual actions or spoken/typed architectural intent into validated graph operations.
The diagram is authoritative; conversation history is optional context.
Preserve existing canvas UX where practical. True offline merges and realtime multi-user editing are deferred.

## Modules
| Module | Responsibility |
|---|---|
| Identity | Managed token verification and internal user mapping |
| Workspace | Personal workspace provisioning, roles, ownership |
| Diagram | Framework-independent graph rules, commands, versioned persistence |
| AI | Parser, prompt builder, provider gateway, validated interpretation |
| Conversation | User-owned contextual turns attached to a diagram |
| Analysis | Deterministic topology and read-only explanations |
| Infrastructure | DB transactions, auth adapters, configuration, jobs, logs |

Frontend never imports backend business logic. Shared contracts may contain runtime schemas and DTOs.
Graph IDs and persistent entity IDs are UUIDs; retain a mapping when importing legacy human-readable IDs.

## State boundaries
Domain: node id/name/kind/technology/metadata; edge id/source/target/relationship/metadata.
Presentation: node positions and viewport, later visual preferences.
Ephemeral UI: selection, dragging, highlighting, pending changes, connection state.
One version counter covers persisted graph, presentation, and document metadata.
No revision for each pointer movement.

## Storage
users, workspaces, workspace_memberships, diagrams, diagram_revisions,
conversations, conversation_messages, command_executions; jobs when workers are implemented.
Keep graph and presentation in separate JSONB columns in diagrams.
Use targeted relational indexes, no graph GIN index initially.
Managed authentication owns credentials; Tinker owns authorization and internal UUIDs.

## Mutation path
Authenticate → authorize → request validation/idempotency handling → interpret if needed →
schema validation → domain validation → conditional version update →
atomic diagram/revision/execution persistence → canonical response.
Interpret outside long DB transactions. A version precheck never replaces the conditional write.
Reauthorize replay access; cached outcomes do not bypass revoked memberships or deletion policy.
All mutation entry points call the same application service.

## Provider failure boundary
Use server-side Gemini integration, structured output validation, cancellation,
a 15-second total interpretation deadline, limited transient retries and per-user quotas.
Compute topology before asking the model to explain it.
Provider unavailable: manual load/save remains operational.

## Proposed hosting direction
Cloudflare frontend, Railway API, Supabase PostgreSQL/Auth, Gemini provider.
Treat this as the discussed direction; verify actual repository choices and current hosting compatibility in I0.
No paid upgrades or price assumptions are required by this handoff.
Database access uses least-privilege server credentials and explicit ownership checks.
Do not accidentally expose server-owned tables via public Supabase APIs.

## Reliability goals from Phase 1
Normal API read/write p95 <300 ms; load <500 ms; AI first useful result p95 <4 s.
99.9% availability, RPO ≤5 minutes, RTO ≤60 minutes are design targets, not measured guarantees.
Validate region/network assumptions and backup capabilities before claiming them.

