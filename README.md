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
| `npm run extract` | Extract fields with word IDs | placeholder (task 0.5) |
| `npm run proof` | Run the command-line runtime proof | placeholder (task 0.6) |

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

`OCR_PROVIDER=local` is the default. It runs Tesseract.js offline with the language data in `assets/tessdata`. `OCR_PROVIDER=cloud` is a stub in this demo and only returns an error message. A page takes about 0.4 to 0.7 s on the dev machine.

## Spec

The spec in `.kiro/specs/facsimortis/` is the source of truth. Steering docs are in `.kiro/steering/`.

## License

MIT
