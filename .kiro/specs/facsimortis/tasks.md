# Facsimortis: Tasks

Order matters. Runtime proof first, interface second, polish last.

## Phase 0: First hour (runtime proof, no UI)

- [x] 0.1 Create repo with open-source license, README stub, and `/.kiro` committed in the first commit. Confirm `.kiro` is not in `.gitignore`. (R9)
- [x] 0.2 Write steering docs: `product.md`, `tech.md`, `design.md`. (Kiro write-up)
- [x] 0.3 Build the generator for 3 synthetic faxes with one degradation level. (R8)
  - [x] 0.3.1 Validators and data: pure NPI check-digit module, seeded PRNG, fake referral data; property tests for NPI and DOB. No images. (R4.1, R8)
  - [x] 0.3.2 Font and drawing: Spleen BDF parser, 1-bit page buffer, PNG encoding with SYNTHETIC tag, text drawing with word boxes; tested on one plain page. (R8)
  - [x] 0.3.3 Templates: typed and table forms on an unskewed page, word IDs and per-field value word IDs; citation tests. (R8)
  - [x] 0.3.4 Degradation: fax header, mapBox and page rotation, speckle, streaks, stamp that avoids field values; unit tests. (R8)
  - [x] 0.3.5 Fax builder: buildFax, truth.json format, phase0Specs; determinism and trap tests. (R8)
  - [x] 0.3.6 CLI and checks: gen:faxes writes the 3 Phase 0 fixtures; determinism and citation tests; README update; visual check of one PNG. (R8)
- [x] 0.4 OCR one fax and print words with boxes. (R2)
  - [x] 0.4.1 OCR adapter interface: OcrWord {id, text, box, confidence}, OcrAdapter, cloud adapter stub, adapter selection from OCR_PROVIDER; unit tests. No Tesseract yet. (R2.1, R2.3)
  - [x] 0.4.2 Vendor English language data: tessdata_fast eng.traineddata and its Apache-2.0 LICENSE in assets/tessdata/, with source and checksum recorded. (R2.1)
  - [x] 0.4.3 Tesseract.js local adapter: offline (local langPath, no cache writes, no downloads), words mapped to fax pixel coordinates with 0..1 confidence; tested against fax-0001 truth. (R2.1)
  - [x] 0.4.4 Plain zero in the generator: save the slashed-zero fax-0001 as an ambiguous-chars trap fixture, override the 0 glyph in font.ts, regenerate fixtures with truth text and boxes unchanged, re-measure OCR on all three faxes. (R2.1, R8)
  - [x] 0.4.5 ocr CLI: npm run ocr prints words with boxes and confidence for one fax; README update. (R2.1)
  - [x] 0.4.6 Confidence analysis and merged-word matching: many-to-one OCR/truth word mapping, confidence of misread vs correct field-value words on all three faxes, report at the spec threshold 0.85 without tuning. (R5.1, R2.1)
