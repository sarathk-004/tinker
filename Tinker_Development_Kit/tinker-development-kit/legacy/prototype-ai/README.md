# Prototype AI code (reference only, not compiled)

Moved out of `src/ai/` in I4 because it called Gemini directly from the browser with a browser-held key
(see docs/decisions.md and AGENTS.md). Nothing here is imported by the app.

Use as INPUT for the server-side implementation, never copy the browser transport:
- `tools.ts` - Gemini function declarations (the original command vocabulary) -> design the I5 structured-output schema.
- `prompts.ts` - system prompt and context shaping -> I5 prompt builder.
- `orchestrator.ts` - Gemini REST call, action dispatcher, and a regex "local rule engine" -> I5 parser fast path (explicit ids / unambiguous names).
- `geminiLive.ts`, `geminiVoice.ts` - browser WebSocket / TTS clients with the key in the URL -> I7 (server relay) design inputs only.
Original commit: 6e0130d (main before the migration).
