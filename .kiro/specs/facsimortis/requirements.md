# Facsimortis: Requirements

Category: Resurrection (reviving fax). Persona: Maria, front-desk coordinator at a small clinic that still receives referrals by fax. One workflow: referral fax in, verified record out.

All data in this project is synthetic. No real patient data is stored, processed or shown.

## Glossary

- **Fax**: a synthetic PNG image of a referral form, made by the seeded generator and degraded to look like a real fax. The sample faxes are read ahead of time by `npm run precompute`. There is no upload, no deskew and no size check in this version (see R1.1, R1.3 and R2.2).
  - Original text: an image (TIFF/PNG/PDF) of a referral form, degraded to look like a real fax.
- **Field**: one extracted value (patient name, DOB, referring provider, provider NPI, reason for referral, urgency, callback phone).
- **Source ghost**: the highlight drawn over the fax image showing where a field's value was read from.
- **Confidence**: a 0 to 1 score per field, shown on each card. In this version it does not raise a flag (see R5.1).
  - Original text: a 0 to 1 score per field. Below the review threshold, the field is flagged.

## Requirements

Each requirement starts with its status in this version. The original text is kept beneath it, so the history stays clear.

- **Built**: works as written.
- **Built differently**: the need is met, but not in the way the text says. The status line says how.
- **Built partly**: some of it works. The status line says exactly what does and what does not.
- **Deferred: not implemented in this version**: not built now, with the reason.
- **Cut**: removed from the scope.

### R1. Receive a fax
**User story:** As Maria, I want a new fax to appear in my inbox without any setup, so that I can start working immediately.

1. **Deferred: not implemented in this version.** There is no upload: the demo uses its own synthetic faxes only, by design, so no real patient data is uploaded. The "Incoming fax" button is built: in Chrome the new fax showed in the inbox with its received time and thumbnail within 48 ms, and within 835 ms with the processor slowed four times and Chrome's simulated "Fast 3G" network, with the browser cache off.
   - Original text: WHEN a fax image is added to the inbox (upload, or demo "Incoming fax" button), THE SYSTEM SHALL show it in the inbox list with a received time and a thumbnail within 2 seconds.
2. **Built.** WHEN the app is opened in demo mode, THE SYSTEM SHALL show two synthetic faxes in the inbox and bring in the third with the "Incoming fax" button, so no login or upload is needed to try it.
   - Original text: WHEN the app is opened in demo mode, THE SYSTEM SHALL preload at least 3 synthetic faxes so no login or upload is needed to try it.
3. **Deferred: not implemented in this version.** There is no file input: the demo uses its own synthetic faxes only, by design, so no real patient data is uploaded.
   - Original text: THE SYSTEM SHALL accept PNG, JPEG, TIFF and PDF input up to 10 MB.

### R2. Read the page
**User story:** As Maria, I want skewed, noisy faxes to still be read correctly.

1. **Built differently.** OCR runs ahead of time in `npm run precompute`, which saves every word with its bounding box. The site reads the saved words and boxes when a fax is opened.
   - Original text: WHEN a fax is opened, THE SYSTEM SHALL run OCR and store every word with its bounding box.
2. **Deferred: not implemented in this version.** There is no deskew step. The readers allow for a few degrees of skew when they group words into lines, and the sample faxes are skewed by at most 3 degrees.
   - Original text: WHEN the page is skewed by up to 5 degrees, THE SYSTEM SHALL correct the skew before OCR.
3. **Built differently.** OCR runs in `npm run precompute`. If it fails there, the script stops with the error and writes no sample data. In the site, a fax whose saved data cannot be loaded stays in the inbox as a row that says it could not be read, and the other faxes still open.
   - Original text: IF OCR fails, THEN THE SYSTEM SHALL show a clear error and keep the fax in the inbox unprocessed.

### R3. Extract fields with sources
**User story:** As Maria, I want each value pulled from the page, with proof of where it came from.

1. **Built.**
   - Original text: WHEN OCR completes, THE SYSTEM SHALL extract the fields listed in the glossary into a structured record.
2. **Built.**
   - Original text: THE SYSTEM SHALL tie every extracted field to the OCR word IDs it came from.
3. **Built.**
   - Original text: WHEN a field is shown, THE SYSTEM SHALL draw its source ghost over those words on the fax image.
