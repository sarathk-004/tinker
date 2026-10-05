# Scoped context and optional Graphify

Graphify is a code-context retrieval aid. It is not part of Tinker's runtime graph storage.
Exact integration URL/version was not supplied. No install/MCP commands are asserted here.
Reduced token usage is a goal to measure, not a guaranteed tool property.

## Session workflow
1. Read status and the current implementation milestone.
2. Identify the affected boundary and read the relevant contract sections.
3. Locate implementation using rg, a fresh Graphify index, or available code tools.
4. Read target functions, callers and relevant tests. Verify against actual files.
5. Expand retrieval only for unresolved dependencies or failures.
6. Implement and run appropriate verification.
7. Record a compact handoff and refresh the index if code changed.

## Graphify setup checklist
- [ ] Identify exact project URL, supported runtime, version and repository integration.
- [ ] Verify its installation and MCP/CLI schema from primary documentation.
- [ ] Configure in the coding environment, not in browser-visible Tinker runtime config.
- [ ] Index actual source/contracts/test folders.
- [ ] Exclude secrets, dependency trees, build artifacts and generated output.
- [ ] Record index timestamp/commit and refresh policy.
- [ ] Verify a known function and its callers against rg/source.
- [ ] If docs are supported, index architecture and accepted decisions separately from code.
- [ ] Measure retrieval quality/token use on comparable tasks before claiming savings.

If Graphify is missing or stale, use scoped file search and continue.
Never interpret a missing index result as proof a function does not exist.
Generated summaries and graph edges are discovery hints, not authoritative contracts.

## Avoid repeated loading
AGENTS.md remains short. Full historical sources are loaded once during I0 or when needed.
Use architecture.md for common invariants and contract-decisions.md for unresolved details.
On a new session load the concise handoff rather than every past conversation.
Keep transient logs and screenshots out of standing agent context.

## Context precedence
User instruction → applicable repository instructions → accepted decision records →
current contracts → Phase 3 → Phase 2 → Phase 1 → extracted diagrams → retrieval summaries.
Surface conflicts rather than choosing silently.

## Miro
Use one exported frame per concern if provided. Pair each image with textual relationships.
Notion-extracted Mermaid diagrams are included for offline inspection.
Do not claim to have imported/read the existing Miro board.

