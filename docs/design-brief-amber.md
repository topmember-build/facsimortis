# Facsimortis: Amber Desk design brief (supersedes parts of the Reading Desk brief)

Direction chosen by Paul: **D · Amber Desk**, a retro amber-CRT computer shell around the review screen we already built. Reference: the "Facsimortis visual directions" canvas, artboards "D · Amber Desk: inbox" and "D · Amber Desk: review window". Treat the mockups as the target look, not as code to copy.

Keep from `docs/design-brief.md`: the paper fax stage, the cropped default view, the field column sections, the source string, the 44px buttons, every honesty rule. This brief changes colours, fonts and the outer shell, and adds a boot screen. It replaces tasks D6 and D8.

## Visual references

- `docs/design/amber-inbox.png`: the inbox as a desktop, with icons, wordmark, Synthetic banner and taskbar.
- `docs/design/amber-review.png`: the review window, with title bar, summary row, paper fax stage, field column and source string.

Each task must be compared against these images before it is reported done: spacing, icon style, title bar weight, the taskbar and the amber-on-dark balance. Where an image differs from this brief, the brief's tokens, rules and task split win. The wording and sample values in the images are illustrative; the app keeps its existing wording and data.

## Concept
The app is an old amber-screen computer. Faxes are files on its desktop. Opening one opens a window with the fax and its fields. The fax and the cards stay clean and readable; retro effects live only on the frame (shell, window, boot screen).

## Colour roles (amber is the interface now, so flags get a new colour)
| Token | Value | Use |
|---|---|---|
| --ground | #141414 | page background |
| --amber | #f6a93b | interface: borders, titles, icons, primary text accents, title bar fill |
| --amber-dim | #c98a2b | secondary text, labels, hints |
| --amber-soft | #e9b565 | values on dark cards when amber text is needed |
| --text | #fff3dc | main values on dark surfaces |
| --taskbar | #05101a | taskbar background |
| --flag | #ff6a5c | **flags only**: flagged cards, flagged words, flagged count, source string for flagged fields, flag badge on icons |
| --flag-text | #ff9a8d | flag reasons and text on dark |
| --flag-edge | #8a2b20 | flagged highlight outline on the paper |
| --ghost | #6fd3c0 | source ghosts (clean cited words, clean source string) and the "Read cleanly" heading |
| --paper / --paper-ink | keep current | fax sheet |

