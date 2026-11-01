# Facsimortis: Synthetic fax generator plan (task 0.3)

The generator is the foundation of the project. It feeds the first-hour proof, the evaluation numbers you will show in the demo, and the property-based tests. Build it first and keep it seeded and deterministic.

## Goals
1. Produce realistic-looking faxed referrals with **known ground truth**.
2. Control how bad each fax looks, so accuracy can be reported per difficulty level.
3. Include deliberate **trap cases** that exercise the flagging rules.
4. Use only fake data.

## Command

```
npm run gen:faxes -- --seed 42 --count 30 --levels L0,L1,L2,L3
```

Same seed must produce byte-identical output.

## Output layout

```
fixtures/faxes/
  L2/
    fax-0007.png
    fax-0007.truth.json
```

`truth.json` holds: the field values, every word with its ID and box (the generator knows the layout), the template used, the degradation parameters, the seed, and any trap tag. Word boxes let you score ghost accuracy as well as field accuracy.

## Referral content (all fake)

| Field | How it is generated |
|---|---|
| Patient name | Seeded pools of invented first and last names; never real people |
| Date of birth | Plausible adult date, valid, within the last 100 years |
| Referring provider | Invented name plus clinic name |
| NPI | 10 digits with a valid check digit (prefix rule applied) |
| Reason for referral | Short generic, non-sensitive phrases (for example "orthopedic evaluation, knee pain") |
| Urgency | routine / urgent / emergent |
| Callback phone | Fictional range (555-01xx style) |

A generated NPI could coincide with a real provider's public number. That is not patient data, but never pair a generated NPI with a real name, and keep the synthetic notice visible.

## Templates (at least 3, so extraction cannot rely on fixed positions)

1. **Typed form:** labelled boxes in a grid.
2. **Letterhead letter:** values inside sentences ("Please see Jane Doe, born ...").
3. **Table form:** values in a two-column table, with a stamp over part of the page.

## Degradation pipeline (apply in this order)

1. Render the page at a normal scan resolution.
2. Convert to black and white, as fax is 1-bit.
3. Downscale to fax resolution.
4. Rotate by the level's skew.
5. Add speckle noise and toner blotches.
6. Add horizontal scan-line streaks and small dropouts.
7. Overlay a rotated "RECEIVED" style stamp (partially covering text at higher levels).
8. Render one or two fields in a handwriting-style font at higher levels.
9. Add the fax header line (date, sender number, page count) across the top.

## Difficulty levels

| Level | Skew | Noise | Extras |
|---|---|---|---|
| L0 | none | none | clean, typed only (sanity check) |
| L1 | up to 1 degree | light | fax header |
| L2 | up to 3 degrees | moderate, streaks | stamp |
| L3 | up to 5 degrees | heavy | handwriting-style field, smudge near one field |

The demo uses an **L2 or L3** fax. The wow moment needs a page that looks genuinely rough.

## Trap cases (tagged in truth.json)

| Tag | What it does | Expected system behaviour |
|---|---|---|
| `missing-dob` | DOB omitted from the page | Field left empty and flagged, never guessed |
| `bad-npi` | Check digit off by one | Flagged with plain-language reason |
| `future-dob` | DOB in the future | Flagged |
| `ambiguous-chars` | Digits that look like letters (0/O, 1/l) in the phone or NPI | Flagged or read correctly, never silently wrong |
| `smudged-field` | Heavy smudge over one value | Low confidence, flagged |

## First-hour minimum (Phase 0)

Generate exactly three faxes:
1. L1, typed form (the easy baseline).
2. L2, table form with stamp (the main demo candidate).
3. L2, any template with `bad-npi` (to prove flagging).

All three must extract correctly or flag correctly from the command line before any UI work starts.

## Metrics the evaluation script should report

- Field exact-match accuracy (after normalising spaces and case), per level.
- Ghost overlap: how well the cited word boxes match the truth boxes.
- Flag precision and recall on trap cases.
- Number of fields that were guessed when they should have been left empty (target: zero).

## Keeping the numbers honest

- Reserve a **hold-out set of seeds** that you never look at while tuning. Report numbers on the hold-out set only.
- Do not tune thresholds against the exact faxes shown in the demo.
- Report weak levels (L3) honestly. Judges trust a tool that knows where it struggles.

## Acceptance checks

- [ ] Same seed produces byte-identical output.
- [ ] L0 faxes read with 100 percent field accuracy.
- [ ] Every trap tag appears at least once in a standard run.
- [ ] Property-based tests: generated NPIs always pass the validator (except `bad-npi`); generated DOBs are always valid (except `future-dob`).
- [ ] A visible "SYNTHETIC" mark exists in the file metadata, and the app shows the notice whenever a fax is displayed.

## Kiro angles (for the write-up)

- **Spec:** this plan becomes the generator task group in `tasks.md`.
- **Hook:** regenerate fixtures and re-run evaluation whenever the generator or extraction code changes.
- **Property-based testing:** generator validity rules, as above.
- **Custom agent:** a "fax-qa" agent that proposes harder variants and reports which ones the system gets wrong.

## Scope warning

Do not spend more than the first part of day one on realism. The generator needs to be good enough that the demo fax looks convincingly rough and the trap cases behave. Perfect fax simulation wins nothing.