- [x] 0.5 Extract all fields with word IDs from that fax. Print them. (R3)
  - [x] 0.5.1 Extraction schema and interface: Zod Field and ExtractionResult schemas from design.md, ExtractionAdapter and ExtractionError, EXTRACT_PROVIDER selection, .env.example update; tests. (R3.1)
  - [x] 0.5.2 Label matching and typed-form layout: find each field by its label in the OCR words (small tolerance on label text only), read typed-form values below the label inside its box, value is the cited words as read with no repairs, null plus a plain flag when absent; unit tests and typed-form truth-words layout test. (R3.1, R3.2, R3.4)
  - [x] 0.5.3 Table-form layout and never-invents property: read table-form values to the right of the label on the same row, wrapped lines included; truth-words layout test for the table form and a fast-check property that no value contains text outside its cited words. (R3.1, R3.2, R3.4)
  - [x] 0.5.4 Page structure: pure module that groups all matched labels into columns, decides the page layout from all labels, derives each field's right and bottom limits from every matched label, and marks each side open or closed; unit tests. No change to extraction output yet. (R3.1)
  - [x] 0.5.5 Structure in the readers and ambiguous layout: readers use the page limits; a field whose layout is ambiguous (long typed value near its label line at 3 degrees, or a stray word on a typed label line) is null with a plain flag; clean fixtures stay exact. (R3.1, R3.4)
  - [x] 0.5.6 Overflow detection: pure function that, for a typed field, finds a run of value words starting inside the field and continuing across its right limit with normal word spacing; unit tests only, no change to extraction output. (R3.1)
  - [x] 0.5.7 Overflow wiring and flags: call findOverflow in the typed reader; a field whose value runs past its right limit is null with a plain flag, any other field whose value words include a word from that run is flagged; overflow and overflowFrom in details; the three fixtures read exactly as before; existing tests pass unchanged. (R3.1, R3.4)
  - [x] 0.5.8 Overflow tests: case A extended to values of 9 to 12 words at 0 and plus or minus 3 degrees; no wrong unflagged value; counts of overflow flags, neighbour flags and correct values flagged. (R3.1, R3.4)
  - [x] 0.5.9 Extract CLI and measurement: npm run extract prints fields with cited word IDs, confidence and flags; OCR plus extraction on all three faxes reports exact matches, nulls, unflagged misreads by name, and correct values that were flagged. No thresholds. (R3.1)
  - [x] 0.5.10 No silent drops: any OCR word inside a field's value region that is not cited is either included or makes the field flagged; regression test built from fax-0002's recorded real OCR output as a synthetic fixture (referring provider must not come back as an unflagged "Family Clinic"). (R3.1, R3.4)
- [x] 0.6 Reject any field whose cited words do not contain its value. (R3.2)

**Hard gate** (do not start the UI until all are true):

- Every field with a value cites OCR word IDs that exist, and the cited words contain the value.
- Nothing is invented: every value comes from the cited words on the page.
- An absent field is null and flagged with a plain-language reason.
- The `bad-npi` fax is flagged for its NPI.
- `npm run proof` works from a clean clone.

**Measured and reported in Phase 0, not pass or fail:**

- Field exact-match rate against truth.json.
- Unflagged misreads (goal: zero; owned by task 1.2). The proof output lists each one by fax and field name.
- Correct values that were flagged.

Do not tune thresholds or add repairs to reach zero on the three Phase 0 faxes.

- [x] 0.8 Gate proof (done before 0.7). (R4.1, R9)
  - [x] 0.8.1 NPI flag: run the pure NPI check-digit validator on every extractor's NPI value (applied centrally like the citation check); a failing NPI keeps its value as read and gets the plain flag "The provider number looks wrong: the last digit does not match."; NPI only, phone and DOB stay in 1.1. (R4.1, R4.4)
  - [x] 0.8.2 npm run proof: runs the three faxes end to end (OCR, extraction, checks); prints per field the value, expected value, cited words, flags and pass or fail against the hard gate; prints the measured tier (exact matches, unflagged misreads by name, correct-but-flagged); exits non-zero on a hard-gate failure. Only the proof script reads truth files, never src/ extraction code. (R9)

- [x] 0.7 Model extraction adapter: API key from an environment variable, strict JSON validated against the schema, retry once then needs-review, and a recorded-response fallback so it runs offline. (R3.1, R3.2)
  - [x] 0.7.1 Recorded-response cache and client shell: responses stored under a key that is a hash of the OCR words; a Gemini client shell over plain REST (built-in fetch, no new package, Interactions API) that reads EXTRACT_API_KEY and EXTRACT_MODEL (default gemini-3.8-flash) only when a live call is made and never logs the key; responses validated with Zod; tests that make no network call. (R3.1)
  - [x] 0.7.2 Prompt, strict JSON schema and parsing: the model returns, per field, a value and the word IDs it used, and no confidence; the reply is rejected unless every cited ID exists, no ID repeats, a null value cites nothing, and the value equals the cited words' OCR text joined by single spaces, so the model cannot correct a misread; the central citation and NPI checks then run on the result; field confidence is the lowest OCR confidence of the cited words (Option A); flag texts are always ours; one retry on invalid output, then needs-review with every field null and flagged. Tests use recorded responses only. Returning word IDs only, with our code building the value, was considered; the exact-match check gives the same guarantee. (R3.1, R3.2)
  - [x] 0.7.3 Live-call script the user runs: loads .env with process.loadEnvFile if present, reads EXTRACT_API_KEY and EXTRACT_MODEL, calls Gemini once per fax, saves the recorded responses, prints results and never the key. (R3.1)
  - [x] 0.7.4 Wire EXTRACT_PROVIDER=model and recorded into createExtractor; recorded works with no .env at all; update .env.example (EXTRACT_MODEL) and the README. (R3.1)

