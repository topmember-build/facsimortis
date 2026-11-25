/**
 * Shared helpers for the records server tests. Not a test file (no ".test" in the name).
 */
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { createSampleStore, DEFAULT_SAMPLES_DIR, type SampleStore } from '../tools/mcp-records/data.js';
import { TOOLS, type ToolResult } from '../tools/mcp-records/tools.js';
import { readInput } from '../src/scripts/read-guard.js';
import { afterAll } from 'vitest';

export const REAL_IDS = ['fax-0001', 'fax-0002', 'fax-0003'] as const;
export const FIELD_NAMES = ['patientName', 'dob', 'referringProvider', 'npi', 'reason', 'urgency', 'callbackPhone'] as const;

/** Hostile values for any argument. Each must give ok:false (or a normal answer for the value) and never throw. */
export const HOSTILE_VALUES: readonly unknown[] = [
  '..',
  '../..',
  '../../package.json',
  '..\\..\\package.json',
  'C:\\Windows\\win.ini',
  '/etc/passwd',
  'fax-0003.' + 'tru' + 'th',
  'fax-0003.' + 'tru' + 'th.json',
  'fax-0003.json',
  'index',
  'index.json',
  'fax-0001\u0000',
  'FAX-0001',
  ' fax-0001',
  '',
  'x'.repeat(10 * 1024),
  123,
  null,
  undefined,
  true,
  {},
  [],
  ['fax-0001'],
  { sample: 'fax-0001' },
];

/** Runs every tool with every sample, field, reader and hostile value. Returns every result. */
export function runEverything(store: SampleStore): ToolResult<unknown>[] {
  const results: ToolResult<unknown>[] = [];
  const call = (name: string, input: unknown) => {
    const tool = TOOLS.find((candidate) => candidate.name === name);
    if (!tool) throw new Error(`no tool ${name}`);
    results.push(tool.run(store, input));
  };
  call('list_samples', {});
  call('list_samples', undefined);
  for (const sample of REAL_IDS) {
    for (const reader of ['model', 'rules']) {
      call('get_result', { sample, reader });
      for (const field of FIELD_NAMES) call('explain_flag', { sample, field, reader });
    }
    for (const field of FIELD_NAMES) call('explain_flag', { sample, field });
    call('export_summary', { sample });
  }
  for (const npi of ['1234567893', '1234567890', '123', '', 'abcdefghij', '6720988041']) call('check_npi', { npi });
  for (const value of HOSTILE_VALUES) {
    call('list_samples', value);
    call('get_result', value);
    call('get_result', { sample: value, reader: 'model' });
    call('get_result', { sample: 'fax-0001', reader: value });
    call('explain_flag', { sample: value, field: 'npi' });
    call('explain_flag', { sample: 'fax-0001', field: value });
    call('explain_flag', { sample: 'fax-0001', field: 'npi', reader: value });
    call('check_npi', { npi: value });
    call('export_summary', { sample: value });
    call('export_summary', value);
  }
  return results;
}

/** All the text the tools returned, for canary searches. */
export function allText(results: readonly ToolResult<unknown>[]): string {
  return results.map((result) => JSON.stringify(result)).join('\n');
}

/** A read function that records every path it is asked for, and reads through the guarded reader. */
export function recordingReader(): { read: (path: string) => Buffer; log: string[] } {
  const log: string[] = [];
  return {
    log,
    read: (path: string) => {
      log.push(path);
      return readInput(path);
    },
  };
}

export function realStore(read?: (path: string) => Buffer): SampleStore {
  return createSampleStore(read ? { read } : {});
}

// The folders makeTempRoot created during this test file's run. Vitest gives each test file its own copy of this
// module, so the afterAll below runs once per file and deletes only the folders that file created.
const createdRoots: string[] = [];

/** A temporary folder under the system temp folder. The name never contains the answer-key word. Deleted after the file's tests. */
export function makeTempRoot(prefix = 'fx-mcp-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  createdRoots.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of createdRoots.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch (error) {
      // A folder that cannot be removed is reported, not counted as a test failure.
      console.error(`Could not remove the temporary folder ${dir}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
});

/** Copies index.json and the fax JSON files (not the images) of the real samples into `dir`. */
export function copySampleData(dir: string): void {
  mkdirSync(dir, { recursive: true });
  for (const name of ['index.json', ...REAL_IDS.map((id) => `${id}.json`)]) {
    cpSync(join(DEFAULT_SAMPLES_DIR, name), join(dir, name));
  }
}

const SKIP = new Set(['node_modules', '.git', 'dist', 'coverage']);

/** A SHA-256 over every file path and content under `root`, skipping the folders that tools and tests may touch. */
export function treeHash(root: string): string {
  const hash = createHash('sha256');
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (SKIP.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        hash.update(relative(root, full));
        hash.update('\0');
        hash.update(String(statSync(full).size));
        hash.update('\0');
        hash.update(readFileSync(full));
      }
    }
  };
  walk(resolve(root));
  return hash.digest('hex');
}
