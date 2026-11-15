import { readFileSync } from 'node:fs';

/**
 * The precompute script must never read the answer-key files that the fax generator
 * writes next to each PNG (names ending in ".truth.json"). Every file it reads goes
 * through readInput, which refuses those names. This file is deliberately outside
 * the lint and scan rules that forbid that word in the precompute code.
 */
const ANSWER_KEY = /truth/i;

export function isAnswerKeyPath(path: string): boolean {
  return ANSWER_KEY.test(path);
}

export function readInput(path: string): Buffer {
  if (isAnswerKeyPath(path)) {
    throw new Error(`Refusing to read an answer-key file: ${path}`);
  }
  return readFileSync(path);
}
