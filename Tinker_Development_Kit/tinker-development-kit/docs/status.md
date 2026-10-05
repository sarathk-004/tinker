# Development status

Updated: 2026-10-05
Active milestone: I2 implemented on branch `implementation-2` (stacked on `implementation-1`, which is stacked on `main`). Nothing pushed; awaiting user verification on localhost. Next: I3.
Branch stack: main (6e0130d) <- implementation-1 (800b847, 6e28119) <- implementation-2.

## See it locally
`npm run dev` (frontend, :5173) and `npm run dev:api` (API, :8787), then open http://localhost:5173/engine-demo.html and press the eight buttons. The main editor at `/` is unchanged until I4 wires it to the engine.

## I1 (done, see git log for 800b847): shared contracts, API foundation, boundary checks, CI. Migration scripts still unverified against a live Postgres.

## I2 completion record (verified 2026-10-05)
| Task | Paths | Verification |
|---|---|---|
| Extract framework-independent operations (add/remove/rename/update/connect/disconnect/insert/reset) | `server/src/modules/diagrams/domain/engine.ts` | `server/test/domain/engine.test.ts` |
| Injected ids; deterministic | `NewId` parameter; sequence-id tests | same input + id source gives equal output |
| Node deletion removes incident edges and position (P1, no bridging) | `engine.ts` removeNode | A03 test |
| Reject unknown endpoints, duplicates, self-loops, ambiguous inserts/disconnects, limits | `engine.ts` | A02 + parallel-edge + limit tests; every reason code asserted |
| Relationship/metadata policy | insert copies both onto both edges (D06) | A01 test |
| Downstream traversal with cycle protection | `domain/analysis.ts` | `analysis.test.ts` incl. A04 |
| Immutability, referential integrity, atomic failure | deep-frozen inputs; unchanged-JSON assertion after every error; post-condition check | purity test + helper in every test |
| Placement without overlap (P2) | `domain/layout.ts` | overlap test over 12 adds; found via browser check |
Commands: `npm run typecheck` PASS; `npm test` 67 PASS (shared 17, server 50); `npm run check:boundaries` PASS (legacy VITE_* warnings only); `npm run build` PASS and `dist/` holds only `index.html` (demo page excluded).
Gate: Orders -> PostgreSQL becomes Orders -> Redis -> PostgreSQL with one operation (test + live page); invalid operations leave the document unchanged (tests + live page: EDGE_REQUIRED and NODE_NOT_FOUND refusals). Live check was done by driving http://localhost:5173/engine-demo.html in the built-in browser against the running API: all 8 buttons behaved as described; Redis lands at (200,170), existing nodes did not move.

## Limitations / risks
- The engine is not yet reachable through the real command API (I3) or the editor (I4); only the dev preview exercises it.
- Dev routes are unauthenticated by design and only exist when NODE_ENV=development.
- Placement is a heuristic (nearest free spot); crowded diagrams may place nodes far from the midpoint. "Auto layout" (explicit full re-layout) is not built yet.
- `layoutGraph` uses dagre on the server; its output was only checked for determinism and non-overlap, not aesthetics.
- Migration tooling still unverified (no Docker daemon).

## Next action (I3)
Identity, persistence and the command API (needs a working Postgres and a Supabase project). Read D01-D06/D09-D10 (accepted in decisions.md) and Phase 3 sections 2, 5-7, 9, 13, 17. Prerequisites to confirm with the user: Supabase project URL/JWKS, Postgres for local/integration tests (start Docker Desktop or provide a database).

## Handoff template
- Active task / milestone:
- Completed behavior:
- Changed files / commit:
- Commands run and outcomes:
- Decisions accepted or changed:
- Blockers / verification not run:
- Next concrete task:
