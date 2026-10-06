# Verified repository map

Status: POPULATED in I0 on 2026-10-05 against commit `6e0130d` (branch `main`, remote `origin` = github.com/sarathk-004/tinker).
Repository root = the directory containing `package.json`; the dev kit lives untracked in `Tinker_Development_Kit/`.
Retrieval index: `graphify-out/` built from `6e0130d` on 2026-10-05 (333 nodes). Refresh after code changes (`graphify <path> --update`). Index is a hint; verify with rg.

## Verified commands (cwd = repo root, npm 11 / Node 24; lockfile = package-lock.json)
| Purpose | Command | Baseline result (2026-10-05) |
|---|---|---|
| Install | `npm ci` | node_modules present; not re-run |
| Dev server | `npm run dev` (vite) | not run in I0 |
| Build + typecheck | `npm run build` (`tsc -b && vite build`) | PASS, 37s; 526 kB JS chunk warning (>500 kB) |
| Preview | `npm run preview` | not run |
| Typecheck all workspaces | `npm run typecheck` | PASS (I1) |
| Tests (Vitest: shared, server) | `npm test` | 295 tests PASS (I5: shared 17, server 220, frontend 58 via `npm run test:web`; server tests start an isolated real Postgres) |
| Boundary check | `npm run check:boundaries` (`--strict` fails on legacy VITE_* key refs) | PASS (I1) |
| API dev server | `npm run dev:api` (server/.env from server/.env.example; needs `dev:db` first) | /health, /health/ready 200 verified (I3) |
| Local database | `npm run dev:db -w @tinker/server` (embedded Postgres 18.4 on :54329, data in `server/.data/`) | running; migrations up/down/up verified |
| DB migrate | `npm run db:migrate -w @tinker/server` (reads `server/.env` DATABASE_URL) | PASS on Postgres 18.4 |
| CI | `.github/workflows/ci.yml` | not yet run on GitHub |
| Lint / format | none | no eslint config |

