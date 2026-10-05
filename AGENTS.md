# Tinker agent instructions

Shared instructions for coding agents. Full dev kit: `Tinker_Development_Kit/tinker-development-kit/`
(docs/status.md, docs/implementation-plan.md, docs/repo-map.md, docs/decisions.md, docs/architecture.md).

## Start and resume
Read docs/status.md and the current milestone in docs/implementation-plan.md, then only the
architecture/contract sections and source files the task touches. Accepted records in docs/decisions.md
override proposals in docs/contract-decisions.md. Use docs/repo-map.md for verified commands and entry points.
Retrieval: `graphify-out/GRAPH_REPORT.md` / `graphify query "..."` are hints only; verify with rg and real files.

## Architectural invariants
- React + TypeScript, React Flow for rendering, Zustand for working UI state.
- Modular monolith; PostgreSQL is the durable source of truth. No microservices, event sourcing, CRDTs, vector DB, Redis without need.
- Separate graph semantics from presentation and transient canvas state.
- Manual, typed-AI and voice structural edits use one DiagramCommand handler.
- Authenticate and authorize before protected work or provider calls. AI output is untrusted; schema then domain validation precede mutation.
- Persist diagram, structural revision and execution outcome atomically; durable writes need expectedVersion and idempotent retry.
- Gemini credentials and SDK stay server-side. No provider secrets in `VITE_*`, localStorage or URLs.
- Read-only advice never mutates diagrams. AI failures must not break manual editing.

## Execution
Migrate useful existing code; no unsolicited rewrite. Vertical increments; keep the app runnable (`npm run build` passes).
Use rg for discovery, npm as package manager. Read current provider docs before auth/Gemini/voice work.
Keep secrets out of source/logs/prompts; never read or print `.env`. Isolated DB fixtures only.
One agent per working file set at a time.

## Completion and handoff
A task is done only when its acceptance behavior is verified. Record changed paths, commands/results, risks and
next task in docs/status.md; keep repo-map.md and decisions.md current. Never claim tests, deployment or provider
connectivity without evidence.
