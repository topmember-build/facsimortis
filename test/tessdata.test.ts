import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = resolve(__dirname, '..', 'assets', 'tessdata');
const dataPath = resolve(dir, 'eng.traineddata');

// Values recorded in assets/tessdata/SOURCE.md.
const EXPECTED_SIZE = 4113088;
const EXPECTED_SHA256 = '7D4322BD2A7749724879683FC3912CB542F19906C83BCC1A52132556427170B2';

describe('vendored tessdata', () => {
  it('has eng.traineddata with the recorded size', () => {
    expect(existsSync(dataPath)).toBe(true);
    expect(statSync(dataPath).size).toBe(EXPECTED_SIZE);
  });

  it('matches the SHA256 recorded in SOURCE.md', () => {
    const actual = createHash('sha256').update(readFileSync(dataPath)).digest('hex').toUpperCase();
    expect(actual).toBe(EXPECTED_SHA256);
    const source = readFileSync(resolve(dir, 'SOURCE.md'), 'utf8').toUpperCase();
    expect(source).toContain(EXPECTED_SHA256);
  });

  it('keeps the Apache license alongside', () => {
    const license = readFileSync(resolve(dir, 'LICENSE-tessdata'), 'utf8');
    expect(license).toContain('Apache License');
  });
});
