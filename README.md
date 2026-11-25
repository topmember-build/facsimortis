# facsimortis

Facsimortis revives fax for clinics that still receive referrals that way. A faxed referral goes in; a verified, structured record comes out, with a "source ghost" showing the exact words on the page each value was read from.

This is a demo built on synthetic data only. It makes no compliance or certification claims.

Live demo: https://topmember-build.github.io/facsimortis/ (synthetic data only)

> Status: scaffold only (task 0.1). Nothing is implemented yet.

## Requirements

- Node.js 22.22.2 or newer on 22, 24.15.0 or newer on 24, or 26 and up (the site tests use jsdom 31, which needs this)

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
| `npm run precompute` | Write the sample data the site loads to `web/public/samples/`; add `-- --check` to verify the committed data is up to date | working (offline) |

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

This is the only step that uses the network. Put `EXTRACT_API_KEY` (and optionally `EXTRACT_MODEL`) in `.env`; the script loads `.env` if it exists. It reads each fax in `fixtures/faxes/` (or the PNG paths you pass), calls the model once per fax, prints the fields like `npm run extract`, and saves each usable answer in `fixtures/extract/`, named by a hash of the OCR words. A second call is made only when the first answer fails the checks. For each fax it prints the OCR time and the time spent in the model call on its own, plus the thinking level in use. An unusable answer is not saved, and the script exits with an error if any fax was not saved. If Google refuses a request, the script prints the HTTP status and Google's short error message from the reply, and nothing else from the response. The key is never printed.

## Sample data for the site

```
npm run precompute
```

This reads each fax in `fixtures/faxes/`, runs local OCR and both offline readers (rule-based and saved model answers, with the central checks), and writes to `web/public/samples/`: each fax's PNG, one JSON file per fax with its OCR words, boxes and both readers' results, and an `index.json`. It runs offline, never calls the live model and never reads the generator's answer-key files. A fax with no saved model answer gets a plain "no saved answer" entry. The output is the same every run, and the folder is committed. `npm run precompute -- --check` exits with an error if the committed data is out of date.

## Site

```
npm run dev
```

Starts the dev server at http://localhost:5173/. `npm run build` writes the static site to `dist/web/` (git-ignored; it holds `index.html`, `assets/` and a copy of `samples/`). `npm run preview` serves that folder at http://localhost:4173/. Run `npm run build` first.

The site is static: there is no server and no network call beyond loading its own files. It reads the sample data in `web/public/samples/`, which `npm run precompute` writes. The build uses relative paths, so the folder works from any subpath; set `SITE_BASE` (for example `/facsimortis/`) to build for a fixed one. Site code in `web/src/` shares the Zod schemas from `src/samples/schema.ts` and `src/extract/schema.ts`; ESLint blocks it from importing anything else in `src/` or any Node module. Site tests run with `npm test` (jsdom, web files only). The GitHub Pages build (`.github/workflows/pages.yml`) uses `SITE_BASE=/facsimortis/`.

The first load in a browser tab opens on a short boot screen. It continues to the inbox on any key, a click, the Receive faxes button, or by itself after about 5 seconds. Add `?skipboot` to the URL to skip it, for example when recording the demo. The tab remembers that it has booted in `sessionStorage` (key `facsimortis:booted`); if storage is blocked, the boot screen shows on every load and still works. Tests render the app without the boot screen (the `boot` prop of `App` is off by default; `web/src/main.tsx` turns it on).

### Saved progress, verified records and export

- Review progress (each Accept and Edit, with its time), the edit record and verified records are kept only in this browser's `localStorage`, under keys that start with `facsimortis:v4:`. There is no server. This is not a server audit trail, and clearing the site's data removes all of it. Each saved entry records the original value next to any edit. When a reviewer presses Accept on a value that still fails a check (provider number, date of birth or phone), the action and the field in the export carry `acceptedDespiteFlag: true` and the exact messages in `failedChecks`; every field has the boolean, and format v4 does not read older `facsimortis:v1:` or `facsimortis:v2:` entries (the page says so). Times are UTC, and the key names say so: the export has `verifiedAtUtc` and each action has `atUtc`, both ISO 8601 strings ending in `Z` (for example `2026-10-01T09:30:00.000Z`), and the verified card reads, for example, "Verified on Oct 1, 09:30 UTC." Entries saved in the v3 format (with `verifiedAt` and `at`) are converted to v4 when the page loads, with no values changed and no note; a v3 entry that cannot be read is not used and the page says so. Stale saved progress (older `facsimortis:v1:` and `facsimortis:v2:` entries, entries made from different sample data, and entries that cannot be read) is reported once and then removed, so the note does not return; entries that migrate or are still current are kept. Any future change to the saved format needs a migration or a clear plain-language note, never a silent reset. The export also has a `summary` of counts over the seven fields (`totalFields`, `flagged`, `reviewed`, `edited`, `acceptedDespiteFlag`, `notFlaggedNotChecked`), worked out from the fields by one function and shown on the verified card; it counts what happened and does not say any value is right.
- Saved entries are tied to the sample data. If the sample data changes (data version, reference date or that fax's contents), the old entry is ignored and the page says so. Unreadable saved data is ignored the same way.
- If the browser does not allow saving (for example private mode, or no space left), the app still works, and a short note says progress will not be kept.
- There are no accounts. The verifier in every record is the fixed label "Demo reviewer".
- A verified record is shown as "Laid to rest" and is read-only. "Download JSON" saves it as a file such as `facsimortis-fax-0003-model-verified.json`.
- This is a demo built on synthetic data. It makes no compliance claims.

## Known limits

- **A low confidence does not raise a flag.** On fax-0002 the model reader saves the referring provider with a confidence of 0.39 and no flag, and it raises no flags on that fax at all. The rules reader flags three fields on the same fax: the referring provider, the provider number and the reason for referral. Confidence is shown, but it never raises a flag. Requirement R5.1 in the spec says a field below the review threshold is flagged; the design notes that the threshold is not used yet (task 1.2 is open). The decision for this demo is to leave the flag logic as it is. Which reader is right on fax-0002 was not checked, because the answer keys were not used in this check. The full record is in `docs/mcp-live-check.md`.

## Spec

The spec in `.kiro/specs/facsimortis/` is the source of truth. Steering docs are in `.kiro/steering/`.

## License

MIT
