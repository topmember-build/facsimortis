# ambiguous-chars trap fixture: slashed zero

Synthetic data only. No real people, providers or numbers.

This is fax-0001 (seed 42, level L1, typed-form template) as it was drawn with
Spleen's slashed zero, before `src/generator/font.ts` was changed to draw a plain
zero. It comes from generator commit `fad295a`.

| File | SHA256 |
| --- | --- |
| `fax-0001-slashed-zero.png` | `1948A1F7AE7900234D5E3A372132BCED9EB009E24045BAD11025FEA4153F0EDD` |
| `fax-0001-slashed-zero.truth.json` | `6F153516CE87B16EE037E9E006A2B7FB8C5C2706FBBCBF00B125FE82706F6D38` |

The words and boxes are the same as the plain-zero `fixtures/faxes/L1/fax-0001`
(the truth JSON is byte-identical). Only the pixels of each "0" differ. The truth
JSON keeps `trap: null`; the planned tag is recorded here instead.

Tesseract (local adapter, PSM 3) misreads the zeros on this page:

| Truth | OCR read |
| --- | --- |
| `10/01/2026` (header date) | `16/81/2826` |
| `16:03` (header time) | `16:83` |
| `555-0159` (header number) | `555-9159` |
| `09/06/1938` (date of birth) | `89/86/1938` |
| `555-0147` (callback phone) | `555-8147` |

Score on this page: 35/47 words read exactly (0.745), 13/17 field-value words
(0.765). With the plain zero the same page scores 40/47 (0.851) and 15/17 (0.882).

It is reserved for the planned `ambiguous-chars` trap (see
`docs/fax-generator-plan.md`). It is not wired into the generator yet.
