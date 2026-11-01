# Facsimortis: First-hour prompt sequence (Phase 0)

Goal: three synthetic faxes go from image to cited, validated fields in the command line. No UI until this passes.

Realistically this may take one to two hours. The gate matters more than the clock.

Before you start: repo created, license added, `.kiro/specs` and `.kiro/steering` in place and committed. Check that `.gitignore` does not mention `.kiro`.

Each prompt below is written to be pasted into Kiro. Run them in order, one at a time. After each, do the check, commit, and note anything surprising for the write-up.

---

## Prompt 1: Scaffold (about 10 minutes)

> Read the Facsimortis spec in `.kiro/specs/facsimortis/` and the steering docs. Do task 0.1 only. Scaffold a TypeScript project in strict mode with a test runner, fast-check, a linter, a `.env.example`, and a README stub. Add npm scripts for `test`, `gen:faxes`, `ocr`, `extract` and `proof` as placeholders. Do not build any UI. Do not add `.kiro` to `.gitignore`. List what you created.

**Check:** `npm test` runs (even with no tests). `git status` shows `.kiro` tracked. Commit.

---

## Prompt 2: Minimal fax generator (about 15 minutes)

> Implement the minimum version of the generator described in `docs/fax-generator-plan.md`. Generate exactly three faxes: (1) L1 typed form, (2) L2 table form with a stamp, (3) L2 with the `bad-npi` trap. Each fax needs a PNG and a `truth.json` with field values, word IDs and boxes, template, degradation parameters and seed. Use fake data only. Same seed must give identical output. Add property-based tests that generated NPIs pass the validator except for `bad-npi`.

**Check:** run `npm run gen:faxes -- --seed 42` twice and compare file hashes. Open the three images yourself. Does the L2 one look rough enough for the demo? Commit.

---

## Prompt 3: OCR adapter (about 15 minutes)

> Implement task 0.4. Create an OCR adapter interface that returns `{id, text, box}[]`. First propose two implementation options (one that runs locally for development, one cloud service) and tell me the trade-offs before writing code. After I choose, implement the local one and a stub for the cloud one that reads credentials from environment variables. Add `npm run ocr -- <file>` that prints words with IDs and boxes.

**Check:** run it on all three faxes. Compare the output with each `truth.json`. Note how many words are wrong at L1 versus L2. Commit.

---

## Prompt 4: Extraction adapter (about 15 minutes)

> Implement task 0.5. Create an extraction adapter that takes the OCR word list and returns the fields defined in `design.md`, each with a value, the word IDs it used, and a confidence. Use a strict JSON schema, retry once on invalid output, and mark the fax `needs-review` instead of crashing if it still fails. Never invent a value: if a field is not on the page, return null. Add `npm run extract -- <file>`.

**Check:** run it on all three faxes. Does anything look made up? Does the `bad-npi` fax produce an NPI value (it should, with the wrong digit)? Commit.

---

## Prompt 5: Citation check and the gate (about 15 minutes)

> Implement task 0.6 and the NPI, DOB and phone validators from task 1.1 (just the pure functions for now). Reject any field whose cited word IDs do not exist or whose cited words do not contain the value. Add `npm run proof` that runs all three faxes end to end and prints a table: field, extracted value, expected value, cited words, validation result, pass or fail. Exit with a non-zero code if any fax fails.

**Check:** the gate.

---

## The gate (do not start the UI until all are true)

- [ ] All three faxes produce the expected field values, or the expected flags.
- [ ] Every extracted value is backed by cited words that really contain it.
- [ ] The `bad-npi` fax is flagged with a clear reason.
- [ ] A missing field comes back empty, not guessed.
- [ ] `npm run proof` passes from a clean clone.

If all true: commit, tag `phase-0-proof`, and write down what Kiro did well and badly.

---

## If the gate fails

| Symptom | Likely cause | What to try |
|---|---|---|
| OCR misses many words on L2 | Skew or noise too heavy for the OCR | Add the deskew task (1.3) earlier; lower the generator's L2 severity slightly; try the cloud OCR |
| Model cites wrong words | Prompt does not stress citations | Tighten the extraction prompt; require word IDs per field; keep the citation check strict |
| Model invents missing fields | No explicit rule | Reinforce the "return null" rule in the prompt and in `product.md` |
| Output is not valid JSON | Loose prompt | Switch to the model's structured output mode if available; keep the single retry |
| Proof passes only on your easy fax | Over-tuned to L1 | Test the L2 fax first and fix against that |

---

## After the gate: your first hook

Create a hook that re-runs `npm run proof` when extraction or generator code changes, and a second that checks `.kiro` is not in `.gitignore`. Write down the first time a hook catches something. That story belongs in the submission.

---

## Notes to capture while you build (for the Kiro write-up)

- Which prompt Kiro handled well, and which needed a second try.
- One steering rule that visibly changed Kiro's behaviour.
- One thing the spec caught that vibe coding would have missed.
- One place where you changed the spec because reality disagreed.
- Any property-based test that failed on something a unit test would not have found.

Keep these notes in a running file. Memory fades by submission day.
