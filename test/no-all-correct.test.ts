import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

describe('wording', () => {
  it('never claims that all values are correct anywhere in web/src', () => {
    const phrase = new RegExp(['all', 'correct'].join(' '), 'i');
    const offenders = files('web/src').filter((file) => phrase.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('the summary lines make no claim that values are right', () => {
    const text = readFileSync('web/src/record.ts', 'utf8');
    for (const claim of ['verified as correct', 'no errors', 'everything looks good', 'all good']) {
      expect(text.toLowerCase()).not.toContain(claim);
    }
  });
});