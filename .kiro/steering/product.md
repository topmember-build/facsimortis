---
inclusion: always
---

# Facsimortis: Product steering

## What this is
Facsimortis revives fax for clinics that still receive referrals that way. A faxed referral goes in; a verified, structured record comes out, with proof of where every value was read from.

## The one persona, one workflow, one wow moment
- **Persona:** Maria, front-desk coordinator at a small clinic.
- **Workflow:** referral fax arrives, fields are extracted, flagged fields are reviewed, the record is verified.
- **Wow moment:** each extracted field shows a "source ghost" highlighting the exact words on the page it came from.

If a feature does not serve this workflow, do not build it. The spec in `.kiro/specs/facsimortis/` is the source of truth; if code and spec disagree, stop and ask which should change.

## Hard rules
1. **Synthetic data only.** Never use, generate, request or store real patient data. All sample people, providers and numbers are fake. Every screen that shows a fax shows a "Synthetic data" notice.
2. **Never invent values.** If a field is not on the page, leave it empty and flag it. A missing value is correct; a guessed value is a bug.
3. **No compliance claims.** Do not write copy that says the product is HIPAA compliant or certified. Describe it as a demo built on synthetic data.
4. **Cut anything not in the demo script.** The 3-minute script is the scope. When unsure, leave it out.

## Language
- Plain, calm, short sentences. Flag reasons are written for a front-desk worker, not an engineer ("The provider number looks wrong: the last digit does not match", not "NPI checksum failed").
- Spooky language is allowed only in names and states that carry meaning: "source ghost", "laid to rest" for a verified record.
