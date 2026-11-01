---
inclusion: always
---

# Facsimortis: Technical steering

## Stack (proposed; confirm in the first hour, then keep it)
- TypeScript everywhere (strict mode).
- React web app, small API server, SQLite for storage.
- Zod (or equivalent) for every schema.
- fast-check for property-based tests.

## Architecture rules
1. **Adapters for external services.** OCR and the extraction model each sit behind one interface with at least two implementations (the real service and a local or recorded fallback). The demo must never depend on a single live service.
2. **Sources come from OCR, not the model.** OCR returns words with IDs and boxes. The model returns field values and the word IDs it used. Ghost highlights are drawn from word IDs only. Never ask the model for coordinates.
3. **Citation check is mandatory.** Reject any field whose cited word IDs do not exist or whose cited words do not contain the value.
4. **Strict JSON from the model.** Validate against the schema; retry once on invalid output; then mark the fax "needs-review" instead of crashing.
5. **Validators are pure functions** in their own module (NPI check digit, DOB range, phone format). No I/O, no side effects.
6. **Audit trail is append-only.** Never overwrite an original extracted value.

## Testing
- Every validator has property-based tests.
- The synthetic fax generator is seeded, so runs are repeatable.
- An evaluation script reports field accuracy per degradation level. Do not weaken it to make numbers pass.
- Fix the code, not the test, unless the spec changes.

## Working agreements
- Small commits with clear messages; commit after each task in `tasks.md`.
- Never add `.kiro` or any subfolder to `.gitignore`.
- Secrets live in environment variables and `.env.example` documents them. Never commit keys.
- One-command local start, documented in the README. Keep it working at all times.
- Check library docs (via the docs MCP server) before using an unfamiliar API instead of guessing.
