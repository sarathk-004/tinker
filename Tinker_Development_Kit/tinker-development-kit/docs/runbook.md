# Local runbook and release checklist

Status: template to complete against the real repository; commands deliberately unfilled.

## Local operation
- Verify repository package manager/runtime from manifests and lockfiles.
- Document required environment variables with placeholder values only.
- Supply server-only database connection, managed auth configuration and Gemini credential as needed.
- Prefer local/disposable PostgreSQL and deterministic fake AI for automated checks.
- Apply migrations with the verified repository command.
- Start API and frontend with verified scripts; record ports and health endpoints.
- Demonstrate I4 before requiring live AI.
- Never mark in-memory repositories or hardcoded identity as production persistence/auth.

## Configuration inventory
Required concepts: DB URL; auth issuer/audience/public-key verification; allowed web origins;
API base URL; server Gemini credential/model; timeout/quota settings.
Exact variable names are chosen during I0/I1 and recorded here.
Browser variables contain only public configuration.
Do not log tokens, prompts containing private data, database passwords or audio content by default.

## Diagnostics
Log request/operation IDs, diagram/version outcome, elapsed time, sanitized provider errors,
conflicts and job attempts. Separate acknowledged save from pending optimistic state.
If a response is lost, reconcile via the original request key.
If version conflicts, retain draft and fetch latest. Do not blindly overwrite.
If AI times out, no graph mutation should have committed.

## Recovery
Verify backup/PITR capabilities before promising the Phase 1 RPO.
Practice restore into an isolated environment; measure elapsed time and lost-data window.
Deploy schema changes compatibly before code that requires them.
Recover expired reservations/jobs via fenced leases, never manual blind replay.
Soft-deletion recovery requires owner authorization and explicit policy.

## Deployment
Prepare compatible frontend/API/auth callback/origin configuration.
Verify managed hosting WebSocket and timeout limits before I7 release.
Inspect preview and critical paths. Verify the actual deployed health/frontend before reporting success.
Do not create paid resources solely to prepare docs.

