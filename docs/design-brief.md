> docs/design-brief-amber.md takes precedence where the two briefs differ.

# Facsimortis: Visual design brief, "Reading Desk"

Direction chosen by Paul: **A · Reading Desk**. Reference mockup: the "Facsimortis visual directions" canvas, artboard A. Treat the mockup as the target look, not as code to copy.

## Intent
A dark reading room where a reviewer (Maria) examines a real-looking fax. The fax is the hero. Every extracted value is tied back to the exact words on the page by a glowing "source string". The look should feel calm, precise and slightly eerie, never gimmicky. It must still read as a serious clinical tool.

## Hard rules (do not break; these are the product's honesty)
1. Amber is used **only** for flags (flagged fields, their source words, the flagged count). Nothing decorative is amber.
2. Teal is for "source ghosts" (cited words) and the Synthetic banner label. No other use.
3. Confidence is a number or bar in neutral grey. It never uses the flag colour.
4. Keep the exact wording: "Check each value against the fax before verifying", "Accepted although the check failed", "No change made", "Laid to rest". No "all correct" or "verified correct" wording.
5. The Synthetic data banner stays at the top of every screen.
6. Unflagged fields are labelled "read cleanly, not checked by a person". Never imply they were verified.
7. No behaviour changes, no storage format changes, no test removed. Existing accessible names stay (inbox row names, status pills with received time).

## Tokens (put in one CSS variables file, e.g. web/src/theme.css)
| Token | Value | Use |
|---|---|---|
| --ground | #0d1015 | page background |
| --panel | #151a22 | cards, top bar |
| --panel-raised | #171c24 | selected card |
| --line | #262d38 | borders, dividers |
| --text | #e8e6df | primary text |
| --text-muted | #9aa4b2 | labels, confidence (check contrast on every surface) |
| --ghost | #6fd3c0 | source ghosts, Synthetic label |
| --flag | #ffb347 | flags only |
| --flag-text | #ffc772 | flag reasons and text on dark |
| --paper | #e8e4d6 | fax sheet surround only |
| --paper-ink | #1d1c1a | text on the fax sheet |

Contrast: all text 4.5:1 or better against its surface (3:1 for 24px and up). Run axe-core and fix anything under. Selected states need a non-colour cue too (outline weight, label), not colour alone.

## Typography
- Display / wordmark: **Instrument Serif**, 30px in the header.
- UI text: **Inter Tight**, 400/500/600.
- Data, IDs, values, fax text: **IBM Plex Mono**, 400/500.
- Self-host the fonts (woff2 in web/public/fonts, `font-display: swap`) so the site works offline and sends no third-party requests. Propose the file list before adding anything.

## Layout (desktop, 1360 wide reference)
- Top: 32px Synthetic banner, then 72px bar: wordmark, record id and received time (UTC) and urgency, summary counts (flagged, reviewed, edited), **Verify record** button (44px high).
- Two columns below: fax stage on the left (about 600px), field column on the right (about 620px). Stack to one column on narrow screens, fax first.
- Fax stage: the real fax PNG on a warm "thermal paper" sheet with a soft shadow, very faint horizontal scanlines overlay, cropped view by default with "Show full page". Do not redraw the fax; style only the frame around it.
- Field column order: "Needs your eyes" (flagged, selected one expanded with reason and buttons), then "Read cleanly" as a compact list with values and grey confidence numbers.
- Buttons at least 44px high. Visible focus ring (the existing 4px #1f6fb5 outline may stay, but check it against dark surfaces).

## The signature: the source string
- When a field is selected, draw one curved line from its card to the highlighted words on the fax (use the OCR word boxes already in the sample JSON; an SVG overlay positioned from those boxes).
- Flagged field: amber line with a soft glow. Clean field: thin teal line.
- Only one string at a time. Recompute on resize, on "Show full page" and on scroll of the stage.
- Fully optional for accessibility: the same information must exist as text (the cited words are listed in the card). The SVG is `aria-hidden`.
- `prefers-reduced-motion`: no animation. Otherwise the string may draw in over about 300ms.

## Motion (small, meaningful, skippable)
- Loading: a short "dial-tone" handshake state, text only plus a subtle pulse. Under reduced motion, static text.
- Laid to rest: when the record is verified, a calm fade of the flag glow into a quiet teal "Laid to rest" state. No confetti, no skulls, no jump scares.

## Do not
- Add decorative ghosts, cobwebs or Halloween clip art. The theme lives in the metaphor (source ghosts, laid to rest), not in decoration.
- Add UI libraries or CSS frameworks. Plain CSS variables and the existing components.
- Change data flow, extractor, storage, or test expectations.

## Suggested task split (small steps, new IDs, one commit each)
1. Theme tokens, self-hosted fonts, base typography. Axe and tests green.
2. Header, Synthetic banner, summary counts, Verify button restyle.
3. Fax stage frame (paper, scanlines, shadow), cropped and full views.
4. Field column: flagged cards, clean list, buttons, selected state.
5. Source string overlay from word boxes, with resize handling and reduced-motion.
6. Loading state and Laid to rest state.
7. Contrast and keyboard pass in a real browser at 100% zoom, then screenshots for the demo.

## Acceptance
- All existing tests pass, plus tests for: string endpoints follow the selected field, `aria-hidden` on the overlay, reduced-motion path.
- axe-core: zero violations on inbox and review screens.
- Looks right at 100% zoom on a laptop and on a phone-width window.
