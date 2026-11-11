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
| `npm run gen:faxes` | Generate synthetic faxes | placeholder (task 0.3) |
| `npm run ocr` | OCR one fax and print words with boxes | placeholder (task 0.4) |
| `npm run extract` | Extract fields with word IDs | placeholder (task 0.5) |
| `npm run proof` | Run the command-line runtime proof | placeholder (task 0.6) |

## Spec

The spec in `.kiro/specs/facsimortis/` is the source of truth. Steering docs are in `.kiro/steering/`.

## License

MIT