Rules:
1. Coral red (`--flag`) is used **only** for flags. Amber is never used to signal a flag. Teal is never used for flags.
2. Flags must never rely on colour alone: keep the dashed outline on flagged words, the "flagged" text, the icon badge with a "!" shape and the "Accepted although the check failed" wording.
3. Compute and report contrast for every pair on every surface. Text 4.5:1, non-text 3:1. Use the existing contrast tests as the pattern.
4. Replace the old flag value (#ffb347) and old ground (#0d1015) through the tokens. List every test that pins an old value and **stop and tell me before editing any of them**.

## Fonts
- **Pixelify Sans** (SIL OFL 1.1) for the wordmark, window titles, icon labels, section headings, the Verify and primary buttons' labels, the taskbar clock. Self-host woff2 files (400, 600, 700 as needed), with OFL.txt and SOURCES.md entries including source URL and SHA-256, the same as D1. No third-party requests.
- **IBM Plex Mono** stays for ids, values, fax text and confidence numbers. **Inter Tight** stays for explanatory sentences, reasons and buttons that carry sentences (Accept anyway, Edit).
- Never use the pixel font for body text, values or anything under 16px.
- Instrument Serif is retired. Remove it only if no test depends on it; otherwise tell me.

## Screens

### 1. Boot screen (first load of a browser session only)
- Dark screen, amber pixel text: "Facsimortis", a line "Press any key or select Receive faxes", and a visible **Receive faxes** button (real `<button>`).
- Any key press, click, or the button continues. It also continues by itself after about 5 seconds, so a judge who does nothing is never stuck.
- Under `prefers-reduced-motion`: static, no typing or blinking effects, and no auto-advance delay shorter than 5s is needed.
- Remember "booted" for the session in `sessionStorage`, wrapped in try/catch; it must work without storage. A URL parameter `?skipboot` skips it for tests and for recording.
- This screen also serves as the loading state. If data is still loading after about 150ms, show the line "Receiving fax…" (`role="status"`).
- No sound.

### 2. Inbox as a desktop
- Dark ground with a very soft amber radial glow.
- Faxes shown as pixel-art document icons in a grid at the top left, each a real button or link with the label `./fax-0003` in the pixel font, a second line with status text (for example "2 flagged · urgent"), and a coral badge with a "!" shape on faxes that have flags. Keep the existing accessible names, including the received time.
- A floppy-disk icon `./export` for the audit export where it fits the current flow; do not change export behaviour.
- A large "Facsimortis" wordmark in the pixel font at the bottom right with one short description line above it.
- The Synthetic data banner stays at the top, restyled with amber-dim text.
- Bottom taskbar: dark navy, 2px amber top border, small icon buttons (Inbox, Export) with `aria-label`s, a status text ("Now: 3 faxes in the tray · 2 flagged on fax-0003"), reader mode text, a clock showing the demo clock (labelled as the demo clock in its accessible name, not UTC).
- Hint text "Open an icon to see a fax."
- Phone width: icons wrap in a grid of three, wordmark above the taskbar, everything still reachable.
- Draw the icons as inline SVGs (crisp edges), `aria-hidden`, no image files, no icon libraries.

### 3. Review window
- The existing review screen sits inside a window: 2px amber border, 34px amber title bar with the pixel-font title "fax-0003 — referral" in dark text, and two real buttons with `aria-label`s: **Back to inbox** (the existing back action) and **Close window** (same action). Do not add minimise or maximise.
- Inside: the summary row, the paper fax stage, the field column, the source string and the Laid to rest panel, with the new colours. The Verify record button is amber outlined with a pixel-font label.
- Flagged cards: coral border and glow when selected, reasons in `--flag-text`, "Accept anyway" outlined in coral, Edit filled amber with dark text.
- Clean rows: amber-dim labels, `--text` values.
- Narrow screens: the window fills the width and the layout stacks as it does now; the source string stays hidden below the breakpoint.
- Keyboard focus ring: white 2px or more, clearly visible on amber and on dark.

### 4. Laid to rest
- On Verify, the coral emphasis fades over about 400ms (instant under reduced motion) into a quiet state: the panel gets a teal accent line and the title bar text can read "fax-0003 — laid to rest".
- All existing wording and the export button stay. Nothing about flags is hidden in the summary or the export.

## Do not
- Add sound, video, canvas or WebGL effects, or any dependency.
- Put glow or blur on the fax image, the cards' text or the values. Glow is allowed on the wordmark, window border, selected card and source string only. Scanlines: faint scanlines (4% or less) are allowed on the paper sheet only; none on the cards, values or text.
- Change data flow, storage format, extractor, or any test expectation without telling me first.
- Use emoji.

## Task split (small steps, one commit each, new IDs)
- **R1:** tokens (new colours, flag recolour), Pixelify Sans self-hosted, steering `design.md` updated (amber interface, coral flags, teal ghosts), contrast report, list of tests that pin old values. Stop for my OK before editing those tests.
- **R2:** inbox as a desktop plus taskbar.
- **R3:** boot screen and loading state.
- **R4:** review window frame and recolouring of cards, highlights, source string and summary row.
- **R5:** Laid to rest transition, phone-width pass, keyboard and focus pass, reduced-motion pass, axe, screenshots for the demo.

## Acceptance
- All existing tests pass except those explicitly approved for update; axe zero violations; both builds pass.
- Looks right at 100% zoom on a laptop and at phone width.
- A first-time visitor can get from boot to a reviewed fax with no instructions.
