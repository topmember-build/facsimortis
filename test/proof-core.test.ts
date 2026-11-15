import { describe, expect, it } from 'vitest';
import type { OcrResult } from '../src/ocr/types.js';
import type { ExtractionResult, Field } from '../src/extract/schema.js';
import { parseReader, proveFax, proveField, tally } from '../src/scripts/proof-core.js';

const ocr = {
  engine: 'test',
  words: [
    { id: 'w1', text: 'Nell', box: [0, 0, 1, 1], confidence: 0.9 },
    { id: 'w2', text: 'Copperfield', box: [0, 0, 1, 1], confidence: 0.9 },
  ],
} as unknown as OcrResult;

const f = (over: Partial<Field>): Field => ({
  name: 'patientName',
  value: 'Nell Copperfield',
  wordIds: ['w1', 'w2'],
  confidence: 0.9,
  flags: [],
  reviewed: false,
  ...over,
});

describe('proof gate', () => {
  it('passes a cited exact value', () => {
    const p = proveField(f({}), 'Nell Copperfield', ocr);
    expect(p.gateFailures).toEqual([]);
    expect(p.tier).toBe('exact');
  });

  it('fails an unknown cited word and an invented value', () => {
    expect(proveField(f({ wordIds: ['w1', 'w9'] }), null, ocr).gateFailures.length).toBeGreaterThan(0);
    expect(proveField(f({ value: 'Nell Copperfield Jr' }), null, ocr).gateFailures.length).toBeGreaterThan(0);
  });

  it('fails an empty field without a reason, passes with one', () => {
    const empty = f({ value: null, wordIds: [] });
    expect(proveField(empty, 'x', ocr).gateFailures.length).toBe(1);
    expect(proveField({ ...empty, flags: ['Not found.'] }, 'x', ocr).gateFailures).toEqual([]);
  });

  it('names unflagged misreads and counts correct-but-flagged', () => {
    const result = {
      engine: 'test',
      fields: [f({ value: 'Nell', wordIds: ['w1'] }), f({ flags: ['check'] })],
    } as unknown as ExtractionResult;
    const proof = proveFax('fax-x', null, [{ name: 'patientName', value: 'Nell Copperfield' }], result, ocr);
    const t = tally([proof]);
    expect(t.unflaggedMisreads).toEqual(['fax-x patientName']);
    expect(t.correctButFlagged).toEqual(['fax-x patientName']);
  });

  it('requires the bad-npi fax to flag its NPI', () => {
    const npi = f({ name: 'npi' });
    const bad = proveFax('fax-y', 'bad-npi', [], { engine: 't', fields: [npi] } as ExtractionResult, ocr);
    expect(bad.gateFailures.some((g) => g.includes('bad-npi'))).toBe(true);
    const ok = proveFax('fax-y', 'bad-npi', [], { engine: 't', fields: [{ ...npi, flags: ['wrong'] }] } as ExtractionResult, ocr);
    expect(ok.gateFailures.some((g) => g.includes('bad-npi'))).toBe(false);
  });
});

describe('proof --reader option', () => {
  it('defaults to rules', () => {
    expect(parseReader([])).toEqual({ ok: true, reader: 'rules' });
  });

  it('accepts both spellings for each reader', () => {
    expect(parseReader(['--reader', 'recorded'])).toEqual({ ok: true, reader: 'recorded' });
    expect(parseReader(['--reader=recorded'])).toEqual({ ok: true, reader: 'recorded' });
    expect(parseReader(['--reader', 'rules'])).toEqual({ ok: true, reader: 'rules' });
  });

  it('rejects the live model, unknown readers, a missing value and other options', () => {
    expect(parseReader(['--reader', 'model']).ok).toBe(false);
    expect(parseReader(['--reader=nope']).ok).toBe(false);
    expect(parseReader(['--reader']).ok).toBe(false);
    expect(parseReader(['--reader', '--x']).ok).toBe(false);
    expect(parseReader(['recorded']).ok).toBe(false);
  });
});
describe('trap fields in the measured tier', () => {
  const npi = (flags: string[]): Field => f({ name: 'npi', value: 'Nell', wordIds: ['w1'], flags });
  const truth = [{ name: 'npi', value: 'Nell' }];

  it('counts a flagged trap field as expected, not as correct but flagged', () => {
    const proof = proveFax('fax-t', 'bad-npi', truth, { engine: 't', fields: [npi(['wrong'])] } as ExtractionResult, ocr);
    const t = tally([proof]);
    expect(t.expectedTrapFlags).toEqual(['fax-t npi']);
    expect(t.correctButFlagged).toEqual([]);
    expect(proof.fields[0]?.tier).toBe('exact');
  });

  it('still counts the same flag as correct but flagged on a fax without the trap', () => {
    const proof = proveFax('fax-u', null, truth, { engine: 't', fields: [npi(['wrong'])] } as ExtractionResult, ocr);
    const t = tally([proof]);
    expect(t.expectedTrapFlags).toEqual([]);
    expect(t.correctButFlagged).toEqual(['fax-u npi']);
  });

  it('does not mark an unflagged trap field as expected', () => {
    const proof = proveFax('fax-v', 'bad-npi', truth, { engine: 't', fields: [npi([])] } as ExtractionResult, ocr);
    expect(tally([proof]).expectedTrapFlags).toEqual([]);
    expect(proof.gateFailures.some((g) => g.includes('bad-npi'))).toBe(true);
  });
});