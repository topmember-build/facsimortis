import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { FIELD_ORDER, type Field } from '../../src/extract/schema.js';
import { NO_SAVED_ANSWER_MESSAGE, SampleFaxSchema, type ReaderResult } from '../../src/samples/schema.js';
import { summariseFlags } from './flags';
import { formatReceived } from './format';
import { HELD_BACK_FAXES, initialVisibleCount, revealNext } from './inbox-state';
import { committedFaxes } from './test-site';

const field = (flags: string[], confidence = 0.99): Field => ({
  name: 'reason',
  value: null,
  wordIds: [],
  confidence,
  flags,
  reviewed: false,
});

describe('summariseFlags', () => {
  it('counts the fields whose flags list is not empty', () => {
    const result: ReaderResult = {
      status: 'ok',
      engine: 'test',
      fields: [field(['a']), field([]), field(['b', 'c'])],
    };
    expect(summariseFlags(result)).toEqual({ status: 'ok', count: 2 });
  });

  it('ignores confidence: low confidence without flags is not counted', () => {
    const result: ReaderResult = { status: 'ok', engine: 'test', fields: [field([], 0.01)] };
    expect(summariseFlags(result)).toEqual({ status: 'ok', count: 0 });
  });

  it('returns the message, not a count, when there is no saved answer', () => {
    const summary = summariseFlags({ status: 'no-saved-answer', message: NO_SAVED_ANSWER_MESSAGE });
    expect(summary).toEqual({ status: 'no-saved-answer', message: NO_SAVED_ANSWER_MESSAGE });
    expect('count' in summary).toBe(false);
  });

  it('counts exactly the flagged fields for any mix of flags', () => {
    fc.assert(
      fc.property(fc.array(fc.array(fc.string(), { maxLength: 3 }), { maxLength: FIELD_ORDER.length }), (lists) => {
        const result: ReaderResult = { status: 'ok', engine: 'test', fields: lists.map((flags) => field(flags)) };
        expect(summariseFlags(result)).toEqual({
          status: 'ok',
          count: lists.filter((flags) => flags.length > 0).length,
        });
      }),
    );
  });

  it('gives the counts of the committed sample faxes for both readers', () => {
    const counts = Object.values(committedFaxes).map((data) => {
      const fax = SampleFaxSchema.parse(data);
      return [summariseFlags(fax.readers.model), summariseFlags(fax.readers.rules)];
    });
    expect(counts).toEqual([
      [{ status: 'ok', count: 0 }, { status: 'ok', count: 0 }],
      [{ status: 'ok', count: 0 }, { status: 'ok', count: 3 }],
      [{ status: 'ok', count: 2 }, { status: 'ok', count: 2 }],
    ]);
  });
});

describe('formatReceived', () => {
  it('formats the written time without any time zone', () => {
    expect(formatReceived('2026-10-01T09:00:00')).toBe('Oct 1, 09:00');
    expect(formatReceived('2026-12-25T23:59:59')).toBe('Dec 25, 23:59');
  });
});

describe('inbox counts', () => {
  it('holds back the last fax at the start', () => {
    expect(HELD_BACK_FAXES).toBe(1);
    expect(initialVisibleCount(3)).toBe(2);
    expect(initialVisibleCount(0)).toBe(0);
  });

  it('reveals one fax per press and stops at the total', () => {
    let visible = initialVisibleCount(5);
    const seen = [visible];
    for (let i = 0; i < 3; i += 1) {
      visible = revealNext(visible, 5);
      seen.push(visible);
    }
    expect(seen).toEqual([4, 5, 5, 5]);
  });
});
