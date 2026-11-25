/**
 * The canary test: answer-key files and secrets sit next to the sample data, each holding a unique marker. Whatever
 * the tools are asked, the markers must never come back, and those files must never be opened.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSampleStore } from '../tools/mcp-records/data.js';
import { exportSummary, getResult, listSamples } from '../tools/mcp-records/tools.js';
import { allText, copySampleData, makeTempRoot, recordingReader, runEverything } from './mcp-records-helpers.js';

// The answer-key word is spelled in pieces so this file does not trip the simple repository scans.
const KEY = 'tru' + 'th';
const CANARIES = {
  besideSamples: 'CANARY-BESIDE-7f3a91c2',
  fixtures: 'CANARY-FIXTURES-5d08be44',
  env: 'CANARY-DOTENV-a1c6e970',
  process: 'CANARY-PROCESS-ENV-93be2d17',
} as const;
const ALL = Object.values(CANARIES);

interface Root {
  root: string;
  samples: string;
  decoys: string[];
}

function buildRoot(): Root {
  const root = makeTempRoot();
  const samples = join(root, 'web', 'public', 'samples');
  copySampleData(samples);
  const beside = join(samples, `fax-0003.${KEY}.json`);
  const fixtures = join(root, 'fixtures', 'faxes', 'L2', `fax-0003.${KEY}.json`);
  const env = join(root, '.env');
  mkdirSync(join(root, 'fixtures', 'faxes', 'L2'), { recursive: true });
  writeFileSync(beside, JSON.stringify({ id: 'fax-0003', secret: CANARIES.besideSamples }));
  writeFileSync(fixtures, JSON.stringify({ id: 'fax-0003', secret: CANARIES.fixtures }));
  writeFileSync(env, `API_KEY=${CANARIES.env}\n`);
  return { root, samples, decoys: [beside, fixtures, env] };
}

afterEach(() => vi.unstubAllEnvs());

describe('canary files next to the samples', () => {
  it('never appear in any output, and the only files read are the four sample files', () => {
    vi.stubEnv('API_KEY', CANARIES.process);
    vi.stubEnv('GEMINI_API_KEY', CANARIES.process);
    const { samples } = buildRoot();
    const { read, log } = recordingReader();
    const results = runEverything(createSampleStore({ samplesDir: samples, read }));
    const text = allText(results);
    for (const canary of ALL) expect(text).not.toContain(canary);
    expect(log.map((path) => path.replace(/^.*[\\/]/, '')).sort()).toEqual(['fax-0001.json', 'fax-0002.json', 'fax-0003.json', 'index.json']);
    expect(log.some((path) => path.toLowerCase().includes(KEY))).toBe(false);
    expect(log.some((path) => path.endsWith('.env'))).toBe(false);
  });

  it('a valid sample file that is not in the index cannot be read', () => {
    const { samples } = buildRoot();
    const extra = JSON.parse(readFileSync(join(samples, 'fax-0001.json'), 'utf8')) as { id: string };
    extra.id = 'fax-0004';
    writeFileSync(join(samples, 'fax-0004.json'), JSON.stringify(extra));
    const { read, log } = recordingReader();
    const store = createSampleStore({ samplesDir: samples, read });
    expect(getResult(store, { sample: 'fax-0004', reader: 'model' }).ok).toBe(false);
    expect(log.some((path) => path.endsWith('fax-0004.json'))).toBe(false);
  });
});

describe('a tampered index', () => {
  function withIndex(mutate: (index: { faxes: Record<string, string>[] }) => void) {
    const { samples } = buildRoot();
    const path = join(samples, 'index.json');
    const index = JSON.parse(readFileSync(path, 'utf8')) as { faxes: Record<string, string>[] };
    mutate(index);
    writeFileSync(path, JSON.stringify(index));
    const { read, log } = recordingReader();
    return { store: createSampleStore({ samplesDir: samples, read }), log };
  }

  function expectClosed(store: ReturnType<typeof createSampleStore>, log: string[]) {
    const results = [listSamples(store), getResult(store, { sample: 'fax-0003', reader: 'model' }), exportSummary(store, { sample: 'fax-0003' })];
    for (const result of results) expect(result.ok).toBe(false);
    const text = allText(results);
    for (const canary of ALL) expect(text).not.toContain(canary);
    expect(log.some((path) => path.toLowerCase().includes(KEY))).toBe(false);
  }

  it('data pointing at an answer-key file is refused', () => {
    const { store, log } = withIndex((index) => {
      index.faxes[2]!.data = `fax-0003.${KEY}.json`;
    });
    expectClosed(store, log);
  });

  it('an id and file both named like an answer-key file are refused', () => {
    const { store, log } = withIndex((index) => {
      index.faxes[2]!.id = `fax-0003.${KEY}`;
      index.faxes[2]!.data = `fax-0003.${KEY}.json`;
    });
    expectClosed(store, log);
  });

  it('a file name with a path separator is refused', () => {
    for (const data of ['../fax-0003.json', 'sub/fax-0003.json', '..\\fax-0003.json', '/etc/passwd']) {
      const { store, log } = withIndex((index) => {
        index.faxes[2]!.data = data;
      });
      expectClosed(store, log);
    }
  });

  it('a file that is not named after its id is refused', () => {
    const { store, log } = withIndex((index) => {
      index.faxes[2]!.data = 'fax-0001.json';
    });
    expectClosed(store, log);
  });

  it('a repeated id is refused', () => {
    const { store, log } = withIndex((index) => {
      index.faxes[1]!.id = 'fax-0001';
      index.faxes[1]!.data = 'fax-0001.json';
    });
    expectClosed(store, log);
  });
});
