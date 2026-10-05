# Development status

Updated: 2026-10-05
Active milestone: I4 implemented on branch `implementation-4` (stack: main <- implementation-1 <- 2 <- 3 <- 4). Branches 1-3 are pushed; implementation-4 is committed locally and NOT pushed. Next: I5 (typed command interpretation through the server).

## See it locally
Terminals: `npm run dev:db -w @tinker/server` (once: `npm run db:migrate -w @tinker/server`), then `npm run dev:api:supabase` (your Supabase project) or `npm run dev:api` (local dev login), then `npm run dev`, and open http://localhost:5173/ . The main editor is now the durable editor. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` to the root `.env` (restart `npm run dev`), or enter them once on the sign-in screen. Remove the old `VITE_GEMINI_*` lines from that `.env` (LC18). The dev pages `engine-demo.html` and `api-demo.html` still exist for debugging.

## I4 completion record (verified 2026-10-05)
| Task | Where | Evidence |
|---|---|---|
| Login, workspace and diagram loading using the existing UI | `LoginScreen`, `DiagramBar`, `workspaceStore`, `App` | Live: dev login -> workspace -> first diagram auto-created; list/switch/new/rename inline; refresh keeps the session and reopens the last diagram |
| Canonical graph + presentation mapped into React Flow | `diagram/adapters.ts`, `diagram/store.ts` | `adapters.test.ts` (12 tests) + live canvas |
| Every structural UI action through the command client | `diagram/store.ts` -> `document/session.ts` -> `api/client.ts` | Live: add, edit dialog (rename/subtype/connect), advisor multi-step action, keyboard delete of a connected node (one REMOVE_NODE, no stray errors), all reach `Saved`; the database shows matching versions, revisions and command records |
| Serialized per-diagram writes incl. drag-end and metadata | `session.ts` queue | `session.test.ts` (19 tests): ordering with expected versions 1,2,3; coalesced drags; a drag is ordered before a following command; positions of removed nodes never sent |
| Optimistic state separate from acknowledged; stable keys; reconcile full documents | session overlay + queue | tests above; live: a dragged position persisted across refresh |
| Preserve draft and stop queued writes on conflict; reload/recovery | `session.ts`, `StatusBanners` | Tests (conflict stops the queue, draft stored, reload, re-apply, stale position save conflicts) + live two-tab demo: stale tab refused, nothing overwritten, "Re-apply" produced both tabs' work (4 nodes) |
| pending/saved/failed status, safe navigation | `SaveBadge`, `App` listeners | Live: Saved / Not saved - Retry; a lost response retried 6 times with one key left exactly ONE new node in the database. `beforeunload` guard and switch-diagram flush are implemented (the browser prompt itself was not exercised live) |
| Remove direct browser Gemini calls | `src/ai/*` moved to `legacy/prototype-ai/`; Settings modal and VoiceControl deleted | `check:boundaries` with zero exemptions plus new rules (no Gemini endpoints/SDKs in `src`; no whole-`import.meta.env`); build output has no Gemini key shapes; manual editing works with AI disabled |
Commands: `npm run typecheck` PASS; `npm test` PASS (shared 17, server 113, frontend 42); `npm run check:boundaries` PASS; `npm run build` PASS.
Gate: sign in, create a diagram, add/connect/edit/drag, refresh and recover the same diagram (verified); two-tab stale write with no silent overwrite (verified live); manual editing works with AI disabled (the command bar is visibly disabled).
Review findings fixed during I4: aliasing the whole `import.meta.env` in `config.ts` would have embedded every VITE_* variable from a developer's `.env` (including a stale Gemini key) in the bundle; the edit dialog listed raw UUIDs. Both fixed; the first now has a permanent guard.

## Limitations / risks (see later-checks.md LC14-LC21)
- Typed and voice commands, undo, and the Conversation tab are off until I5/I7/I8.
- Structural edits wait for the server (no ghost nodes); felt latency is unmeasured against the hosted API.
- Not exercised: the mouse drag-to-connect gesture, multi-select delete, the unsaved-work `beforeunload` prompt, Supabase sign-up and email-confirmation flows.
- No automated browser tests yet (LC16); the live verification was manual through the built-in browser.
- The dev API signing key changes on every API restart, so local dev sessions end on restart.
- The user's own Supabase-mode API and Vite were left untouched; verification used a separate dev API (:8788) and Vite (:5174).

## Earlier milestones (details are in git history and decisions.md)
- I1: shared contracts, API foundation, boundary checks, CI. I2: pure diagram engine. I3: Postgres persistence, identity, authorization, idempotent command API, RLS. Supabase project `rnwbgjrzbliqvqradjcm`: schema applied, RLS on all tables, real login and persistence verified by the user, signing-key rotation logic verified locally (`server/test/key-rotation.test.ts`).
- Open items from those milestones live in docs/later-checks.md (transaction pooler, real key-rotation drill, CI first run, TLS verify mode, latency, backups, Gemini model id, AI caps, member management, revision semantics).

## Next action (I5)
Provider gateway interface plus a deterministic fake; parser fast path (explicit ids / unambiguous names); server-side Gemini with validated structured output; interpretation bound to the captured diagram version; stable request body and hash across retries; 15 s deadline, cancellation, rate limit (10/min) and concurrency cap (2); clarification for ambiguous names; persisted conversation turns. Needs a server-side Gemini key for the live smoke test (fake-provider tests do not prove connectivity) and current Gemini docs (LC8). Reference material: `legacy/prototype-ai/`.

## Handoff template
- Active task / milestone:
- Completed behavior:
- Changed files / commit:
- Commands run and outcomes:
- Decisions accepted or changed:
- Blockers / verification not run:
- Next concrete task:
