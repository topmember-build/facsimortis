import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { FIELD_LABELS as WEB_FIELD_LABELS } from '../web/src/field-labels.js';
import { FIELD_ORDER } from '../src/extract/schema.js';
import { SampleFaxSchema } from '../src/samples/schema.js';
import { computeNpiCheckDigit, isValidNpi } from '../src/validators/npi.js';
import { NPI_FLAG, PHONE_FLAG } from '../src/validators/messages.js';
import { createSampleStore, DEFAULT_SAMPLES_DIR } from '../tools/mcp-records/data.js';
import {
  FIELD_LABELS,
  TOOLS,
  TOOL_NAMES,
  checkNpi,
  explainFlag,
  exportSummary,
  getResult,
  listSamples,
  outputs,
  type ToolResult,
} from '../tools/mcp-records/tools.js';
import { copySampleData, FIELD_NAMES, HOSTILE_VALUES, makeTempRoot, realStore, recordingReader, REAL_IDS, runEverything } from './mcp-records-helpers.js';

function ok<T>(result: ToolResult<T>): T {
  if (!result.ok) throw new Error(`expected ok, got: ${result.message}`);
  return result.data;
}

// web/src/record.ts and review-state.ts use extensionless imports (the site is built with a bundler), which the
// root TypeScript project cannot resolve. They are loaded at run time instead, through a path the compiler does not follow.
// So this one import is not type-checked: WebRecord below is written by hand. That is kept on purpose, because the
// alternative is changing site code for a test. The parity assertion still compares the real values at run time.
interface WebRecord {
  summarise(fields: readonly unknown[]): unknown;
  verifiedFields(fields: readonly unknown[], state: unknown): unknown[];
}
async function loadWeb(): Promise<{ record: WebRecord; emptyReview: unknown }> {
  const base = '../web/src/';
  const record = (await import(/* @vite-ignore */ `${base}record.ts`)) as WebRecord;
  const review = (await import(/* @vite-ignore */ `${base}review-state.ts`)) as { EMPTY_REVIEW: unknown };
  return { record, emptyReview: review.EMPTY_REVIEW };
}

const store = realStore();

describe('the tool list', () => {
  it('has exactly the five tools, each with a matching schema pair', () => {
    expect(TOOLS.map((tool) => tool.name)).toEqual([...TOOL_NAMES]);
    expect(TOOL_NAMES).toHaveLength(5);
    for (const tool of TOOLS) {
      expect(tool.description.length).toBeGreaterThan(40);
      expect(tool.description).toMatch(/Read-only|Nothing is stored/);
    }
  });

  it('says export_summary is as read, not reviewed', () => {
    const tool = TOOLS.find((candidate) => candidate.name === 'export_summary');
    expect(tool?.description).toMatch(/AS READ AND NOT REVIEWED/);
  });

  it('makes no compliance claim', () => {
    for (const tool of TOOLS) expect(tool.description).not.toMatch(/HIPAA|certified|compliant/i);
  });
});

describe('list_samples', () => {
  it('lists the three real samples with their flag counts', () => {
    const data = ok(listSamples(store));
    expect(outputs.list_samples.safeParse(data).success).toBe(true);
    expect(data.samples.map((sample) => sample.id)).toEqual([...REAL_IDS]);
    expect(data.referenceDate).toBe('2026-10-01');
    expect(data.note).toMatch(/Synthetic/);
    const byId = Object.fromEntries(data.samples.map((sample) => [sample.id, sample.flagged]));
    expect(byId['fax-0001']).toEqual({ model: 0, rules: 0 });
    expect(byId['fax-0002']?.model).toBe(0);
    expect(byId['fax-0002']?.rules).toBe(3);
    expect(byId['fax-0003']).toEqual({ model: 2, rules: 2 });
  });

  it('rejects extra arguments', () => {
    expect(listSamples(store, { extra: 1 }).ok).toBe(false);
  });
});

describe('get_result', () => {
  it('returns each field as saved, with the words it was read from', () => {
    const data = ok(getResult(store, { sample: 'fax-0003', reader: 'model' }));
    expect(outputs.get_result.safeParse(data).success).toBe(true);
    expect(data.status).toBe('ok');
    expect(data.fields?.map((field) => field.name)).toEqual([...FIELD_ORDER]);
    const npi = data.fields?.find((field) => field.name === 'npi');
    expect(npi?.value).toBe('6720988041');
    expect(npi?.flags).toEqual([NPI_FLAG]);
    expect(npi?.citedText).toContain('6720988041');
    const phone = data.fields?.find((field) => field.name === 'callbackPhone');
    expect(phone?.value).toBe('555~0151');
    expect(phone?.flags).toEqual([PHONE_FLAG]);
  });

  it('keeps an empty value empty and flagged', () => {
    const data = ok(getResult(store, { sample: 'fax-0002', reader: 'rules' }));
    const npi = data.fields?.find((field) => field.name === 'npi');
    expect(npi?.value).toBeNull();
    expect(npi?.flags.length).toBeGreaterThan(0);
    expect(npi?.citedText).toBe('');
  });

  it('every value is the same as in the sample file', () => {
    for (const id of REAL_IDS) {
      const fax = SampleFaxSchema.parse(JSON.parse(readFileSync(join(DEFAULT_SAMPLES_DIR, `${id}.json`), 'utf8')));
      for (const reader of ['model', 'rules'] as const) {
        const data = ok(getResult(store, { sample: id, reader }));
        const saved = fax.readers[reader];
        if (saved.status !== 'ok') continue;
        expect(data.fields?.map((field) => [field.name, field.value, field.flags])).toEqual(
          saved.fields.map((field) => [field.name, field.value, field.flags]),
        );
      }
    }
  });

  it('requires the reader (no default for get_result)', () => {
    expect(getResult(store, { sample: 'fax-0001' }).ok).toBe(false);
  });
});

describe('a sample with no saved answer', () => {
  it('says so and does not make one up', () => {
    const dir = makeTempRoot();
    copySampleData(dir);
    const path = join(dir, 'fax-0001.json');
    const fax = JSON.parse(readFileSync(path, 'utf8')) as { readers: { model: unknown } };
    fax.readers.model = { status: 'no-saved-answer', message: 'No saved model answer for this sample.' };
    writeFileSync(path, JSON.stringify(fax));
    const local = createSampleStore({ samplesDir: dir });
    const data = ok(getResult(local, { sample: 'fax-0001', reader: 'model' }));
    expect(data.status).toBe('no-saved-answer');
    expect(data.fields).toBeUndefined();
    expect(outputs.get_result.safeParse(data).success).toBe(true);
    expect(explainFlag(local, { sample: 'fax-0001', field: 'npi' }).ok).toBe(false);
    const summary = ok(exportSummary(local, { sample: 'fax-0001' }));
    expect(summary.readers.model.status).toBe('no-saved-answer');
    expect(summary.readers.model.summary).toBeUndefined();
    expect(summary.readers.rules.status).toBe('ok');
  });
});

describe('explain_flag', () => {
  it('defaults the reader to model', () => {
    const withDefault = ok(explainFlag(store, { sample: 'fax-0003', field: 'npi' }));
    const explicit = ok(explainFlag(store, { sample: 'fax-0003', field: 'npi', reader: 'model' }));
    expect(withDefault.reader).toBe('model');
    expect(withDefault).toEqual(explicit);
  });

  it('re-runs the check digit rule on the saved value', () => {
    const data = ok(explainFlag(store, { sample: 'fax-0003', field: 'npi' }));
    expect(outputs.explain_flag.safeParse(data).success).toBe(true);
    expect(data.flagged).toBe(true);
    expect(data.explanations).toHaveLength(1);
    const [explanation] = data.explanations;
    expect(explanation?.check).toBe('npi-check-digit');
    expect(explanation?.stillFails).toBe(true);
    expect(explanation?.detail).toContain(String(computeNpiCheckDigit('672098804')));
  });

  it('re-runs the phone shape rule', () => {
    const data = ok(explainFlag(store, { sample: 'fax-0003', field: 'callbackPhone', reader: 'rules' }));
    expect(data.explanations[0]?.check).toBe('phone-format');
    expect(data.explanations[0]?.stillFails).toBe(true);
  });

  it('shows a missing value as empty and never fills it in', () => {
    const data = ok(explainFlag(store, { sample: 'fax-0002', field: 'npi', reader: 'rules' }));
    expect(data.value).toBeNull();
    expect(data.note).toMatch(/never filled in by guessing/);
    expect(data.explanations[0]?.check).toBe('reader-note');
    expect(data.explanations[0]?.stillFails).toBeNull();
  });

  it('says an unflagged field is not the same as a reviewed one', () => {
    const data = ok(explainFlag(store, { sample: 'fax-0001', field: 'patientName' }));
    expect(data.flagged).toBe(false);
    expect(data.explanations).toEqual([]);
    expect(data.note).toMatch(/not that a person has looked at it/);
  });

  it('rejects a field name that is not one of the seven', () => {
    expect(explainFlag(store, { sample: 'fax-0001', field: 'ssn' }).ok).toBe(false);
  });
});