## Entry points and concerns
| Concern | Path | Notes |
|---|---|---|
| App shell | `src/main.tsx`, `src/App.tsx` | Header, Sidebar, Canvas, ManualToolbar, CommandBar, SettingsModal |
| Canvas / React Flow | `src/components/DiagramCanvas.tsx`, `AWSArchitectureNode.tsx`, `src/components/icons/*` | official AWS icons; keep |
| Graph + working state (Zustand) | `src/diagram/store.ts` (789 lines), `src/types/diagram.ts` | mixes domain rules, dagre layout, highlight/flow animation, undo history |
| Layout | `src/diagram/layout.ts` | dagre, 220x90 nodes, re-run on nearly every mutation |
| Conversation store | `src/ai/conversationStore.ts` | in-memory, ids `turn_<Date.now()>_<rand>` |
| AI orchestration + local rule engine | `src/ai/orchestrator.ts` (762 lines), `src/ai/prompts.ts`, `src/ai/tools.ts` | browser REST call to Gemini + regex fallback, both mutate store directly |
| Voice | `src/ai/geminiLive.ts` (WS, key in URL), `geminiVoice.ts` (TTS REST, key in URL), `audioRecorder.ts`, `speechSynthesis.ts`, `src/components/VoiceControl.tsx`, `CommandBar.tsx` | |
| Settings / secrets UI | `src/components/SettingsModal.tsx` | stores key in localStorage (`tinker_gemini_api_key`, `tinker_gemini_key`) |
| Build config | `vite.config.ts`, `tsconfig.json` (strict, noUnused*), `tsconfig.node.json`, `tailwind.config.js`, `postcss.config.js`, `vercel.json` (SPA rewrite) | |
| Shared contracts (Zod schemas, DTOs, errors, limits) | `shared/src/*` (`@tinker/shared`); frontend door `src/contracts/index.ts` | |
| Backend | `server/src/{app,main}.ts`, `infrastructure/{config,http,auth}`, `modules/diagrams/http` | Fastify 5 |
| Diagram engine (pure) | `server/src/modules/diagrams/domain/{engine,layout,analysis,types}.ts` | I2 |
| Dev engine preview (localhost, dev only) | `engine-demo.html`, `src/dev/engine-demo.ts`, `server/src/modules/diagrams/http/dev-routes.ts` | http://localhost:5173/engine-demo.html with `npm run dev` + `npm run dev:api` |
| Browser API client, document session, auth, workspace store, editor view | `src/api/client.ts`, `src/document/{session,instance}.ts`, `src/auth/auth.ts`, `src/workspace/workspaceStore.ts`, `src/diagram/{store,adapters,flow,inference}.ts`, `src/config.ts` | I4 (replaces the prototype store and the `src/ai` Gemini code) |
| Login, diagram bar, banners | `src/components/{LoginScreen,DiagramBar,StatusBanners}.tsx` | I4 |
| Prototype AI code (reference only) | `Tinker_Development_Kit/tinker-development-kit/legacy/prototype-ai/` | not compiled; input for I5/I7 |
| AI: parser, prompt, plan executor, provider gateway, service | `server/src/modules/ai/{domain,application,providers,persistence}`, `server/src/infrastructure/http/concurrency-limiter.ts`, `shared/src/ai.ts` | I5 |
| Read-only advice (ask) and graph analyzer | `server/src/modules/analysis/graph-analyzer.ts`, `server/src/modules/ai/application/{advice,advice-service,provider-call}.ts`, `src/ai/{aiCommands,questions}.ts` | I6 |
| Release checks and operations | `scripts/{check-artifacts.mjs,fresh-setup-check.sh}`, `server/scripts/{smoke-api,check-production-mode,bench-api,backup-drill,log-report}.ts`, `server/src/infrastructure/{backup,observability}/*` | I9 |
| Hosting files | `Dockerfile`, `.dockerignore`, `docker-compose.preview.yml`, `railway.json`, `public/_headers`, `public/_redirects`, `.github/workflows/ci.yml`, `.gitattributes` | I9 |
| Sign-in (password, Google, reset) | `src/auth/auth.ts`, `src/components/LoginScreen.tsx` | I4, I9 |
| History, restore, undo/redo | `shared/src/history.ts`, `server/src/modules/history/*`, `src/history/history.ts`, `src/components/VersionsPanel.tsx` | I8 |
| Background jobs and worker | `server/migrations/1761000000000_jobs.sql`, `server/src/modules/jobs/{queue,handlers,worker}.ts`, `server/src/worker.ts` | I8 |
| Voice: contract, gateway, session, routes | `shared/src/voice.ts`, `server/src/modules/voice/{live-gateway,gemini-live,fake-live,voice-session,routes,speech-provider,speak-service}.ts` | I7 |
| Browser voice (capture, client, UI) | `src/voice/{pcm,capture,voiceClient,voice,speech}.ts`, mic button in `src/components/CommandBar.tsx` | I7 |
| Browser typed commands and conversation | `src/ai/{aiCommands,conversationStore}.ts`, `src/components/CommandBar.tsx` | I5 |
| Live Gemini smoke test | `server/scripts/check-gemini.ts` (`npm run check:gemini`) | needs GEMINI_API_KEY; not yet run |
| Persistence, idempotency, identity, access | `server/src/infrastructure/{database,idempotency,auth}`, `server/src/modules/{identity,workspaces}`, `server/src/modules/diagrams/{application,persistence,http}`, `server/migrations/*.sql` | I3 |
| Dev saved-diagrams preview (localhost, dev only) | `api-demo.html`, `src/dev/api-demo.ts`, `src/dev/diagram-svg.ts` | http://localhost:5173/api-demo.html |
| DB migrations | `server/migrations/` (empty until I3), `docker-compose.yml` | |

## Mutation entry points (every call that changes the diagram)
Store actions: addNode, removeNode, deleteSelected, updateNode, connect, disconnect, renameNode, insertBetween, groupNodes, reset, undo, applyLayout, setNodes, setEdges. (highlight/clearHighlight/playFlow/setSelectedNodeIds are transient.)
| Caller | Actions |
|---|---|
| `src/components/DiagramCanvas.tsx` | undo, deleteSelected, connect (drag edge), removeNode (node delete), disconnect (edge delete), setSelectedNodeIds; React Flow drag/position changes via setNodes |
| `src/components/ManualToolbar.tsx` | addNode, groupNodes, deleteSelected, applyLayout, undo, playFlow |
| `src/components/NodeEditModal.tsx` | updateNode, connect, removeNode |
| `src/components/AWSArchitectureNode.tsx` | removeNode, setSelectedNodeIds, playFlow |
| `src/components/SidebarPanel.tsx` (advisor "apply suggestion" buttons, ~L142-242) | insertBetween, addNode, connect |
| `src/components/Header.tsx` | reset |
| `src/ai/orchestrator.ts` Gemini path `executeFunctionCall` (L225-290) | addNode, removeNode, connect, disconnect, insertBetween, renameNode, highlight, reset |
| `src/ai/orchestrator.ts` local rule engine (L300-620) | reset, connect, insertBetween, renameNode, removeNode, disconnect, addNode, highlight, playFlow; seeds sample templates |
| `src/ai/geminiLive.ts` tool handler (L160-200) | addNode, removeNode, connect, disconnect, insertBetween, renameNode, highlight, reset |

