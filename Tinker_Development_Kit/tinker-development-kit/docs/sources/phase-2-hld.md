# Phase 2: High-Level Design (HLD)

Source: https://app.notion.com/p/3f039e268b9c813aa457ee04505783e4?pvs=204
Snapshot retrieved: 2026-10-05. Authoritative source last edited: 2026-10-05T08:27:21.840Z.
Portable Markdown conversion; Notion callouts/tables normalized. Code snippets remain illustrative.

**Phase 2 goal:** Define the production architecture shape for Tinker without over-engineering beyond a few thousand active users.
## 1. Architecture Direction
**Target architecture:** Modular monolith.
One backend codebase with strict internal module boundaries, one primary database, one API surface, and a separate worker process only for asynchronous work that should not block user interactions.
**\[Modular monolith\] -\> Clean domain isolation and an easy scaling path without paying the deployment and networking cost of microservices today.**
### Why this shape
- The current scale does not justify independent services.
- Domain boundaries can still be enforced inside one application.
- Horizontal scaling remains possible by running multiple stateless API instances later.
- Modules can be extracted into services in the future if load, ownership, or reliability needs justify it.
## 2. Core System Principle
> **AI interprets intent. The Tinker domain engine owns truth. PostgreSQL owns durability.**
The production request path should follow:
```plain text
User Intent
→ AI Interpretation or Deterministic Parser
→ Structured Command
→ Schema Validation
→ Authorization
→ Domain Validation
→ Mutation
→ Persistence
```
Gemini must never write directly to application state or the database.
## 3. Target System Boundaries
### Client
- React + TypeScript.
- React Flow for canvas rendering.
- Zustand for editor/session state only.
- Optimistic UI for reversible canvas interactions.
- Local storage may be used for draft recovery, never as the authoritative source of truth.
### Backend
The backend is a modular monolith containing these logical modules:
- **Identity** — maps external identity to Tinker users.
- **Workspace** — ownership, membership, roles, sharing boundaries.
- **Diagram** — canonical graph state and deterministic mutations.
- **AI** — provider gateway, intent interpretation, response validation.
- **Conversation** — stores context used for AI interactions.
- **Architecture Analysis** — deterministic graph analysis plus AI explanations.
- **Infrastructure** — database, queue, cache, auth integration, observability.
## 4. Diagram Module
The Diagram module is the core business domain.
Responsibilities:
- Create and load diagrams.
- Add, update, rename, and remove nodes.
- Connect and disconnect edges.
- Insert nodes between existing nodes.
- Validate graph mutations.
- Maintain diagram versions.
- Create bounded revisions.
### Important separation
The domain graph must not depend on React Flow.
```plain text
Domain Node
- id
- name
- kind
- technology
- metadata

Canvas Presentation
- nodeId
- x
- y
- width
- height
- UI-only state
```
**\[Separate graph semantics from React Flow presentation\] -\> Backend logic, tests, future clients, and the canvas can share one domain model, at the cost of a frontend mapping layer.**
## 5. AI Module
The AI layer should be divided into explicit responsibilities:
```plain text
AI Module
├── Provider Gateway
├── Intent Interpreter
├── Prompt Builder
├── Tool / Command Definitions
├── Response Validator
└── Architecture Advisor
```
### Provider Gateway
Only the gateway should know Gemini-specific SDK/API details.
Application code should depend on an interface such as:
```typescript
ai.interpretCommand(...)
ai.explainArchitecture(...)
```
rather than importing Gemini directly throughout the codebase.
**\[Single provider abstraction boundary\] -\> Gemini can be replaced or supplemented later without spreading provider-specific code across the product, while avoiding a premature multi-provider framework.**
## 6. Intent Interpreter vs Architecture Advisor
### Intent Interpreter
Used when user intent may change diagram state.
Example:
```plain text
"Put Redis between Orders and PostgreSQL"
→ INSERT_BETWEEN command
```
### Architecture Advisor
Read-only by default.
Examples:
- "What happens if Orders goes down?"
- "Is this architecture resilient?"
- "What would you improve here?"
Recommendations should not mutate the graph until the user explicitly asks to apply them.
**\[Separate advisory AI from mutating AI\] -\> Explanations remain safe read-only operations and architecture changes require explicit user intent, at the cost of maintaining two workflows.**
## 7. Deterministic Command Fast Path
Before calling Gemini, Tinker should attempt to recognize simple commands locally/server-side.
Examples:
- `reset`
- `undo`
- `delete selected`
- `connect A to B`
Flow:
```plain text
User Command
→ Deterministic Parser
   ├── Understood → Structured Command
   └── Ambiguous → Gemini
```
**\[Deterministic fast path\] -\> Common operations become faster, cheaper, and less dependent on Gemini, while Tinker must maintain a small explicit parser.**
## 8. Authentication and Authorization
Use a managed identity provider for authentication.
The provider owns:
- Password authentication.
- OAuth.
- Email verification.
- Password recovery.
- Session security.
Tinker owns:
- Users.
- Workspaces.
- Workspace membership.
- Roles.
- Diagram permissions.
- Sharing rules.
**\[Managed authentication + Tinker-owned authorization\] -\> Removes sensitive authentication mechanics from the codebase while retaining full control of product permissions.**
## 9. Workspace-First Ownership
Introduce a workspace boundary from the beginning.
```plain text
User
└── Workspace
    ├── Diagram
    ├── Diagram
    └── Diagram
```
Every new individual user can automatically receive a personal workspace.
**\[Workspace-first ownership\] -\> Solo and future team accounts share one stable ownership model, while the MVP gains one small additional domain concept.**
## 10. Persistence Strategy
### Primary datastore
Use one **managed PostgreSQL** database.
Do not introduce MongoDB, Neo4j, a distributed database, or a vector database for the initial product.
**\[PostgreSQL as primary datastore\] -\> Strong consistency, transactions, relational ownership data, and JSON support live in one operationally simple system.**
### Diagram representation
For the MVP, persist:
```plain text
Diagram relational metadata
+
Canonical graph JSONB document
+
Version
+
Bounded revision snapshots
```
Relational metadata should include fields frequently queried or indexed, such as:
- diagram ID
- workspace ID
- name
- version
- created timestamp
- updated timestamp
The graph document contains nodes, edges, and presentation metadata.
**\[JSONB graph document in PostgreSQL\] -\> Small diagrams can be loaded and saved atomically with simple revision snapshots, while individual-node SQL querying becomes less convenient.**
## 11. Revision Strategy
Do not use full event sourcing for the MVP.
Store:
```plain text
Current Diagram State
+
Bounded Revision Snapshots
```
Potential revision triggers:
- AI command applied.
- Node added or removed.
- Structural connection changed.
- Explicit checkpoint.
- Periodic autosave checkpoint.
Avoid creating a persistent revision for every mouse movement.
**\[Snapshot revisions instead of event sourcing\] -\> Keeps save and restore behavior easy to reason about while giving up perfect command replay.**
## 12. Concurrency Model
Use optimistic concurrency control.
Example:
```plain text
Client loads Diagram v34
→ Client submits mutation with expectedVersion = 34
→ Server checks stored version
   ├── 34 → apply mutation and save v35
   └── not 34 → return 409 Conflict
```
This prevents one stale browser or device from silently overwriting another user's newer state.
**\[Optimistic concurrency\] -\> Prevents lost updates without database locks, while stale clients must reload or reconcile conflicts.**
## 13. API Strategy
Use REST for core application operations.
Examples:
```plain text
GET    /workspaces/{workspaceId}/diagrams
POST   /diagrams
GET    /diagrams/{diagramId}
POST   /diagrams/{diagramId}/commands
POST   /diagrams/{diagramId}/ai/interpret
```
GraphQL is unnecessary for the current command-heavy domain, and gRPC adds no value while the backend remains a single application.
**\[REST API\] -\> Explicit contracts are easy to debug and operate for Tinker's command-oriented workflows, while clients get less arbitrary query flexibility than GraphQL.**
## 14. Realtime Strategy
Use ordinary HTTP/REST for normal CRUD and command requests.
Use WebSockets only where persistent bidirectional communication is justified, primarily voice/realtime AI.
```plain text
Browser Microphone
↔ Tinker Realtime Gateway
↔ Gemini Live
→ Structured Command
→ Diagram Command Handler
```
The voice path must converge into the same command handler used by manual edits and typed AI requests.
**\[WebSockets only for realtime voice\] -\> Voice gets low-latency bidirectional transport without forcing the rest of the product onto persistent connections.**
## 15. Unified Mutation Path
All mutation sources must converge on one application path:
```plain text
Manual Canvas Edit ─┐
Typed Command ──────┼→ Diagram Command Handler
Voice Command ──────┘
                         ↓
                    Authorization
                         ↓
                    Domain Validation
                         ↓
                    Persistence
```
There must not be separate graph mutation implementations for voice, AI, and manual editing.
## 16. Architecture Analysis
Graph facts should be calculated deterministically before asking the LLM to explain them.
Example:
```plain text
User: "What happens if Orders fails?"

Diagram Graph
→ Graph Traversal
→ Affected Nodes / Dependencies
→ Structured Context
→ Gemini Architecture Advisor
→ Explanation
```
**\[Compute topology before asking the LLM\] -\> Explanations are grounded in actual diagram relationships instead of relying on model guesses.**
## 17. Asynchronous Work
Only tasks that do not need to block the user should become background jobs.
Good candidates:
- Deep architecture analysis.
- Export generation.
- Thumbnail generation.
- Analytics processing.
- Revision pruning.
- Cleanup tasks.
- Notifications.
Keep direct graph mutations synchronous.
### Queue approach
Start with a lightweight job mechanism, such as Postgres-backed jobs or Redis-backed jobs if Redis is already justified elsewhere.
Do not introduce Kafka or RabbitMQ at this stage.
**\[Lightweight worker queue\] -\> Slow/non-critical work is isolated without introducing distributed-streaming infrastructure.**
## 18. Caching Strategy
### Client-side caching
Use client caching for:
- recently accessed diagrams
- workspace metadata
- query results
- optimistic editor state
- local draft recovery
### Server-side caching
Do not cache authoritative diagram state in Redis initially.
PostgreSQL should remain the direct source of truth for diagram reads and writes.
Redis may later be introduced for:
- distributed rate limiting
- WebSocket coordination
- queue backend
- short-lived shared state
**\[No diagram cache initially\] -\> Avoids stale-state and invalidation bugs while PostgreSQL easily handles MVP read volume.**
## 19. AI Fault Isolation
The AI Gateway must protect the rest of the application from provider failure.
It should enforce:
- timeouts
- cancellation
- concurrency limits
- rate limits
- selective retries
- structured-response validation
- safe error mapping
If Gemini is unavailable:
```plain text
AI features degrade
but
Diagram load/save/manual editing continue working
```
**\[AI fault isolation\] -\> Gemini outages degrade assistance rather than taking down the editor or exhausting backend resources.**
## 20. Retry Rules
Retries should only occur when the operation is safe.
Safe examples:
- Read-only AI explanations.
- Temporary upstream connection failures.
- Idempotent reads.
Potentially unsafe examples:
- `ADD_NODE`
- `DELETE_NODE`
- `INSERT_BETWEEN`
Mutation retry safety will be handled through idempotency guarantees in Phase 3.
## 21. Horizontal Scaling Path
Initial runtime:
```plain text
Browser
→ Tinker API
→ PostgreSQL
```
Later:
```plain text
Browser
→ Managed Load Balancer
   ├── API Instance 1
   ├── API Instance 2
   └── API Instance 3
        ↓
    PostgreSQL
```
API instances should remain stateless so additional instances can be added without migrating user state.
**\[Stateless API instances\] -\> Horizontal scaling is straightforward, while durable/shared state must live in external infrastructure.**
## 22. Deployment Topology
For the pragmatic MVP:
```plain text
Internet
→ CDN / Static Frontend Hosting
→ Managed Load Balancer
→ Tinker API
   ├── Managed PostgreSQL
   ├── Managed Identity Provider
   ├── Gemini
   └── Background Worker
```
Use a single region initially with managed backups and recovery procedures.
Redis remains optional until a concrete requirement appears.
## 23. Technologies Deliberately Deferred
Do **not** introduce these during the MVP unless a demonstrated requirement appears:
- Kubernetes.
- Microservices.
- Kafka.
- Service mesh.
- Graph database.
- Separate vector database.
- Full event sourcing.
- CQRS.
- Active-active multi-region infrastructure.
- Distributed locking everywhere.
- Redis caching for ordinary diagram reads.
## 24. Phase 2 Decisions to Carry into Implementation
1. **\[Modular monolith\] -\> Clean domain isolation without microservice overhead.**
2. **\[Managed PostgreSQL\] -\> One durable transactional datastore covers the MVP cleanly.**
3. **\[PostgreSQL JSONB diagram document\] -\> Atomic graph saves and revisions stay simple.**
4. **\[REST for core APIs\] -\> Command-oriented contracts remain explicit and easy to debug.**
5. **\[WebSockets only for realtime voice\] -\> Realtime complexity is limited to the feature that needs it.**
6. **\[Server-side AI Gateway\] -\> Secrets, quotas, validation, and provider behavior stay under backend control.**
7. **\[Stateless API servers\] -\> Horizontal scaling requires no redesign of application state.**
8. **\[Optimistic concurrency\] -\> Silent overwrites are prevented without long-lived database locks.**
9. **\[Managed authentication + internal authorization\] -\> Identity security is outsourced while Tinker retains permission control.**
10. **\[Workspace-first ownership\] -\> The model works for personal use now and collaboration later.**
11. **\[Deterministic graph engine\] -\> Core architecture state remains reliable regardless of LLM behavior.**
12. **\[AI interpreter and advisor separation\] -\> Read-only reasoning cannot accidentally mutate diagrams.**
13. **\[Lightweight async worker\] -\> Background work is isolated without enterprise messaging infrastructure.**
14. **\[No authoritative diagram cache initially\] -\> PostgreSQL remains simple and consistent.**
15. **\[Deterministic command fast path\] -\> Common commands avoid unnecessary AI latency and cost.**
## 25. Codex Build Constraints
When implementing the production redesign, treat these as hard constraints unless an Architecture Decision Record explicitly changes them:
- [ ] Keep the backend as a modular monolith.
- [ ] Do not expose Gemini credentials to the browser.
- [ ] Route all AI access through the server-side AI Gateway.
- [ ] Treat LLM output as untrusted structured input.
- [ ] Validate every AI-generated command before execution.
- [ ] Keep the core Diagram Domain independent of React and React Flow.
- [ ] Keep manual, text-AI, and voice mutations on the same Diagram Command Handler.
- [ ] Use managed PostgreSQL as the authoritative datastore.
- [ ] Persist diagram version numbers and reject stale writes.
- [ ] Use workspace ownership as the primary tenancy boundary.
- [ ] Keep API instances stateless.
- [ ] Keep AI failures isolated from core editing and persistence.
- [ ] Do not add microservices, Kafka, Kubernetes, a graph DB, or a vector DB without a measured requirement.
- [ ] Prefer deterministic graph algorithms for topology, dependency, and blast-radius calculations.
- [ ] Use AI for interpretation and explanation, not for enforcing correctness.
## 26. Phase 3 Entry Point
Phase 3 should convert this HLD into concrete implementation contracts:
- Database schema and indexes.
- Diagram JSON structure.
- Workspace/user/membership tables.
- Revision storage.
- Idempotency model.
- Optimistic concurrency transaction logic.
- REST contracts.
- Command schemas.
- Error model and HTTP status behavior.
- Worker and queue mechanics.
**Phase 2 invariant:** AI can suggest what should happen. Only the Tinker domain layer can decide what actually happens.