describe('check_npi', () => {
  it('accepts a number with the right last digit', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^\d{9}$/), (first9) => {
        const npi = first9 + String(computeNpiCheckDigit(first9));
        const data = ok(checkNpi(store, { npi }));
        expect(outputs.check_npi.safeParse(data).success).toBe(true);
        expect(data.valid).toBe(true);
        expect(data.wellFormed).toBe(true);
        expect(data.message).toBeNull();
        expect(data.expectedCheckDigit).toBe(computeNpiCheckDigit(first9));
      }),
    );
  });

  it('rejects a number with a wrong last digit and names the right one', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^\d{9}$/), fc.integer({ min: 1, max: 9 }), (first9, shift) => {
        const wrong = (computeNpiCheckDigit(first9) + shift) % 10;
        const data = ok(checkNpi(store, { npi: first9 + String(wrong) }));
        expect(data.valid).toBe(false);
        expect(data.wellFormed).toBe(true);
        expect(data.message).toBe(NPI_FLAG);
        expect(data.expectedCheckDigit).toBe(computeNpiCheckDigit(first9));
      }),
    );
  });

  it('agrees with the validator for any string and never throws', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 64 }), (npi) => {
        const result = checkNpi(store, { npi });
        const data = ok(result);
        expect(data.valid).toBe(isValidNpi(npi));
        if (!data.wellFormed) expect(data.valid).toBe(false);
      }),
    );
  });

  it('rejects a missing, non-string or oversized argument and extra keys', () => {
    for (const input of [undefined, {}, { npi: 1234567893 }, { npi: 'x'.repeat(65) }, { npi: '1234567893', extra: 1 }]) {
      expect(checkNpi(store, input).ok).toBe(false);
    }
  });

  it('does not read any file', () => {
    const { read, log } = recordingReader();
    checkNpi(createSampleStore({ read }), { npi: '1234567893' });
    expect(log).toEqual([]);
  });
});

describe('export_summary', () => {
  it('is as read, not reviewed, and says why', () => {
    const data = ok(exportSummary(store, { sample: 'fax-0003' }));
    expect(outputs.export_summary.safeParse(data).success).toBe(true);
    expect(data.status).toBe('as read, not reviewed');
    expect(data.basis).toMatch(/not the exported record of a verified review/);
    for (const reader of ['model', 'rules'] as const) {
      expect(data.readers[reader].summary?.reviewed).toBe(0);
      expect(data.readers[reader].summary?.edited).toBe(0);
      expect(data.readers[reader].summary?.acceptedDespiteFlag).toBe(0);
    }
  });

  it('matches the web app summary for an unreviewed fax', async () => {
    const { record, emptyReview } = await loadWeb();
    for (const id of REAL_IDS) {
      const fax = SampleFaxSchema.parse(JSON.parse(readFileSync(join(DEFAULT_SAMPLES_DIR, `${id}.json`), 'utf8')));
      const data = ok(exportSummary(store, { sample: id }));
      for (const reader of ['model', 'rules'] as const) {
        const saved = fax.readers[reader];
        if (saved.status !== 'ok') continue;
        expect(data.readers[reader].summary).toEqual(record.summarise(record.verifiedFields(saved.fields, emptyReview)));
      }
    }
  });
});

describe('parity with the web app', () => {
  it('uses the same field labels', () => {
    expect(FIELD_LABELS).toEqual(WEB_FIELD_LABELS);
    expect(Object.keys(FIELD_LABELS).sort()).toEqual([...FIELD_NAMES].sort());
  });
});

describe('hostile arguments', () => {
  it('never throw, and never repeat the argument back in an error', () => {
    const results = runEverything(store);
    expect(results.length).toBeGreaterThan(100);
    for (const result of results) {
      if (result.ok) continue;
      expect(result.message.length).toBeLessThanOrEqual(400);
      expect(result.message).not.toContain('x'.repeat(100));
      expect(result.message).not.toContain('etc/passwd');
      expect(result.message).not.toContain('win.ini');
    }
  });

  it('refuses every hostile sample id', () => {
    for (const value of HOSTILE_VALUES) {
      expect(getResult(store, { sample: value, reader: 'model' }).ok).toBe(false);
      expect(exportSummary(store, { sample: value }).ok).toBe(false);
      expect(explainFlag(store, { sample: value, field: 'npi' }).ok).toBe(false);
    }
  });

  it('refuses any id that is not in the index, for any string', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 64 }), (sample) => {
        fc.pre(!REAL_IDS.includes(sample as (typeof REAL_IDS)[number]));
        expect(getResult(store, { sample, reader: 'model' }).ok).toBe(false);
      }),
    );
  });

  it('lists the known ids in the unknown-sample message', () => {
    const result = getResult(store, { sample: 'fax-9999', reader: 'model' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('fax-0001');
      expect(result.message).not.toContain('fax-9999');
    }
  });
});

describe('what is read', () => {
  it('only index.json and the three fax files, each once', () => {
    const { read, log } = recordingReader();
    runEverything(createSampleStore({ read }));
    const names = log.map((path) => path.replace(/^.*[\\/]/, '')).sort();
    expect(names).toEqual(['fax-0001.json', 'fax-0002.json', 'fax-0003.json', 'index.json']);
  });
});
