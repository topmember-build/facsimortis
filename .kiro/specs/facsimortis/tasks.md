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
- [ ] 0.5 Extract all fields with word IDs from that fax. Print them. (R3)
  - [x] 0.5.1 Extraction schema and interface: Zod Field and ExtractionResult schemas from design.md, ExtractionAdapter and ExtractionError, EXTRACT_PROVIDER selection, .env.example update; tests. (R3.1)
  - [x] 0.5.2 Label matching and typed-form layout: find each field by its label in the OCR words (small tolerance on label text only), read typed-form values below the label inside its box, value is the cited words as read with no repairs, null plus a plain flag when absent; unit tests and typed-form truth-words layout test. (R3.1, R3.2, R3.4)
  - [ ] 0.5.3 Table-form layout and never-invents property: read table-form values to the right of the label on the same row, wrapped lines included; truth-words layout test for the table form and a fast-check property that no value contains text outside its cited words. (R3.1, R3.2, R3.4)
  - [ ] 0.5.4 Extract CLI and measurement: npm run extract prints fields with cited word IDs, confidence and flags; OCR plus extraction on all three faxes reports exact matches, nulls and unflagged misreads by name. No thresholds. (R3.1)
  - [ ] 0.5.5 Model extraction adapter: API key from an environment variable, strict JSON validated against the schema, retry once then needs-review, and a recorded-response fallback so it runs offline. (R3.1, R3.2)
- [ ] 0.6 Reject any field whose cited words do not contain its value. (R3.2)

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

## Phase 1: Core pipeline

- [ ] 1.1 Validators: NPI, DOB, phone, with property-based tests. (R4)
- [ ] 1.2 Flagging rules and confidence threshold. (R5)
- [ ] 1.3 Deskew and normalisation. (R2.2)
- [ ] 1.4 Audit trail and data model. (R7.3)
- [ ] 1.5 Evaluation set across degradation levels, with accuracy report. (R8)
- [ ] 1.6 Hook: re-run evaluation on extraction changes.

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
