# Tinker development kit

Build-ready handoff for migrating the existing tinker prototype. Prepared 2026-10-05.
This package contains planning and agent context, not an implemented or tested application.

## Install in the existing repository
1. Copy docs/ into your repository. Merge AGENTS.md with any existing instructions; do not overwrite repository rules blindly.
2. Copy CLAUDE.md only after checking existing Claude instructions. Both entry points use the same project rules.
3. Start at docs/implementation-plan.md, milestone I0. Supply the repository to the agent.
4. Record the actual install/run/check commands in docs/repo-map.md after inspecting the repository.
5. Keep source snapshots for reference. Resolve architecture changes in decisions rather than silently editing historical sources.

## Reading map
| File | Purpose |
|---|---|
| AGENTS.md | Short standing instructions for Codex and other agents |
| CLAUDE.md | Entry point directing Claude to the same rules |
| docs/implementation-plan.md | Ordered tasks and acceptance gates |
| docs/status.md | Current progress; all implementation work initially unverified |
| docs/architecture.md | Agreed system constraints and boundaries |
| docs/contract-decisions.md | Proposed resolutions of Phase 3 gaps |
| docs/acceptance.md | Observable behavior and risk-focused verification |
| docs/repo-map.md | Populate from the actual repository |
| docs/context-workflow.md | Scoped retrieval and optional Graphify integration |
| docs/runbook.md | Local operation and recovery checklist |
| docs/sources/ | Snapshots of current Notion design pages |
| docs/diagrams/ | Mermaid extracted from Phase 3, not Miro exports |

## Development target
Keep the existing React canvas and useful interaction UX. Replace browser-owned Gemini calls and memory-only durability with one server command path and PostgreSQL. Preserve the ability to edit when AI is unavailable.

First durable working model = I0–I4. Typed AI = I5. Read-only advice = I6. Voice = I7. History/maintenance and release readiness = I8–I9.
No existing code was available for inspection when this kit was prepared.

## Source policy
User instructions take priority. Current repository instructions and recorded accepted decisions govern implementation. Phase 3 refines Phase 2 and supersedes preliminary Phase 1 choices. Earlier prototype descriptions are audit hypotheses until checked against code.
New technical choices in contract-decisions.md are proposals, not previously approved architecture. Resolve the relevant choices before implementing their module.
Miro URLs/images and the exact Graphify project have not been supplied.