## Migration inventory (keep / extract / replace)
| Module | Decision | Rationale |
|---|---|---|
| Canvas, node renderer, AWS icons, toolbar, header, logo, typewriter prompt | KEEP | rewire to command client in I4 |
| `store.ts` graph mutations + `types/diagram.ts` domain fields | EXTRACT to framework-independent engine (I2), then REPLACE store mutations with command client | semantics catalogued below |
| `store.ts` highlight/playFlow/selection/activeAction | KEEP as ephemeral UI state | playFlow ordering logic could move to analyzer later |
| `layout.ts` (dagre) | KEEP; generates initial presentation positions | see decision D-L1 |
| `store.ts` `inferAWSDetails`, `sanitizeId/Label` | EXTRACT (inference to shared/server defaults; sanitizeId replaced by UUID + name resolution) | |
| `orchestrator.ts` regex rule engine | EXTRACT to server parser fast path (I5) | |
| `orchestrator.ts` Gemini REST, `tools.ts`, `prompts.ts` | REPLACE with server gateway; reuse tool declarations/prompt text as input to schema design | |
| `geminiLive.ts`, `geminiVoice.ts` | REPLACE transport (server relay, I7); keep UX and audio capture (`audioRecorder.ts`) | |
| `SettingsModal.tsx` API-key field, `VITE_GEMINI_*` env | REMOVE from production path (keep model/voice prefs only) | |
| `conversationStore.ts` | REPLACE with server-persisted turns; keep as client view cache | |
| undo history (client snapshots, 30 deep) | REPLACE by revision restore (D06/I8); local undo not in command union | |

## Prototype semantics to preserve or consciously change (inputs to I2)
- addNode: existing id => silent no-op returning existing id. insertBetween with existing newNode id replaces that node. IDs = sanitized lowercase label, fallback `node_<Date.now()>`.
- connect: self-loop silently ignored; duplicate = same source+target+label; edge id `e_src_tgt[_label|_<Date.now()>]`; optional label and `bidirectional` flag (markerStart). Endpoints are NOT validated to exist.
- disconnect: removes edges in BOTH directions between the pair.
- insertBetween: deletes all edges between pair (both directions), adds two plain edges (relationship/label lost); no check that the edge existed or nodes exist.
- removeNode: removes incident edges AND by default bridges every incoming->outgoing pair (animated edge) unless `reconnectBridge:false`. (Conflicts with I2 bullet "remove incident edges".)
- renameNode: re-infers awsIcon and subType from the new name, overriding user choices.
- groupNodes: just overwrites `subType` with the group name (not a real group).
- reset: clears graph; undo/history is client-only.
- NodeKind: 9 values (client, gateway, service, database, cache, queue, storage, external, generic); Gemini tool enum omits `external`.
- Presentation: dagre auto-layout recomputed on almost every mutation, positions stored inside React Flow nodes; no user-drag persistence beyond memory. Highlight/dim stored on node.data (must stay transient).
- Edge styling (stroke, markers, animated) is stored on edges; presentation-only.

## Persistent data / legacy IDs
No durable diagram data exists (store is memory only, no persist middleware, no localStorage diagrams). Only localStorage keys: Gemini API key(s), audio model, voice name, TTS mute. => No legacy diagram import needed; I4 import task is N/A unless the user has external exports. Legacy human IDs only appear in prototype sessions and prompts.

## Security findings (production blockers, I4/I7)
- `VITE_GEMINI_API_KEY` read in orchestrator.ts, geminiVoice.ts, SettingsModal.tsx; `.env` is gitignored and `dist/` currently contains no `AIza...` key string.
- Keys are put in URL query strings for REST (orchestrator.ts:157, geminiVoice.ts:228, SettingsModal.tsx:72) and WS (geminiLive.ts:25).
- Gemini model id `gemini-3.8-flash` is used throughout; confirm against provider docs at I5.

## Baseline failures
None observed (build passes). Gaps: no automated tests, no lint, no CI, 526 kB bundle.
