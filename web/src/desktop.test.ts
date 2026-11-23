import { describe, expect, it } from 'vitest';
import { NO_SAVED_ANSWER_MESSAGE, SampleFaxSchema, type SampleFax } from '../../src/samples/schema.js';
import type { FieldName } from '../../src/extract/schema.js';
import type { InboxItem } from './data';
import { DESKTOP_HINT, demoClock, trayStatus } from './desktop';
import type { VerifiedRecord } from './record';
import { EMPTY_REVIEW, reviewKey, reviewReducer, type ReviewState } from './review-state';
import { committedFaxes, committedIndex } from './test-site';

const REF = '2026-10-01';
const AT = '2026-10-01T09:30:00.000Z';
const entries = (committedIndex as { faxes: InboxItem['entry'][] }).faxes;
const fax = (id: string) => SampleFaxSchema.parse(committedFaxes[`${id}.json`]);
const item = (id: string, value: SampleFax = fax(id)): InboxItem => ({
  entry: entries.find((e) => e.id === id)!,
  imageUrl: `samples/${id}.png`,
  fax: { ok: true, value },
});
const failed = (id: string): InboxItem => ({ ...item(id), fax: { ok: false, error: `${id} is not in the expected form.` } });
const accept = (state: ReviewState, field: FieldName) => reviewReducer(state, { type: 'accept', field, originalValue: 'x', at: AT });
const model = (id: string, state: ReviewState) => ({ [reviewKey(id, 'model')]: state });

describe('trayStatus', () => {
  it('counts the faxes in the tray, singular and plural', () => {
    expect(trayStatus([], 'model', {}, REF, {}).tray).toBe('Now: 0 faxes in the tray');
    expect(trayStatus([item('fax-0001')], 'model', {}, REF, {}).tray).toBe('Now: 1 fax in the tray');
    expect(trayStatus([item('fax-0001'), item('fax-0002')], 'model', {}, REF, {}).tray).toBe('Now: 2 faxes in the tray');
  });

  it('names each fax with flagged fields, and only those, for the chosen reader', () => {
    const three = [item('fax-0001'), item('fax-0002'), item('fax-0003')];
    expect(trayStatus(three, 'model', {}, REF, {})).toEqual({
      tray: 'Now: 3 faxes in the tray',
      flagged: [{ text: '2 flagged on fax-0003', waiting: true }],
      noFlags: false,
    });
    expect(trayStatus(three.slice(0, 2), 'model', {}, REF, {}).flagged).toEqual([]);
    expect(trayStatus(three.slice(0, 2), 'rules', {}, REF, {}).flagged).toEqual([{ text: '3 flagged on fax-0002', waiting: true }]);
  });

  it('keeps the part after review, says so, and drops the flag colour only when nothing waits', () => {
    const three = [item('fax-0003')];
    const one = accept(EMPTY_REVIEW, 'npi');
    expect(trayStatus(three, 'model', model('fax-0003', one), REF, {}).flagged).toEqual([{ text: '2 flagged on fax-0003', waiting: true }]);
    const both = accept(one, 'callbackPhone');
    expect(trayStatus(three, 'model', model('fax-0003', both), REF, {}).flagged).toEqual([
      { text: '2 flagged on fax-0003, reviewed', waiting: false },
    ]);
    const verified = { [reviewKey('fax-0003', 'model')]: {} as VerifiedRecord };
    expect(trayStatus(three, 'model', model('fax-0003', both), REF, verified).flagged).toEqual([
      { text: '2 flagged on fax-0003, reviewed', waiting: false },
    ]);
  });

  it('gives no part, and never "0 flagged", for a fax with no saved answer or one that failed to load', () => {
    const noAnswer = structuredClone(fax('fax-0003'));
    noAnswer.readers.model = { status: 'no-saved-answer', message: NO_SAVED_ANSWER_MESSAGE };
    const status = trayStatus([item('fax-0003', noAnswer), failed('fax-0002')], 'model', {}, REF, {});
    expect(status).toEqual({ tray: 'Now: 2 faxes in the tray', flagged: [], noFlags: false });
  });

  it('claims "no flags" only when every fax in the tray was read and none is flagged', () => {
    expect(trayStatus([item('fax-0001'), item('fax-0002')], 'model', {}, REF, {}).noFlags).toBe(true);
    expect(trayStatus([], 'model', {}, REF, {}).noFlags).toBe(false);
    expect(trayStatus([item('fax-0001'), item('fax-0003')], 'model', {}, REF, {}).noFlags).toBe(false);
    expect(trayStatus([item('fax-0001'), failed('fax-0002')], 'model', {}, REF, {}).noFlags).toBe(false);
    const noAnswer = structuredClone(fax('fax-0002'));
    noAnswer.readers.model = { status: 'no-saved-answer', message: NO_SAVED_ANSWER_MESSAGE };
    expect(trayStatus([item('fax-0001'), item('fax-0002', noAnswer)], 'model', {}, REF, {}).noFlags).toBe(false);
  });
});

describe('demoClock', () => {
  it('shows the time the newest fax in the tray arrived, as written, never as UTC', () => {
    expect(demoClock([item('fax-0001'), item('fax-0002')])).toEqual({ iso: '2026-10-01T09:07:00', date: 'Oct 1', time: '09:07' });
    expect(demoClock([item('fax-0003'), item('fax-0001')])).toEqual({ iso: '2026-10-01T09:14:00', date: 'Oct 1', time: '09:14' });
    expect(JSON.stringify(demoClock([item('fax-0003')]))).not.toMatch(/UTC|Z"/);
  });

  it('is null when the tray is empty', () => {
    expect(demoClock([])).toBeNull();
  });
});

describe('desktop hint', () => {
  it('has the agreed text', () => {
    expect(DESKTOP_HINT).toBe('Open an icon to see a fax.');
  });
});
