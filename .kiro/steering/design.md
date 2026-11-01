---
inclusion: fileMatch
fileMatchPattern: "**/*.tsx"
---

# Facsimortis: Design steering

## Principle
Haunted, not hindered. The spooky theme must carry meaning. If an effect does not help Maria understand or trust something, remove it.

## Where the ghost language is allowed
1. **Source ghosts:** a soft glow over the words a field was read from. Selecting a field makes its ghost pulse once.
2. **Dial-tone loading:** while a fax is being read, show a subtle waveform instead of a spinner.
3. **Laid to rest:** a calm settled state when a record is verified.

Nowhere else. No cobwebs, bats, floating decorations or sound.

## Visual basics
- Dark theme with a restrained palette: near-black background, one cool accent for ghosts, one warm accent for flags.
- Flagged fields use colour **and** an icon **and** text, never colour alone.
- Fax image is always the visual centre of the screen; controls sit around it.
- Generous spacing; one primary action per screen ("Verify record").

## Accessibility (required)
- WCAG AA contrast on all text and controls.
- Full keyboard use: tab order follows the review flow; Enter accepts a field; focus is always visible.
- Respect reduced-motion settings: pulses and waveforms become static.
- Every ghost highlight has a text equivalent (field name and value announced to screen readers).

## Copy
- Short, calm, plain language. Flag reasons say what is wrong and what to do.
- Show a "Synthetic data" notice on every screen that shows a fax.

## States to design for every screen
Empty, loading, error, flagged, verified. A screen is not done until all five exist.
