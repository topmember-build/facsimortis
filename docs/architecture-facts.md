# Architecture facts

A plain list of what is built in Facsimortis and how data moves through it, written from the code and config on branch `phase-1` (after task B1). There are no diagrams. "Not built" marks something that was planned but is not in the code. "Unknown" marks something not checked.

Facsimortis is a demo built on synthetic data. There is no server and no database: the reading is done ahead of time, and the site is static files.

## 1. Build-time pipeline (runs on a developer machine or in CI, never in the browser)

### Fax generator
- Folder: `src/generator/` (pure modules), CLI `src/scripts/gen-faxes.ts` (`npm run gen:faxes`).
- Builds synthetic referral faxes from a seeded PRNG: fake referral data, a Spleen bitmap font (`assets/spleen-16x32.bdf`), two templates (typed form, table form), a fax header, rotation, speckle, streaks and a stamp. The same seed gives the same bytes.
- Writes `fixtures/faxes/L1/fax-0001.png` and `fixtures/faxes/L2/fax-0002.png`, `fax-0003.png`, each with an answer-key file `<id>.truth.json` (the true values and the true word boxes).
- Degradation levels built: L1 and L2. A third level and a fourth sample fax (task 2.9): not built.
- A trap fixture is kept in `fixtures/traps/ambiguous-chars/` (fax-0001 with a slashed zero, from before 0.4.4).
- Boundary: pure functions; only the CLI writes files. It is the only code that writes answer-key files.

### Answer-key (ground truth) files
- Files: `fixtures/**/*.truth.json`.
- Who may read them: `src/scripts/proof.ts` (the only script) and some tests in `test/` (for example `extract-structure.test.ts`, `extract-typed.test.ts`, `fixtures.test.ts`, `ocr-local.test.ts`).
- Who may not: the precompute script, the sample schema, everything under `web/`, the records MCP server, the fax-qa agent and the demo capture tool. Enforced by ESLint rules on the word in code (`eslint.config.js`), by `src/scripts/read-guard.ts` (refuses any path containing it) for precompute and the MCP server, by static-scan tests, and by a deny rule in the fax-qa agent's permissions.

### OCR
- Folder: `src/ocr/`. One interface (`OcrAdapter`, words with `id`, `text`, `box`, `confidence`) with two implementations, chosen by `OCR_PROVIDER`:
  - `local` (default): Tesseract.js 7 (`src/ocr/local.ts`), offline, with the English data vendored in `assets/tessdata/eng.traineddata` and no cache writes.
  - `cloud`: a stub (`src/ocr/cloud.ts`) that makes no network call. A real cloud OCR service: not built.
- CLI: `npm run ocr` prints words with boxes for one fax.
- A recorded real OCR result is kept as a regression fixture in `fixtures/ocr/fax-0002.ocr.json`.
- Boundary: returns words and boxes only; it knows nothing about fields.

### Readers (extraction)
- Folder: `src/extract/`. One interface (`ExtractionAdapter`), chosen by `EXTRACT_PROVIDER`:
  - `rules` (default): the rule-based reader. It finds each field by its label in the OCR words and reads typed-form and table-form layouts, with page structure, overflow and "uncited words" checks (`rules.ts`, `labels.ts`, `layout-typed.ts`, `layout-table.ts`, `structure.ts`, `overflow.ts`, `uncited.ts`).
  - `model`: the live model reader (`model.ts`, `gemini.ts`). It calls Gemini over REST (default model `gemini-3.8-flash`, key from `EXTRACT_API_KEY`). The model gets the OCR words with IDs and returns, per field, a value and the word IDs it used, never coordinates. Replies are validated strictly with Zod; it retries once, then marks the fax needs-review.
  - `recorded`: the saved model answers (`recorded.ts`). It replays replies stored in `fixtures/extract/<sha256 of the OCR words>.json`, offline. Three are saved, one per sample fax.
- `npm run record:live` (`src/scripts/record-live.ts`) is run by a person, not by CI or an agent. It makes the live calls and saves the replies that pass the checks.
- Central checks, applied to every reader by `createExtractor` (`src/extract/index.ts`):
  - the citation check (`citation.ts`): every cited word ID must exist, and the cited words joined by single spaces must equal the value exactly, or the field becomes empty and flagged;
  - then the value checks (`checks.ts`): NPI, date of birth and callback phone. A failing value is kept as read and gets one plain flag.
- Flag texts for the value checks: `src/validators/messages.ts`, shared with the site.
- Boundary: values come only from cited OCR words; nothing is repaired or guessed. `src/` code outside `src/eval/` may not import `src/eval/`.

### Validators
- Folder: `src/validators/` (`npi.ts`, `dob.ts`, `phone.ts`, `messages.ts`).
- Pure functions: NPI check digit (Luhn with the 80840 prefix), date of birth (MM/DD/YYYY, not in the future, not more than 120 years ago, "today" passed in), and phone (`NNN-NNNN`, `NNN-NNN-NNNN` or `(NNN) NNN-NNNN`, nothing normalised).
- Property-based tests with fast-check.
- Boundary: no I/O and no imports from the rest of the pipeline. The site imports them directly.

