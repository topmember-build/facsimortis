# Records server (read-only MCP)

A small MCP server that lets an agent in Kiro read the sample faxes of this demo and what each reader saved for them.
It is a demo built on synthetic data: every person, provider and number in the samples is made up. It is not part of
the site, and it cannot change anything.

## What it reads

- Only `web/public/samples/index.json` and the fax files the index names (`fax-0001.json` to `fax-0003.json`).
  Every read goes through the read guard in `src/scripts/read-guard.ts`.
- Never the answer-key files the fax generator writes, never `.env`, never any other file. A sample id from a tool
  call is only looked up in the index. It is never used as a file path.
- No network, no writing, no environment variables. stdout carries only the protocol. One startup line goes to
  stderr, and it never contains arguments or sample data.

## Tools

| Tool | Arguments | What it returns |
| --- | --- | --- |
| `list_samples` | none | Each sample's id, level, received time, whether each reader has a saved answer, and how many fields each reader flagged. |
| `get_result` | `sample`, `reader` (`model` or `rules`) | The seven fields as saved: the value (or empty), the confidence, the flags, and the page words the value was read from. |
| `explain_flag` | `sample`, `field`, `reader` (optional, default `model`) | Why a field was flagged. It runs the same check the app uses (provider number check digit, date of birth, phone shape) on the saved value again. |
| `check_npi` | `npi` | Whether the last digit of a provider number matches its check digit, and what it should be. Use made-up numbers only. |
| `export_summary` | `sample` | The counts for both readers **as read, not reviewed**. Reviews stay in the browser that did them, so `reviewed`, `edited` and `acceptedDespiteFlag` are always 0 here. This is not the exported record of a verified review. |

Values are returned exactly as saved. A value that was not on the page stays empty and flagged. Nothing is corrected
or guessed.

A refused call comes back as a tool error with a plain message, and the message never repeats the value that was sent.
It can name an argument that is not allowed, for example `Unrecognized key: "extra"`.

## Running it

Kiro starts it from `.kiro/settings/mcp.json`: command `node`, arguments `--import tsx tools/mcp-records/server.ts`,
no environment variables. All five tools are in `autoApprove`, because none of them can change anything.

To try it by hand, run `npm ci` once, then from the repository root:

```sh
node --import tsx tools/mcp-records/server.ts
```

It waits for MCP messages on stdin and exits when stdin closes. It answers both the 2025-11-25 handshake
(`initialize`) and the 2026-07-28 one (`server/discover` with the `_meta` envelope). It needs Node 20 or later. The
repository's `engines` setting asks for more.

## Files

- `data.ts` is the only file that reads, always through the read guard, and only file names from the index.
- `tools.ts` holds the five tools as plain functions with Zod input and output schemas. No protocol and no I/O.
- `server.ts` registers the tools with `@modelcontextprotocol/server` 2.4.0 (an exact dev dependency) and serves them
  over stdio. It is the only file that imports the SDK.

## Tests

- `test/mcp-records-tools.test.ts`: every tool on the real samples, property tests for `check_npi`, the same labels
  and summary counts as the app, and hostile arguments.
- `test/mcp-records-isolation.test.ts`: decoy answer-key and `.env` files next to the samples are never read or
  returned, and a tampered index is refused.
- `test/mcp-records-static.test.ts` and the lint rules for `tools/mcp-records` in `eslint.config.js`: allowed imports
  only, no file system, network, `process.env` or stdout.
- `test/mcp-records-runtime.test.ts`: no network use and nothing written while every tool runs.
- `test/mcp-records-server.test.ts`: the real server as a separate process, in both protocol eras.
- `test/mcp-records-deps.test.ts`: the SDK adds two pinned packages and nothing in the site refers to it.
- `test/mcp-records-registration.test.ts`: the Kiro entry in `.kiro/settings/mcp.json`, started as configured.
