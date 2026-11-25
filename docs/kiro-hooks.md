# Kiro hooks

Three hooks in `.kiro/hooks/` watch the parts of this repo where a quiet mistake costs the most. Each one runs when
a file is saved, hands the agent a short, read-only job, and gets back a plain answer in the chat. They are
committed with the code, so anyone who opens the project in Kiro gets them.

| Hook | File | Runs when this is saved | What it checks |
|---|---|---|---|
| Proof guard | `proof-guard.json` | a file under `src/extract/`, `src/ocr/`, `src/validators/` or `src/generator/` | `npm run proof -- --reader recorded` and its hard gate |
| Repo safety guard | `repo-safety-guard.json` | `.gitignore` or any `.env*` file | `.kiro` is not ignored; no `.env` file other than `.env.example` is tracked |
| Design token guard | `design-token-guard.json` | `web/src/theme.css` or `web/src/styles.css` | the four stylesheet and contrast test files |

## How they are built

All three use Kiro's `PostFileSave` trigger with a regex `matcher` on the file path, and the `agent` action type.

- **Why `PostFileSave`:** each problem appears when one of these files is written, and the answer is wanted then,
  not when the next task starts. The matcher keeps each hook to its own files.
- **Why `agent` and not `command`:** Kiro forwards a command hook's output only for a few triggers
  (`SessionStart`, `UserPromptSubmit` and a few others), and `PostFileSave` is not one of them. A command could run
  the checks, but nothing would show the result or explain a failure. An `agent` hook adds a short prompt to the
  conversation, and the agent runs the command and explains the result in words.
- **Matchers** (tested against Windows and forward-slash paths, absolute and relative; 42 path checks, no wrong
  answers):
  - proof guard: `(^|[\\/])src[\\/](extract|ocr|validators|generator)[\\/]`. It ignores `src/scripts/`,
    `src/eval/`, `src/samples/`, `test/` and `web/`.
  - repo safety guard: `(^|[\\/])(\.gitignore|\.env[^\\/]*)$`. It matches `.env.example` and `.env.local` too, and
    not `src/env.ts` or `.environment/`.
  - design token guard: `(^|[\\/])web[\\/]src[\\/](theme|styles)\.css$`. It ignores `.css.map` and `.css.bak`.

## Why a hook cannot loop or edit by itself

1. A hook only fires on a file save. Running a command is not a save.
2. The commands write nothing: `npm run proof` reads fixtures, `vitest run` reads tests and sources, and
   `git check-ignore` and `git ls-files` only read.
3. No matcher matches a file another hook writes, and none matches `.kiro/hooks/` itself.
4. Every prompt ends with a read-only rule: do not edit, create, format or save any file, and do not try to fix
   the failure (the repo safety guard also forbids `git add`, `git rm` and `git commit`, and the design token guard
   forbids updating snapshots or loosening a test).

A prompt is an instruction, not a sandbox. If the agent ignored the read-only line and saved a watched file, the
hook would fire again, and nothing in Kiro counts or caps that. Points 1 to 3 are what keep it from happening in
practice.

## What each hook is for

**Proof guard.** The extractor, OCR adapter, validators and fax generator decide what Maria sees and what gets
flagged. The proof runs every fixture fax through them with the saved model answers, with the network blocked, and
judges the hard gate: the words a field cites must exist and contain its value, an empty field must cite nothing and
give a plain reason, a value that fails its check (date of birth, phone, provider number) must carry a flag, the
bad-NPI fax (fax-0003) must be flagged for its provider number, and the recorded reader must make no network
requests. The hook shows the "Measured" block and the
"Hard gate" result. On a failure the agent names the failing check from the `FAIL` and `GATE` lines and the saved
file that most likely caused it, and does not touch any code.

**Repo safety guard.** Two project rules break silently. `.kiro` must never be ignored, because the specs,
steering and hooks are part of the submission. And a real key must never be tracked: only `.env.example` (empty
placeholders) is committed, and the real `.env` is ignored. The hook runs `git check-ignore .kiro` (it must print
nothing) and `git ls-files '.env*'` (it must list only `.env.example`) and reports each as OK or WARNING. On a
warning it says what to do (`git rm --cached`, rotate the key). It never opens or prints a real `.env` file.

