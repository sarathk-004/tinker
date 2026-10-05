# Acceptance and verification matrix

Use real domain tests for rules, PostgreSQL integration tests for transactions/races,
browser end-to-end checks for critical UX, and controlled fake providers for AI failures.
A fake service cannot prove live auth/provider/deployment connectivity.

| ID | Trigger | Expected result | Stage |
|---|---|---|---|
| A01 | Insert Redis between connected nodes | One original edge removed, one node and two edges added | I2 |
| A02 | Insert with missing edge | Domain error; original document unchanged | I2 |
| A03 | Remove connected node | Node, incident edges and positions removed | I2 |
| A04 | Traverse cyclic graph | Terminates; each affected node appears once | I2/I6 |
| A05 | Refresh/restart after acknowledged save | Same canonical graph, presentation and version | I3/I4 |
| A06 | Two simultaneous writes at version n | Exactly one success; other conflicts; no overwrite | I3 |
| A07 | Simultaneous duplicate request key | Exactly one logical mutation/revision | I3 |
| A08 | Retry after commit but before response received | Stored original response returned | I3 |
| A09 | Reuse key with changed path/body/version | Key reuse rejected | I3 |
| A10 | Replay old success after newer edits | Original replay returned; client does not regress | I3/I4 |
| A11 | Force revision/response storage failure | Transaction rolls back diagram too | I3 |
| A12 | Expired AI lease and late original result | Only current lease can commit | I3/I5 |
| A13 | User accesses another workspace | No data exposure or mutation | I3 |
| A14 | Viewer attempts command/presentation/delete | Permission denied | I3 |
| A15 | Membership revoked before retry replay | Stored success does not bypass authorization | I3 |
| A16 | Drag-end save and command overlap | Client serialization/version checks prevent lost edits | I4 |
| A17 | Two tabs, stale local draft | Draft retained, conflict visible, no silent overwrite | I4 |
| A18 | Gemini unavailable | Manual editing and persistence still work | I4/I5 |
| A19 | AI emits malformed or unknown-node command | Validated rejection; diagram unchanged | I5 |
| A20 | AI exceeds total deadline | Timeout, no mutation, late result ignored | I5 |
| A21 | Diagram changes during interpretation | Conflict; no reapplication to different state | I5 |
| A22 | Duplicate/ambiguous node names | Clarification requested; no arbitrary match | I5 |
| A23 | Advisory question | Correct deterministic affected IDs; no version increment | I6 |
| A24 | Voice reconnect repeats final tool event | One mutation for logical event | I7 |
| A25 | Voice stops/connection fails | Session cleaned up; manual editor usable | I7 |
| A26 | Restore old revision | New version created; current version never decremented | I8 |
| A27 | Worker dies after claiming | Job recoverable after lease expiration | I8 |
| A28 | Old worker completes after reclaim | Stale publication rejected/idempotent | I8 |
| A29 | Cleanup runs twice | Same retained data; active reservations untouched | I8 |
| A30 | Scan built frontend/config | No Gemini/server/database secrets | I9 |
| A31 | Fresh install and migration | Documented run procedure works | I9 |
| A32 | Recovery drill | Measured RPO/RTO and restoration evidence | I9 |

## First working model demo
Sign in → create diagram → add Orders and PostgreSQL → connect →
insert Redis → move Redis → see Saved → refresh → reopen same state.
Open second tab; cause a version conflict; preserve draft and recover.
Disable AI provider; repeat manual add/save.

## Evidence rules
Record actual commands and concise outcomes in status.md.
Record missing credentials or unavailable services as blockers.
Do not check boxes from implementation alone.
Latency and availability targets require workloads/observations; passing unit tests is insufficient.

