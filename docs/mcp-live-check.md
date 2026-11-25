# MCP live check
The read-only records server in `tools/mcp-records/` is registered for Kiro in `.kiro/settings/mcp.json`. The tests
start it the way that entry says, but only Kiro itself can show that Kiro starts it, finds it in the right folder, and
lets the agent call its tools. This is the record of that check. All data is synthetic: every person, provider and
number below is made up.
| Setting | Value |
|---|---|
| Server name | `facsimortis-records` |
| Command | `node` |
| Arguments | `--import tsx tools/mcp-records/server.ts` (both paths relative) |
| Environment | none (`"env": {}`) |
| `autoApprove` | `list_samples`, `get_result`, `explain_flag`, `check_npi`, `export_summary` |
## Working directory
Kiro's MCP configuration docs do not say which folder it starts a stdio server in, and the entry has no folder
setting. Node looks up the
`--import tsx` loader and the script path `tools/mcp-records/server.ts` from the folder it is started in. If that
folder were not the workspace root, the server would fail to start and list no tools. In the check below it connected
and listed its five tools, so Kiro started it from the workspace root. That conclusion comes from how the paths are
found. Kiro's MCP log lines were not part of this record, so the server's startup line on stderr
(`facsimortis-records: ready (read-only, synthetic data)`) was not seen in Kiro.
## Record of the check by hand in Kiro IDE
Made on 2026-11-25, after `.kiro/settings/mcp.json` was saved at 10:04:45 local time. There are five screenshots of it,
which are not in the repository. What they show:
| What was checked | Result |
|---|---|
| Server status in Kiro's MCP panel | connected, with a green tick |
| Tools listed | five |
| `list_samples` run through the server | ran |
| `explain_flag` on fax-0003 run through the server | ran: saved value `6720988041`, expected check digit 0 |
| `check_npi` on `1234567890` run through the server | ran: not valid, expected check digit 3 |
| `autoApprove` (whether Kiro ran the tools without asking first) | **not recorded yet.** This record does not claim that `autoApprove` works. |
## Calls made by the agent through Kiro
These are separate from the check by hand. The agent called the tools through the same connection in its own Kiro
session. An approval prompt would be shown to the person at the keyboard, not to the agent, so these calls say
nothing about `autoApprove` either way.
| Time (2026-11-25) | Call | Result |
|---|---|---|
| between 10:05 and 10:23 | `list_samples` | the three samples; flags per reader: fax-0001 0 and 0, fax-0002 0 (model) and 3 (rules), fax-0003 2 and 2 |
| between 10:05 and 10:23 | `get_result` with `sample: "../../package.json"`, `reader: "model"` | refused as a tool error: `Unknown sample. Known samples: fax-0001, fax-0002, fax-0003.` |
| about 10:27 | `explain_flag` with `sample: "fax-0003"`, `field: "npi"` (reader left out) | the output below |
| about 10:27 | `check_npi` with `npi: "1234567890"` | the output below |
| about 10:27 | `get_result` on fax-0002, once for each reader | the values in the finding below |
The two outputs below are the full text Kiro returned. They match the values the check by hand reported for the same
tools.
`explain_flag` on fax-0003, field `npi`. The reader defaulted to `model`:
```json
{
  "sample": "fax-0003",
  "reader": "model",
  "field": "npi",
  "label": "Provider number (NPI)",
  "value": "6720988041",
  "confidence": 0.94,
  "citedText": "6720988041",
  "flagged": true,
  "explanations": [
    {
      "flag": "The provider number looks wrong: the last digit does not match.",
      "check": "npi-check-digit",
      "stillFails": true,
      "detail": "The last digit is 1, but the first nine digits (672098804) give a check digit of 0."
    }
  ],
  "note": "Flags are shown as saved. Accepting or correcting a flagged field is done by a person in the app."
}
```
`check_npi` on `1234567890`:
```json
{
  "npi": "1234567890",
  "wellFormed": true,
  "valid": false,
  "expectedCheckDigit": 3,
  "message": "The provider number looks wrong: the last digit does not match.",
  "note": "Synthetic data only: every person, provider and number here is made up."
}
```
## Finding: the two readers disagree on fax-0002
On fax-0002 the model reader raises no flags at all, and the rules reader flags three fields. They agree on the other
four fields (patient name, date of birth, urgency and callback phone): same values, no flags.
| Field | Model reader, as saved | Rules reader, as saved |
|---|---|---|
| Referring provider | `Dr.Linnea Ashgrove, Willowbrook Family Clinic`, confidence 0.39, no flag | `Family Clinic`, flagged: "Some words near the referring provider were not read. Please check it." |
| Provider number (NPI) | `8128904231`, confidence 0.95, no flag (the last digit matches the check digit) | empty, flagged: "The provider number (NPI) could not be read clearly from the page. Please check it." |
| Reason for referral | `neurology consult, frequent -headaches`, confidence 0.79, no flag | empty, flagged: "The reason for referral label was not found on the page." |
Why it matters for Maria:
- The app shows the model reader by default (`DEFAULT_READER` in `web/src/flags.ts`). On fax-0002 that view has no
  flags, so nothing points her to the three fields the rules reader could not read cleanly.
- The model's referring provider has the lowest confidence of its seven fields (0.39) and still no flag. Confidence
  is reported but does not raise a flag. A search of `src/` and `web/src/` (tests left out) finds a confidence
  threshold only in `src/eval/confidence.ts`, which is evaluation code that production code may not import.
- The model's values cite real page words and copy them as read, including the noise in them (`Dr.Linnea`,
  `-headaches`). The values come from the page and are not invented. A clean result here means the checks found
  nothing. It does not mean a person or a second reader agreed.
Which reader is right is not known from this check. Neither the server nor the agent reads the answer-key files.
Nothing was changed because of this finding. Whether a low confidence should raise a flag is a product decision for
later.
## Not covered by this check
- Whether `autoApprove` let the tools run without a prompt (see above).
- Kiro's MCP log lines, and which protocol era Kiro used to connect. The server answers both, and
  `test/mcp-records-server.test.ts` covers both.
- Opening a folder other than the repository root as the workspace.
