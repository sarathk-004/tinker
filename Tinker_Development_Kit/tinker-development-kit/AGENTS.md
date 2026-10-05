# Tinker agent instructions

## Start and resume
Read docs/status.md and the current milestone in docs/implementation-plan.md.
Then read only relevant architecture/contract sections and affected source files.
Before first implementation, complete I0 against the real repository.
Use docs/repo-map.md for verified commands and entry points; never invent scripts.
Keep existing repository instructions when merging this file.

## Architectural invariants
- React + TypeScript, React Flow for rendering, Zustand for working UI state.
- Modular monolith; PostgreSQL is the durable source of truth.
- Separate graph semantics from presentation and transient canvas state.
- Manual, typed-AI, and voice structural edits use one DiagramCommand handler.
- Authenticate and authorize before protected work or provider calls.
- Schema/domain validation precede graph mutation. AI output is untrusted.
- Persist diagram, structural revision, and execution outcome atomically.
- All durable document writes require expectedVersion and safe retry semantics.
- Gemini credentials and SDK usage stay server-side.
- Read-only advice never mutates diagrams; topology is computed deterministically.
- AI failures do not break manual editing. No Redis/extra service without need.
- Do not introduce microservices, event sourcing, CRDTs, or vector databases.

## Execution
Migrate useful existing code; avoid an unsolicited rewrite.
Resolve applicable contract proposals and record accepted choices before coding.
Work in vertical increments; keep the app runnable.
Use rg for discovery. Reuse existing package manager and conventions.
Read current provider documentation when implementing auth, Gemini, or voice.
Do not guess Graphify APIs. It is optional retrieval tooling, not runtime truth.
Inspect retrieved code and callers; verify index freshness against actual files.
Keep secrets out of source, logs, prompts, and browser-accessible config.
Use isolated fixtures for DB tests; do not reset user data.
Complete relevant checks and review the diff before marking tasks done.
Do not run simultaneous agents against the same working files.

## Completion and handoff
A task is done only when its acceptance behavior is verified.
Record changed paths, actual commands/results, remaining risks, and next task in docs/status.md.
Keep docs/repo-map.md and accepted decisions current when implementation changes them.
Never report deployment, provider connectivity, or tests as successful without evidence.
If a dependency is missing, complete independent work and record the exact blocker.

