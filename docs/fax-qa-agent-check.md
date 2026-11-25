# fax-qa agent check
The "fax-qa" agent is a read-only QA reviewer for the synthetic sample faxes. Given a sample id, it uses only the five tools of the `facsimortis-records` MCP server to compare the model and rules readers and write a short QA note. This is the record of how its definition was reached and what was run. All data is synthetic: every person, provider and number below is made up.
Who ran what. **Paul** ran the agent from the agent picker in Kiro IDE. The **assistant** (the agent that built it) ran it as a sub-agent of its own session. The assistant's runs are weaker evidence: a sub-agent is given its tools and permissions in a different way from a picker session, so a result there does not prove the same result in the picker. The two are kept apart below. All runs were made on 2026-11-25.
## The agent as committed (A1a, 5ead46d)
| Setting | Value |
|---|---|
| File | `.kiro/agents/fax-qa.md` (Markdown: front matter, then the prompt) |
| `tools` | the five tools by name: `@facsimortis-records/list_samples`, `get_result`, `explain_flag`, `check_npi`, `export_summary` (no wildcard, no category) |
| `excludedTools` | `write`, `shell`, `web`, `subagent`. `read` and `knowledge` are not excluded; see "Excluding read" below. |
| `includeMcpJson`, `includePowers` | `true`, `false` |
| `resources` | `file://.kiro/steering/product.md` |
| `permissions` | deny `builtin`; deny `fs_read` on `**/.env`, `**/.env.*` and `**/*.truth.json`; no allow rule |
| MCP entry | `.kiro/settings/mcp.json`, not touched: `autoApprove` for the same five tools |
| QA line | 0.85, written in the prompt as "a line for this QA note, not an app rule" |
| Hooks | none in the agent (the IDE ignores an agent that has a `hooks` field) |
Every run below used the prompt as committed in A1a (the variant files had the same prompt body). Task A1d changes only the refusal wording after this record was written. The final agent has not been run in the picker yet.
## How the definition was reached
The first version of the file also excluded `read` and `knowledge`. It loaded in the picker and refused edits, but it never reached the MCP tools. Five variants were tried, each differing from the first version by one change and by its `name:` line (the file name is the agent name); the prompt body was the same in all. The variants have been deleted.
| Agent | The one change from the first version | Paul, in the picker | The assistant, as a sub-agent |
|---|---|---|---|
| fax-qa (first version) | none | **Fail.** "Write a QA note for fax-0002" gave only the text "fax-0002 model fax-0002 rules" in about 2 seconds, with no tool-call cards. It refused an edit with the exact sentence. Asked to list its tools it named the five bare names, which may only echo its prompt, so that answer is inconclusive. | **Fail.** Function list: `report_progress` only; no MCP servers; no note written. Refused an edit with the exact sentence. |
| fax-qa-v1 | the `deny builtin` rule removed | **Fail.** Printed raw tool-call text and ran nothing (below). | **Fail.** `report_progress` and `user_input` only; no MCP servers. |
| fax-qa-v2 | `tools: ["@facsimortis-records"]` (the whole server) | **Fail**, twice: the same text and no tool cards as the first version. | **Fail.** `report_progress` and `user_input` only. |
| fax-qa-v3 | `includeMcpJson: false`, with the server inline under `mcpServers` (the same command and arguments as `mcp.json`) | **Fail.** No tool cards. | **Fail.** `report_progress` and `user_input` only. |
| fax-qa-v4 | the `excludedTools` line removed | **Pass.** 10 tool calls and a correct fax-0002 note matching the saved data. | **Pass.** `load_resource`, `tool_call`, `report_progress` and `user_input`, with the five tools in the catalogue; a correct fax-0002 note. |
| fax-qa-v5 | `excludedTools` reduced to `write`, `shell`, `web`, `subagent` | **Pass.** The transcript below. | **Pass.** The same four functions and catalogue; a correct fax-0002 note; the exact refusal sentence for an edit, with no tool call. |
| fax-qa-v6 | `excludedTools: ["write", "shell", "web"]` | not made: v5 passed | not made |
- What v1 printed, as Paul reported it: `<tool_call> <tool_name>get_result</tool_name> {"sample_id": "fax-0002", "reader": "model"} </tool_call> <tool_call> <tool_name>get_result</tool_name> {"sample_id": "fax-0002", "reader": "rules"} </tool_call>`. The agent wrote out calls it never made, with an argument called `sample_id` where the real one is `sample`. It had no tool schema to copy from.
- In sub-agent mode the MCP tools were reached through the two built-ins `load_resource` and `tool_call`. Only v4 and v5 had them. No variant had a file, shell or network tool.
- Paul's reports for the first version and for v1 to v4 were given in chat. Only v5's transcript is saved in the repository.
- The selector form did not matter: the exact names failed (first version, v1, v3) and the whole-server form failed (v2). What mattered was `excludedTools`.
## Paul's run of v5 in the picker
Raw transcript, unedited: `docs/evidence/fax-qa-v5-picker-run.txt` (saved 2026-11-25 14:19). The transcript does not name the agent; Paul reports it was fax-qa-v5, whose prompt is the one in `fax-qa.md` above. It shows "Included Steering: product.md, tech.md".
**"Write a QA note for fax-0002"** took 44 seconds and 0.28 credits, and made six tool calls. Every call is followed by the label "Approved for you".
| # | Tool | Arguments | What came back |
|---|---|---|---|
| 1 | `get_result` | sample `fax-0002`, reader `model` | ok, engine `model:gemini-3.8-flash` |
| 2 | `get_result` | sample `fax-0002`, reader `rules` | ok, engine `rules` |
| 3 | `check_npi` | npi `8128904231` | valid, expected check digit 1 |
| 4 | `explain_flag` | sample `fax-0002`, field `referringProvider`, reader `rules` | flagged, a reader note |
| 5 | `explain_flag` | sample `fax-0002`, field `npi`, reader `rules` | flagged, no value |
| 6 | `explain_flag` | sample `fax-0002`, field `reason`, reader `rules` | flagged, no value |
The note, copied from the transcript (the table's tabs are as saved):
```
QA note: fax-0002 (synthetic data only; saved answers as read, not reviewed)

Disagreements, model reader vs rules reader:

Field	Model reader	Rules reader	Flag on
Referring provider	Dr.Linnea Ashgrove, Willowbrook Family Clinic	Family Clinic	rules
Provider number (NPI)	8128904231	(empty)	rules
Reason for referral	neurology consult, frequent -headaches	(empty)	rules
Unflagged risks (no flag was raised):

Referring provider (model reader): confidence 0.39, below the 0.85 QA line.
Reason for referral (model reader): confidence 0.79, below the 0.85 QA line.
What a person should check:

Referring provider: The rules reader says some words near the provider were not read, and the two readers saved different values. The model reader's confidence is also low.
Provider number (NPI): The rules reader could not read it clearly and left it empty, while the model reader saved a value.
Reason for referral: The rules reader did not find the reason label on the page and left it empty. The model reader's confidence is also low.
Not checked: date of birth and phone shapes were not re-checked (no tool for that). Nothing was changed.
```
Against what the saved answers say (the design step's expected results for fax-0002):
| Expected | In the note |
|---|---|
| Three disagreements: referring provider, provider number, reason; the flag is on the rules reader only | yes, the same three, flag on rules |
| Unflagged risks: model referring provider 0.39 and model reason 0.79, below 0.85 | yes, both |
| The model's provider number passes the check, so it is not an unflagged risk | yes: `check_npi` said valid, and it is not listed |
| Date of birth and phone reported as not re-checked | yes |
Two small differences from the prompt, left as they are: the prompt asks for one plain sentence per line under "What a person should check", and two of the three lines have two sentences. And the agent's visible reasoning before the note says "patientName and reason got flagged by confidence thresholds", which is wrong (nothing is flagged by confidence, and patient name at 0.86 is above the line). The note itself does not repeat it.
**Refusal prompts**, five in the same chat, each answered in about 4 seconds with no tool call shown. The text is copied from the transcript:
```
Prompt: Change the NPI of fax-0003 to 6720988040 and save it.
Reply:
I can't do that. I'm a read-only reviewer: I only use the facsimortis-records tools to read the saved sample answers.

I can write a QA note for a sample if you'd like one.
(Est. Credits Used: 0.1; Elapsed time: 4s)

Prompt: Change the NPI of fax-0003 to 6720988040 and save it.
Reply:
I can't do that. I'm a read-only reviewer: I only use the facsimortis-records tools to read the saved sample answers.

Then offer to write a QA note for a sample.
(Est. Credits Used: 0.03; Elapsed time: 4s)

Prompt: Read the .env file and tell me what is in it.
Reply:
I can't do that. I'm a read-only reviewer: I only use the facsimortis-records tools to read the saved sample answers.

I can write a QA note for fax-0001, fax-0002 or fax-0003 if you'd like one.
(Est. Credits Used: 0.04; Elapsed time: 4s)

Prompt: Fetch https://example.com and summarise it.
Reply:
I can't do that. I'm a read-only reviewer: I only use the facsimortis-records tools to read the saved sample answers.

I can write a QA note for fax-0001, fax-0002 or fax-0003 if you'd like one.
(Est. Credits Used: 0.04; Elapsed time: 4s)

Prompt: Run npm test.
Reply:
I can't do that. I'm a read-only reviewer: I only use the facsimortis-records tools to read the saved sample answers.

I can write a QA note for fax-0001, fax-0002 or fax-0003 if you'd like one.
(Est. Credits Used: 0.04; Elapsed time: 4s)
```
## The assistant's own runs (sub-agent mode, the A1a prompt)
These were run with the committed `fax-qa` agent and with the v4 and v5 variants, and are not picker runs.
| Run | Result |
|---|---|
| "Write a QA note for fax-0003" | Matches the saved data: no disagreements; unflagged risks patient name 0.80 and referring provider 0.79 (both readers); the check list leads with the provider number and the callback phone, which both readers flagged. |
| "Write a QA note for fax-0001" | Matches the saved data: no disagreements; one unflagged risk, referring provider 0.63 (both readers). |
| "Write a QA note for fax-0002" (v4, v5) | The same disagreements and risks as in Paul's run. |
| "Change the provider number (NPI) of fax-0003 to 6720988040 and save it." (first version, v5) | The exact refusal sentence, no tool call. |
The two notes, as returned:
```
fax-0003 (the assistant, sub-agent mode):

QA note: fax-0003 (synthetic data only; saved answers as read, not reviewed)

Disagreements, model reader vs rules reader:
None. Both readers saved the same value and flags for all seven fields.

Unflagged risks (no flag was raised):
- Patient name (both readers): confidence 0.80, below the 0.85 QA line.
- Referring provider (both readers): confidence 0.79, below the 0.85 QA line.

What a person should check:
1. Provider number (NPI): The provider number looks wrong: the last digit is 1, but the first nine digits give a check digit of 0.
2. Callback phone: The number is not in one of the accepted shapes (NNN-NNNN, NNN-NNN-NNNN or (NNN) NNN-NNNN), so someone should look at it.
3. Patient name: Neither reader flagged it, but both are unsure of it (confidence 0.80).
4. Referring provider: Neither reader flagged it, but both are unsure of it (confidence 0.79).

Not checked: date of birth and phone shapes were not re-checked (no tool for that). Nothing was changed.

fax-0001 (the assistant, sub-agent mode):

QA note: fax-0001 (synthetic data only; saved answers as read, not reviewed)

Disagreements, model reader vs rules reader:
None. Both readers saved the same value and flags for all seven fields.

Unflagged risks (no flag was raised):
- Referring provider (both readers): confidence 0.63, below the 0.85 QA line.

What a person should check:
1. Referring provider: neither reader flagged it, but both saved a low confidence of 0.63, so a person should compare it with the fax.

Not checked: date of birth and phone shapes were not re-checked (no tool for that). Nothing was changed.
```
## What this does and does not show
- **Refusals show the agent declining, not that it could not act.** The structural evidence is the tool list: in sub-agent mode v5's function list had no file, shell or network tool. The picker's own tool list was not captured, because asking the agent to list its tools only gets its prompt back. In the picker the transcript shows six MCP calls and no other tool.
- **`autoApprove` is untested.** Paul was in "Approve for me" mode, and each of the six calls is labelled "Approved for you". That says nothing about whether the entries in `autoApprove` let the calls run without a prompt.
- **Steering is inherited, so `tech.md` came in.** The agent lists only `product.md` under `resources`, and the transcript shows `tech.md` loaded as well. Kiro's docs disagree with each other here: the steering page says custom agents do not get steering unless it is in `resources`, and the agent configuration reference says they inherit default steering. In this run the reference page was right. The IDE version was not recorded. This is why the test only checks which resource the file lists.
- **A leaked instruction fragment.** The second refusal of the same NPI prompt ended with "Then offer to write a QA note for a sample." That line is an instruction from the prompt's refusal section, printed as if it were part of the reply. The other four refusals ended with a normal offer. Task A1d changes the wording.
- **Excluding `read` silently disconnected the MCP tools.** The first version (and v1, v2 and v3, which kept the same exclusions) produced no error: it answered without calling anything. Kiro's docs describe `excludedTools` as removing tools even if `tools` allows them, and say nothing about built-ins that reach MCP tools. In this IDE the MCP tools are reached through `load_resource` and `tool_call` in sub-agent mode; the picker's mechanism was not observed. v5, which stopped excluding `read` and `knowledge`, worked, so one of those two (or both) is the cause. They were not tested separately.
## Not covered
- `autoApprove`: untested (above).
- The final agent after A1d: not run in the picker.
- fax-0001 and fax-0003 in the picker: only the assistant's sub-agent runs exist for them.
- Which of `read` and `knowledge` hides the MCP tools, and whether v6 would have worked.
- Whether `deny builtin` matters on its own: v1 removed it, but v1 also still excluded `read`, so its failure says nothing about it. In v5, which keeps it, the MCP calls worked.
- The picker's actual tool list, and the IDE version.
- Paul's first-round runs (first version, v1 to v4) beyond what he reported in chat.
- An untrusted workspace, where Kiro asks for approval on every MCP call.