## Phase 1: Core pipeline

- [ ] 1.1 Validators: NPI, DOB, phone, with property-based tests. (R4)
- [ ] 1.2 Flagging rules and confidence threshold. (R5)
- [ ] 1.3 Deskew and normalisation. (R2.2)
- [ ] 1.4 Audit trail and data model. (R7.3)
- [ ] 1.5 Evaluation set across degradation levels, with accuracy report. (R8)
- [ ] 1.6 Varied-geometry property: fast-check pages with label-to-value gaps from tight to wide, varied columns, spacing, wrapping and skew; clean pages give no wrong unflagged value, and pages with one label removed give no unflagged value from that label's area. One run with modest case counts; fix only real counterexamples. (R3.1, R3.4)
- [ ] 1.7 Missing or garbled labels: flag every neighbouring field whose region is open toward an unusable label's space; test that removes or garbles each label in turn on all fixtures, including overflowing values, and asserts no unflagged value contains words from that label's area. (R3.1, R3.4)
- [ ] 1.8 Hook: re-run evaluation on extraction changes.
- [ ] 1.9 Skewed table pages on real OCR: one problem with three symptoms on fax-0002, fixed together. (1) The table reader starts a value at the word nearest the label's height and reads only rightwards, so on a line that rises to the right it misses the leftmost value words (referring provider read as "Family Clinic"; today flagged by the 0.5.10 rule). (2) A label whose words OCR lists out of order is not found (reason for referral). (3) The NPI field is left empty as a layout conflict. Regression fixture: the recorded real OCR in fixtures/ocr/fax-0002.ocr.json; its test is expected to change on purpose when this is fixed. (R3.1, R3.4)

## Phase 2: Interface (demo-script order)

- [ ] 2.1 Inbox with thumbnails, received time, flagged count. (R1, R5.2)
- [ ] 2.2 Demo mode with 3 preloaded faxes and "Incoming fax" button. (R1.2)
- [ ] 2.3 Viewer with source ghosts. (R3.3)
- [ ] 2.4 Review panel: flagged-first, accept, edit, single Verify. (R6)
- [ ] 2.5 Verified state and JSON / FHIR-style export. (R7)

## Phase 3: Delivery

- [ ] 3.1 Deploy to a public URL, no sign-in. (R9.1)
- [ ] 3.2 One-command local start, README with run steps. (R9.2)
- [ ] 3.3 Ghost visual language pass: source ghosts, dial-tone loading, "laid to rest". Check AA contrast and keyboard use. (R10)
- [ ] 3.4 Synthetic-data notice on every fax screen. (R8.2)
- [ ] 3.5 Mock records MCP server and custom "fax-qa" agent, documented. (Kiro write-up)

## Phase 4: Submission (finish at least 3 days before the deadline)

- [ ] 4.1 Architecture diagram exported as an image for Devpost.
- [ ] 4.2 Record the demo from the script; stay under 3:00; upload public to YouTube; no copyrighted music.
- [ ] 4.3 Kiro write-up: IDE/CLI differences, hooks, spec vs vibe coding, steering strategy, MCP, property-based testing, with real observations.
- [ ] 4.4 Text description of features and functionality.
- [ ] 4.5 Optional bonus posts: blog post (must say it was written for the Kiroween 2026 hackathon) and social post starting with #KiroweenHackathon26.
- [ ] 4.6 Submit the draft early, then refine until Dec 4, 2:00 PM PT.

## Cut list (if time runs short, drop in this order)

1. FHIR-style export (keep JSON)
2. Custom "fax-qa" agent
3. Extra degradation levels
4. Ghost effects beyond source ghosts
