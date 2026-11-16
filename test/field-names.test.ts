import { describe, expect, it } from 'vitest';
import { PLAIN_FIELD_NAMES } from '../src/extract/names.js';
import { FIELD_LABELS } from '../web/src/field-labels.js';

// The site shows each name with a capital first letter ("Callback phone"); the
// extraction messages use it inside a sentence ("callback phone"). The words must match.
const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

describe('plain field names', () => {
  it('have the same keys in the site and in the extraction messages', () => {
    expect(Object.keys(FIELD_LABELS).sort()).toEqual(Object.keys(PLAIN_FIELD_NAMES).sort());
  });

  it('use the same words, apart from the capital first letter', () => {
    for (const [key, plain] of Object.entries(PLAIN_FIELD_NAMES)) {
      const label = FIELD_LABELS[key as keyof typeof FIELD_LABELS];
      expect(label.charAt(0)).toBe(label.charAt(0).toUpperCase());
      expect(lowerFirst(label)).toBe(plain);
    }
  });
});