### Precompute
- Files: `src/scripts/precompute.ts` and `precompute-lib.ts` (`npm run precompute`; `-- --check` exits non-zero if the committed data is out of date).
- For each fax in `fixtures/faxes/`, it runs local OCR and both offline readers (`rules` and `recorded`) with the central checks. "Today" is the generator's `REFERENCE_DATE` constant (2026-10-01), not read from any fax.
- Writes `web/public/samples/`:
  - `index.json`: the fax list, the reference date and the demo clock's received times (09:00, then every 7 minutes);
  - for each fax, `<id>.json` (its OCR words with boxes and both readers' results) and `<id>.png`.
- Output is validated with the Zod schemas in `src/samples/schema.ts` (`SAMPLE_DATA_VERSION` 2) and is byte-for-byte deterministic. The data folder is committed.
- Boundary: reads only through `read-guard.ts`, which refuses answer-key files. Blocks `fetch` (no network), never calls the live model and ignores `.env`.

## 2. Browser app

- Folder: `web/` (Vite 8, React 19, TypeScript strict). Built to `dist/web/`.
- Deployed by `.github/workflows/pages.yml` on a push to `main`: `npm ci`, the precompute check, the tests, then a build with `SITE_BASE=/facsimortis/`. Public URL: https://topmember-build.github.io/facsimortis/.
- Boundary: `web/src` may import from `src/` only `src/samples/schema`, `src/extract/schema` and `src/validators/{npi,dob,phone,messages}`. No Node built-ins, no Tesseract, no readers, no scripts (`eslint.config.js`). Nothing under `web/` may mention `tools/` (`test/mcp-records-deps.test.ts`).

### What it loads
- `samples/index.json`, then each fax's JSON, from `${BASE_URL}samples/`, each validated with Zod (`web/src/data.ts`). The fax PNG is shown as an image.
- Nothing is computed from the image in the browser: OCR words, boxes, values and flags all come from the precomputed JSON.
- No live API calls and no upload. Upload: not built (out of scope for the static site).

### Screens
- Boot screen:
  - shown once per browser session (`sessionStorage` key `facsimortis:booted`);
  - skipped with `?skipboot`;
  - moves on by itself after 5 s.
- Inbox shown as a desktop:
  - two faxes at the start; the "Incoming fax" button reveals the third (in memory only);
  - a taskbar.
- Review screen:
  - the fax with source ghosts (highlights drawn from the cited word IDs' boxes only);
  - a source string from the selected card to its words;
  - the field cards, the summary bar and Verify record.
- A Synthetic data banner on every screen; sticky on the review screen (B1).
- The dial-tone waveform loading state from the design steering: not built ("Receiving fax…" text is shown instead).

### The two readers
- "Model answers" (the `recorded` reader's saved answers, the default) and "Rules reader", switched on the review screen.
- The choice is app-level, so the inbox counts follow it.

### Flags
- The flags shown are the ones precomputed for each reader.
- A reviewer's edit is checked again in the browser with the same validators (`web/src/edit-check.ts`). A bad edit is flagged again.
- Low confidence is shown on each card but raises no flag. A confidence flag (task 1.2): not built (deferred).

### Review state
- Append-only list of actions per fax and reader (`web/src/review-state.ts`):
  - `accepted`: original value, accepted despite a failed check, which checks failed, time;
  - `edited`: original value, new value, time.
- Original values are never overwritten.

### Storage (format v4)
- `localStorage` keys `facsimortis:v4:<faxId>:<reader>` (`web/src/storage.ts`), holding the review state and the verified record.
- v3 entries are migrated. v1 and v2 entries, and entries from different sample data, are not used: a plain note is shown once, then they are removed.
- If the browser blocks storage, progress is kept in memory with a plain note.
- All of this lives in this browser only.

### Verify
- "Verify record" is enabled only when no flagged field is left unreviewed.
- It builds the verified record (`web/src/record.ts`):
  - the seven fields with original value, word IDs, confidence, original flags, final value and source (`page` or `reviewer`);
  - accepted despite flag, failed checks, the actions, a summary;
  - verifier "Demo reviewer" (a fixed label; there are no accounts) and the verify time.

### Laid to rest
- The verified state: read-only, with the summary and the fields accepted although a check failed.
- The window title reads "<id> — laid to rest".

### Audit JSON export
- "Download JSON" on the Laid to rest panel saves `facsimortis-<fax>-<reader>-verified.json`, the record as above. It is the only export.
- The `./export` icon and the taskbar Export button in `docs/design-brief-amber.md`: not built.
- FHIR-style export: not built.
- A server-side audit trail and data model (task 1.4): not built. The edit record exists only in the browser and in the downloaded file.

## 3. Proof and evaluation

### Gate proof
- Files: `src/scripts/proof.ts` and `proof-core.ts` (`npm run proof`, `-- --reader recorded` for the saved model answers with the network blocked).
- Runs the three fixture faxes end to end (OCR, reader, central checks) and judges the hard gate. Every value cites existing words that contain it; absent fields are null and flagged; the bad NPI is flagged.
- Also reports a measured tier: exact matches, unflagged misreads and correct-but-flagged.
- Exits non-zero on a hard-gate failure.
- Boundary: reads the answer-key files (the only script that may), and passes them into the pure `proof-core.ts`. Ignores `.env` and works offline. Reader code never sees the answer key.

### Evaluation code
- Folder: `src/eval/` (`align.ts`, `match.ts`, `confidence.ts`): word alignment between OCR and the answer key, and confidence analysis. Pure, no I/O.
- Imported only by tests (for example `test/eval-align.test.ts`, `test/ocr-local.test.ts`).
- Boundary: nothing else under `src/` may import it (ESLint).
- An evaluation script that reports field accuracy per degradation level (task 1.5): not built. A hook that re-runs it (task 1.8): not built.

## 4. Developer tools

### Records MCP server
- Folder: `tools/mcp-records/` (`server.ts` on `@modelcontextprotocol/server` 2.4.0; `tools.ts`, the five tools as plain functions with Zod schemas; `data.ts`).
- Read-only, stdio. Registered in `.kiro/settings/mcp.json` as `facsimortis-records` (`node --import tsx tools/mcp-records/server.ts`), with autoApprove for all five tools.
- Tools:
  - `list_samples`: ids, levels, received times, reader status and flag counts;
  - `get_result(sample, reader)`: values, confidence, flags and cited words;
  - `explain_flag(sample, field, reader)`: a plain explanation of one flag;
  - `check_npi(npi)`: the check-digit result and the expected digit;
  - `export_summary(sample)`: the readers' results as read, not reviewed.
- Boundary: reads only the committed `web/public/samples/` JSON through `read-guard.ts`, and imports only the sample and field schemas, the validators and the guard. No network, no `.env`, no `process.env`, no answer-key files, writes nothing (ESLint and tests).

### Demo capture
- Folder: `tools/demo-capture/` (`npm run demo:check`, `npm run demo:capture`, `npm run demo:probe`; see its README). It uses `playwright-core` 1.65.1 (dev only) with the installed Chrome, plus ffmpeg.
- Records the six demo scenes from the `/facsimortis/` production build, which it builds into `demo-out/site` and serves with `vite preview`.
- Boundary:
  - every file read and write goes through `paths.ts` and stays inside `demo-out/` (git-ignored);
  - no answer-key or fixture files, no `src/`, `web/` or `fixtures/` imports (ESLint and a static scan);
  - nothing in the site imports it.

## 5. Kiro layer

### Specs
- Folder: `.kiro/specs/facsimortis/`. Contents:
  - `requirements.md` (requirements R1 to R10 with their status and original text);
  - `design.md`;
  - `tasks.md` (the tracker);
  - `tasks.meta.json` (Kiro's task execution history).
- Boundary: the source of truth; if code and spec disagree, the user decides which changes (product steering).

### Steering
- Folder: `.kiro/steering/`. Files:
  - `product.md` (always included): persona, workflow, the hard rules (synthetic data only, never invent values, no compliance claims, cut anything not in the demo script) and plain language;
  - `tech.md` (always included): stack, architecture rules, testing and working agreements;
  - `design.md` (included for `**/*.tsx` files): palette roles, accessibility, copy and the five screen states.
- The steering asks to check library docs through a "docs MCP server". No such server is in the workspace `mcp.json`. Whether one is in the user-level config: unknown.

### Hooks
- Folder: `.kiro/hooks/`. All three run on save, with an agent action that is read-only by its prompt:
  - Proof guard (`proof-guard.json`): saving a file under `src/extract`, `src/ocr`, `src/validators` or `src/generator` runs `npm run proof -- --reader recorded` and explains a failed hard-gate check.
  - Repo safety guard (`repo-safety-guard.json`): saving `.gitignore` or any `.env*` file checks that `git check-ignore .kiro` prints nothing and that only `.env.example` is tracked.
  - Design token guard (`design-token-guard.json`): saving `web/src/theme.css` or `styles.css` runs the theme, ghost, field-column and D4c stylesheet tests and reports which colour pair or rule broke.
- Record: `docs/kiro-hooks.md`.

### fax-qa agent
- File: `.kiro/agents/fax-qa.md`, opened from the agent picker.
- Given a sample id, it compares the model and rules readers with the five `facsimortis-records` tools. It lists disagreements, unflagged fields below 0.85 confidence (a line for the note, not an app rule) and failed NPI checks, and writes a short QA note in a fixed format. It reports date of birth and phone as "not re-checked: no tool".
- Limits, set in its own definition:
  - its tools are only the five MCP tools;
  - `write`, `shell`, `web` and `subagent` are excluded;
  - all built-in capabilities are denied, and so is reading `.env` files and answer-key files;
  - steering is `product.md` only.
- It never invents or corrects a value. Its refusal is one fixed sentence.
- Record: `docs/fax-qa-agent-check.md`.
