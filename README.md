# facsimortis

Facsimortis revives fax for clinics that still receive referrals that way. A faxed referral goes in; a verified, structured record comes out, with a "source ghost" showing the exact words on the page each value was read from.

This is a demo built on synthetic data only. It makes no compliance or certification claims.

> Status: scaffold only (task 0.1). Nothing is implemented yet.

## Requirements

- Node.js 22.12 or newer

## Setup

```
npm install
cp .env.example .env
```

## Scripts

| Script | What it does | Status |
|---|---|---|
| `npm test` | Run the test suite (Vitest, fast-check) | working |
| `npm run lint` | Lint with ESLint | working |
| `npm run typecheck` | Type-check with strict TypeScript | working |
| `npm run gen:faxes` | Generate synthetic faxes | working (3 Phase 0 faxes) |
| `npm run ocr` | OCR one fax and print words with boxes | working (local Tesseract.js, offline) |
| `npm run extract` | Extract fields with word IDs | working (rule-based, offline) |
| `npm run record:live` | Call the Gemini model once per fax and save the answers | you run it, needs `EXTRACT_API_KEY` |
| `npm run proof` | Run the command-line runtime proof on the three fixture faxes; add `-- --reader recorded` to use the saved model answers with the network blocked | working (offline) |

## Synthetic faxes

```
npm run gen:faxes -- --seed 42
```

This writes three fake referral faxes. The seed comes from `--seed`, then `FAX_SEED`, then 42. The same seed gives byte-identical files.

Output layout:

- `fixtures/faxes/L1/fax-0001.png` and `fax-0001.truth.json`
- `fixtures/faxes/L2/fax-0002.png` and `fax-0003.png`, each with a `.truth.json`

Each `truth.json` holds:

- the fields, each with the word IDs it was read from
- every word on the page with its box in final-image pixels, `[x0, y0, x1, y1]`, end values exclusive
- the template, the degradation parameters, the seed and the trap (if any)

Every page carries a visible "Synthetic data" notice and a SYNTHETIC marker in the PNG metadata. The bitmap font is Spleen (BSD-2-Clause, see `assets/fonts/LICENSE-spleen`).
The English OCR language data is `eng.traineddata` from tessdata_fast (Apache-2.0, see `assets/tessdata/LICENSE-tessdata`).

## Reading a fax (OCR)

```
npm run ocr -- fixtures/faxes/L2/fax-0002.png
```

With no path, it reads `fixtures/faxes/L1/fax-0001.png`. It prints a header (file, engine, image size, word count), then one line per word:

- `id`: the word ID in reading order, such as `o0001`
- `box`: `x0,y0,x1,y1` in fax image pixels. `x1` and `y1` are exclusive.
- `conf`: confidence from 0 to 1
- `text`: the word as read

The last line shows the OCR time and the mean confidence. Add `--json` to print the full result as JSON instead.

`OCR_PROVIDER=local` is the default. It runs Tesseract.js offline with the language data in `assets/tessdata`. `OCR_PROVIDER=cloud` is a stub in this demo and only returns an error message. A cold run of `npm run ocr` takes about 0.7 to 0.8 s on the dev machine (this includes starting the OCR engine), and about 0.4 s per page once the engine is running.

## Reading the fields

```
npm run extract -- fixtures/faxes/L2/fax-0002.png
```

With no path, it reads `fixtures/faxes/L1/fax-0001.png`. It runs OCR, then the rule-based reader, and prints one row per field:

- the field name, in plain words
- the value, or `(empty)` when nothing was read
- the confidence, from 0 to 1
- the word IDs the value was read from, or `-`

Each flag is printed on its own line under its row. The last lines show the time and how many of the 7 fields are flagged.

An empty field is always flagged. A value is never guessed. Values are exactly what OCR read, with no repairs, so an OCR misread shows up as a misread. Confidence is shown for the reader to judge and is not used to decide anything. Add `--json` to print the full result as JSON instead.

### Choosing the reader

Set `EXTRACT_PROVIDER` (in `.env` or the shell). `.env` is optional.

| Value | What it does |
| --- | --- |
| `rules` (default) | Rule-based reader. Offline, no key. |
| `recorded` | Saved model answers from `fixtures/extract/`. Offline, no key, works with no `.env` at all. A fax with no saved answer gives an error that says so. |
| `model` | Live Gemini call. Needs `EXTRACT_API_KEY`; `EXTRACT_MODEL` is optional (default `gemini-3.8-flash`). `EXTRACT_THINKING_LEVEL` is optional (`low`, `medium` or `high`); when empty nothing is sent and the model uses its default. |

Every reader goes through the same citation and provider number checks. Model answers must be strict JSON; one retry, then the fax is marked as needing review.

```
EXTRACT_PROVIDER=recorded npm run extract -- fixtures/faxes/L2/fax-0002.png
```

On PowerShell: `$env:EXTRACT_PROVIDER='recorded'; npm run extract -- fixtures/faxes/L2/fax-0002.png`

## Recording model answers (live call)

```
npm run record:live
```

This is the only step that uses the network. Put `EXTRACT_API_KEY` (and optionally `EXTRACT_MODEL`) in `.env`; the script loads `.env` if it exists. It reads each fax in `fixtures/faxes/` (or the PNG paths you pass), calls the model once per fax, prints the fields like `npm run extract`, and saves each usable answer in `fixtures/extract/`, named by a hash of the OCR words. A second call is made only when the first answer fails the checks. For each fax it prints the OCR time and the time spent in the model call on its own, plus the thinking level in use. An unusable answer is not saved, and the script exits with an error if any fax was not saved. The key is never printed.

## Spec

The spec in `.kiro/specs/facsimortis/` is the source of truth. Steering docs are in `.kiro/steering/`.

## License

MIT