4. **Built.**
   - Original text: IF a field cannot be found, THEN THE SYSTEM SHALL leave it empty and flag it, and SHALL NOT invent a value.

### R4. Validate before trusting
**User story:** As Maria, I want obvious mistakes caught for me.

1. **Built.**
   - Original text: THE SYSTEM SHALL validate the provider NPI with the standard check-digit rule.
2. **Built.**
   - Original text: THE SYSTEM SHALL validate that the date of birth is a real date, not in the future, and not older than 120 years.
3. **Built.**
   - Original text: THE SYSTEM SHALL validate the callback phone number format.
4. **Built.**
   - Original text: WHEN any validation fails, THE SYSTEM SHALL flag the field with the reason in plain language.

### R5. Flag uncertainty
**User story:** As Maria, I want to look only at what needs a human.

1. **Deferred: not implemented in this version.** Confidence is shown on each card but does not raise a flag; see README Known limits. Flagged fields are still sorted first.
   - Original text: IF a field's confidence is below the review threshold, THEN THE SYSTEM SHALL flag it and sort flagged fields first.
2. **Built.**
   - Original text: THE SYSTEM SHALL show a count of flagged fields for each fax in the inbox.
3. **Built.**
   - Original text: THE SYSTEM SHALL NOT allow a record to be verified while any field is flagged and unreviewed.

### R6. Human review in one click
**User story:** As Maria, I want to fix a flagged field quickly.

1. **Built.** Selecting a field pulses its source ghost. If the first cited word is not fully visible, the page scrolls it into view at the nearest edge: smoothly, or at once under reduced motion. In Chrome no first ghost word stayed off screen at 1360x900, 1366x768, 1366x657 or 390x844 (task S1).
   - Original text: WHEN Maria selects a flagged field, THE SYSTEM SHALL scroll to and pulse its source ghost.
2. **Built.**
   - Original text: WHEN Maria accepts or edits a value, THE SYSTEM SHALL clear the flag and record the change with a timestamp.
3. **Built.**
   - Original text: WHEN all fields are clear, THE SYSTEM SHALL enable a single "Verify record" action.

### R7. Output a record
**User story:** As Maria, I want the verified result in a form other systems can use.

1. **Built.**
   - Original text: WHEN Maria verifies a record, THE SYSTEM SHALL save it and show it as complete.
2. **Cut.** The FHIR-style export was first on the cut list. The verified record is exported as JSON only.
   - Original text: THE SYSTEM SHALL offer the verified record as JSON and as a FHIR-style ServiceRequest bundle.
3. **Built.** THE SYSTEM SHALL keep every field's original value, each accept and edit with its time, and the verifier (the fixed label "Demo reviewer") in this browser's local storage, and export them as JSON.
   - Original text: THE SYSTEM SHALL keep an audit trail of every field's original value, edits and verifier.

### R8. Synthetic data only
1. **Built partly.** The generator is seeded and has two degradation levels. It adds speckle noise, streaks, skew (up to 1 degree at L1 and 3 degrees at L2), a fax header and a "RECEIVED" stamp. It has no low-resolution step and no handwriting-style font: every word is drawn in one bitmap font, Spleen 16x32.
   - Original text: THE SYSTEM SHALL ship a generator that creates synthetic referral faxes with controlled noise, skew, low resolution, stamps and handwriting-style fonts.
2. **Built.**
   - Original text: THE SYSTEM SHALL display a visible "Synthetic data" notice on every screen that shows a fax.

### R9. Judge-friendly delivery
1. **Built.**
   - Original text: THE SYSTEM SHALL run from a public URL without sign-in.
2. **Built.**
   - Original text: THE SYSTEM SHALL start locally with one documented command.
3. **Built.**
   - Original text: THE REPOSITORY SHALL contain an open-source license, a README with run steps, and the `/.kiro` directory at the root, not ignored by git.

### R10. Haunted, not hindered
1. **Built.**
   - Original text: THE SYSTEM SHALL use the ghost visual language only where it carries meaning: source ghosts, the "dial tone" loading state, and the verified "laid to rest" state.
2. **Built.**
   - Original text: THE SYSTEM SHALL meet WCAG AA contrast and be fully usable by keyboard.

## Out of scope (cut anything not in the demo script)

- Real fax lines or telephony.
- Real patient data or any compliance claim.
- Multi-user accounts, billing, or EHR integrations beyond the mock.