**Design token guard.** The colour roles are pinned: amber is the interface, coral is flags only, teal is source
ghosts, "Laid to rest" and the "Read cleanly" heading. A changed token or rule can drop a text pair under 4.5:1
without anything looking wrong in the code. The hook runs `npm test -- web-theme-css web-ghost-css
web-field-column-css web-d4c-css` and names the broken token, rule or colour pair and the ratio the test printed.
These four files are the ones the brief named; the newer stylesheet tests (`web-field-colours-css`,
`web-window-css`, `web-laid-to-rest-css`, `web-d4b-css` and others) are covered by the full `npm test`, which
should still run before a commit.

## How to test them

Each test makes one small real change, watches the hook report it, and undoes the change. Use `git checkout -- <file>`
(or edit the line back) afterwards, and check `git status` is clean.

**Design token guard.** In `web/src/theme.css`, change `--amber: #f6a93b;` to `--amber: #7a5420;` and save. The hook
runs the four test files and reports two failures: the Edit button fill pair (`--amber` on `--ground` at 2.73:1,
needs 4.5:1) and the pinned token value. Change the line back, save again, and it reports that everything passes.

**Proof guard.** In `src/validators/npi.ts`, change the last line of `isValidNpi` from
`return Number(npi[9]) === computeNpiCheckDigit(npi.slice(0, 9));` to `return true;` and save. The proof's hard gate
fails with `fax-0003 npi: the bad-npi fax is not flagged for its provider number`, and "trap flagged as expected"
drops from 1 to 0. Change it back, save again, and the gate passes.

**Repo safety guard.** Saving `.gitignore` or an `.env*` file in this repo runs the two checks, and they pass.
To see a warning, do not put `.kiro` in this project's `.gitignore`, even for a moment: that is against the project
rule, and it is one forgotten revert from a bad commit. Use a throwaway repo instead and run the same two commands:

```powershell
$d = Join-Path $env:TEMP 'hook-scratch'; New-Item -ItemType Directory $d | Out-Null; Set-Location $d
git init -q .; New-Item -ItemType Directory .kiro -Force | Out-Null
Set-Content .gitignore ".kiro/`n.env`n"; Set-Content .env.example 'EXAMPLE_KEY='; Set-Content .env 'EXAMPLE_KEY=fake-demo-value'
git add .gitignore .env.example; git add -f .env
git check-ignore .kiro       # prints ".kiro": the first warning
git ls-files '.env*'         # lists .env and .env.example: the second warning
Set-Location $env:TEMP; Remove-Item -Recurse -Force $d
```

## Record of the real runs

Made on 2026-11-24 in this repo, with the commands each prompt asks for. Times are local.

Kiro's message when the hooks were created said they would be active from the next session start. In this session
they fired as soon as a matching file was saved, including saves made by the agent's own edit tool, and each
fire arrived in the chat as the hook's instruction. Whether a save from the editor fires them the same way was not
tested here.

| Time | Hook | What was saved | Result |
|---|---|---|---|
| 02:56:46 | design token guard (command run by hand, before the first fire) | nothing, clean tree | 4 files, 39 tests pass |
| 02:58:27 | design token guard (fired) | `--amber` changed to `#7a5420` | **fails**, exit 1: 2 of 39 tests fail. "fills Edit with amber and dark text that have AA contrast": `--amber` against `--ground` is 2.73:1, needs 4.5:1. "defines --amber as #f6a93b": the pinned value no longer matches. |
| 02:59:51 | design token guard (fired) | `--amber` changed back | passes: 4 files, 39 tests |
| 03:02:24 | proof guard (fired) | `isValidNpi` returns `true` | **fails**, exit 1: `FAIL: fax-0003 npi: the bad-npi fax is not flagged for its provider number`; trap flagged as expected 0 (was 1); everything else in "Measured" unchanged (16 of 21 exact) |
| 03:04:12 | proof guard (fired) | `isValidNpi` restored | hard gate PASS, exit 0; 16 of 21 exact; trap flagged as expected 1 |
| 03:05:53 | repo safety guard (fired) | a comment line added to `.gitignore` | both OK: `git check-ignore .kiro` printed nothing (exit 1); only `.env.example` is tracked |
| 03:07:08 | repo safety guard (fired) | the comment line removed | both OK; `.gitignore` identical to the committed one |
| about 03:08 | repo safety guard (run by hand, scratch repo, not in this project) | `.kiro/` ignored and `.env` force-added in a temporary repo | **both warnings**: `git check-ignore .kiro` printed `.kiro`; `git ls-files '.env*'` listed `.env` and `.env.example` |

The two edits to `theme.css` and `npi.ts` and the one to `.gitignore` were made only to run these tests and were
undone straight away (`git diff` against the committed files was empty each time).
