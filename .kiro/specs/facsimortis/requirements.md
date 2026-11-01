# Facsimortis: Requirements

Category: Resurrection (reviving fax). Persona: Maria, front-desk coordinator at a small clinic that still receives referrals by fax. One workflow: referral fax in, verified record out.

All data in this project is synthetic. No real patient data is stored, processed or shown.

## Glossary

- **Fax**: an image (TIFF/PNG/PDF) of a referral form, degraded to look like a real fax.
- **Field**: one extracted value (patient name, DOB, referring provider, provider NPI, reason for referral, urgency, callback phone).
- **Source ghost**: the highlight drawn over the fax image showing where a field's value was read from.
- **Confidence**: a 0 to 1 score per field. Below the review threshold, the field is flagged.

## Requirements

### R1. Receive a fax
**User story:** As Maria, I want a new fax to appear in my inbox without any setup, so that I can start working immediately.

1. WHEN a fax image is added to the inbox (upload, or demo "Incoming fax" button), THE SYSTEM SHALL show it in the inbox list with a received time and a thumbnail within 2 seconds.
2. WHEN the app is opened in demo mode, THE SYSTEM SHALL preload at least 3 synthetic faxes so no login or upload is needed to try it.
3. THE SYSTEM SHALL accept PNG, JPEG, TIFF and PDF input up to 10 MB.

### R2. Read the page
**User story:** As Maria, I want skewed, noisy faxes to still be read correctly.

1. WHEN a fax is opened, THE SYSTEM SHALL run OCR and store every word with its bounding box.
2. WHEN the page is skewed by up to 5 degrees, THE SYSTEM SHALL correct the skew before OCR.
3. IF OCR fails, THEN THE SYSTEM SHALL show a clear error and keep the fax in the inbox unprocessed.

### R3. Extract fields with sources
**User story:** As Maria, I want each value pulled from the page, with proof of where it came from.

1. WHEN OCR completes, THE SYSTEM SHALL extract the fields listed in the glossary into a structured record.
2. THE SYSTEM SHALL tie every extracted field to the OCR word IDs it came from.
3. WHEN a field is shown, THE SYSTEM SHALL draw its source ghost over those words on the fax image.
4. IF a field cannot be found, THEN THE SYSTEM SHALL leave it empty and flag it, and SHALL NOT invent a value.

### R4. Validate before trusting
**User story:** As Maria, I want obvious mistakes caught for me.

1. THE SYSTEM SHALL validate the provider NPI with the standard check-digit rule.
2. THE SYSTEM SHALL validate that the date of birth is a real date, not in the future, and not older than 120 years.
3. THE SYSTEM SHALL validate the callback phone number format.
4. WHEN any validation fails, THE SYSTEM SHALL flag the field with the reason in plain language.

### R5. Flag uncertainty
**User story:** As Maria, I want to look only at what needs a human.

1. IF a field's confidence is below the review threshold, THEN THE SYSTEM SHALL flag it and sort flagged fields first.
2. THE SYSTEM SHALL show a count of flagged fields for each fax in the inbox.
3. THE SYSTEM SHALL NOT allow a record to be verified while any field is flagged and unreviewed.

### R6. Human review in one click
**User story:** As Maria, I want to fix a flagged field quickly.

1. WHEN Maria selects a flagged field, THE SYSTEM SHALL scroll to and pulse its source ghost.
2. WHEN Maria accepts or edits a value, THE SYSTEM SHALL clear the flag and record the change with a timestamp.
3. WHEN all fields are clear, THE SYSTEM SHALL enable a single "Verify record" action.

### R7. Output a record
**User story:** As Maria, I want the verified result in a form other systems can use.

1. WHEN Maria verifies a record, THE SYSTEM SHALL save it and show it as complete.
2. THE SYSTEM SHALL offer the verified record as JSON and as a FHIR-style ServiceRequest bundle.
3. THE SYSTEM SHALL keep an audit trail of every field's original value, edits and verifier.

### R8. Synthetic data only
1. THE SYSTEM SHALL ship a generator that creates synthetic referral faxes with controlled noise, skew, low resolution, stamps and handwriting-style fonts.
2. THE SYSTEM SHALL display a visible "Synthetic data" notice on every screen that shows a fax.

### R9. Judge-friendly delivery
1. THE SYSTEM SHALL run from a public URL without sign-in.
2. THE SYSTEM SHALL start locally with one documented command.
3. THE REPOSITORY SHALL contain an open-source license, a README with run steps, and the `/.kiro` directory at the root, not ignored by git.

### R10. Haunted, not hindered
1. THE SYSTEM SHALL use the ghost visual language only where it carries meaning: source ghosts, the "dial tone" loading state, and the verified "laid to rest" state.
2. THE SYSTEM SHALL meet WCAG AA contrast and be fully usable by keyboard.

## Out of scope (cut anything not in the demo script)

- Real fax lines or telephony.
- Real patient data or any compliance claim.
- Multi-user accounts, billing, or EHR integrations beyond the mock.
