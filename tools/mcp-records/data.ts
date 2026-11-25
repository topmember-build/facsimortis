/**
 * Where the records server gets its data: the committed sample files in web/public/samples/ and nothing else.
 *
 * - This file never imports a file system module. Every read goes through readInput in
 *   src/scripts/read-guard.ts, which refuses answer-key file names. eslint.config.js lets this file import only
 *   node:path and node:url, and test/mcp-records-static.test.ts checks it.
 * - File names come from the sample index (checked by SampleIndexSchema) and are further required to be exactly
 *   "<id>.json". A tool argument is never turned into a path: tools.ts only looks an id up in the index.
 * - The samples folder is found from this file's own place, not from the working directory, so the server works
 *   whichever folder it is started from.
 */
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SampleFaxSchema, SampleIndexSchema, type SampleFax, type SampleIndex } from '../../src/samples/schema.js';
import { isAnswerKeyPath, readInput } from '../../src/scripts/read-guard.js';

/** The committed sample data of this repository. */
export const DEFAULT_SAMPLES_DIR = fileURLToPath(new URL('../../web/public/samples/', import.meta.url));

/** Reads one file. The default is readInput; tests pass a recording wrapper around it. */
export type ReadFile = (path: string) => Buffer;

/** A problem with the sample data itself, in words a person can read. */
export class SampleDataError extends Error {
  override readonly name = 'SampleDataError';
}

export interface SampleStoreOptions {
  /** The folder holding index.json and the fax files. Default: the repository's web/public/samples. */
  samplesDir?: string;
  /** How a file is read. Default: readInput from src/scripts/read-guard.ts. */
  read?: ReadFile;
}

export interface SampleStore {
  /** The folder the data is read from. */
  readonly samplesDir: string;
  /** The validated sample index. Read once, then kept. */
  index(): SampleIndex;
  /** The sample ids, in index order. */
  ids(): string[];
  /** The validated data of one sample. Throws SampleDataError when the id is not in the index or a check fails. */
  fax(id: string): SampleFax;
}

export function createSampleStore(options: SampleStoreOptions = {}): SampleStore {
  const samplesDir = options.samplesDir ?? DEFAULT_SAMPLES_DIR;
  const read: ReadFile = options.read ?? readInput;
  let indexCache: SampleIndex | undefined;
  const faxCache = new Map<string, SampleFax>();

  function readJson(name: string): unknown {
    // The name comes from the validated index, never from a tool argument. These checks are a second wall.
    if (name !== basename(name) || isAnswerKeyPath(name)) {
      throw new SampleDataError(`Refusing to read ${JSON.stringify(name)}: it is not a sample data file.`);
    }
    let text: string;
    try {
      text = read(join(samplesDir, name)).toString('utf8');
    } catch (error) {
      throw new SampleDataError(`Could not read the sample file ${name}: ${error instanceof Error ? error.message : 'unknown problem'}`);
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new SampleDataError(`The sample file ${name} is not valid JSON.`);
    }
  }

  function index(): SampleIndex {
    if (indexCache) return indexCache;
    const parsed = SampleIndexSchema.safeParse(readJson('index.json'));
    if (!parsed.success) throw new SampleDataError('The sample index does not match its schema.');
    const seen = new Set<string>();
    for (const entry of parsed.data.faxes) {
      if (seen.has(entry.id)) throw new SampleDataError('The sample index lists the same id twice.');
      seen.add(entry.id);
      if (entry.data !== `${entry.id}.json`) {
        throw new SampleDataError(`The sample index points ${JSON.stringify(entry.id)} at a file that is not named after it.`);
      }
    }
    indexCache = parsed.data;
    return indexCache;
  }

  function fax(id: string): SampleFax {
    const cached = faxCache.get(id);
    if (cached) return cached;
    const entry = index().faxes.find((candidate) => candidate.id === id);
    if (!entry) throw new SampleDataError('That sample is not in the index.');
    const parsed = SampleFaxSchema.safeParse(readJson(entry.data));
    if (!parsed.success) throw new SampleDataError(`The sample file ${entry.data} does not match its schema.`);
    if (parsed.data.id !== entry.id) throw new SampleDataError(`The sample file ${entry.data} belongs to another sample.`);
    faxCache.set(id, parsed.data);
    return parsed.data;
  }

  return {
    samplesDir,
    index,
    ids: () => index().faxes.map((entry) => entry.id),
    fax,
  };
}
