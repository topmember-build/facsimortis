// Writes the three Phase 0 synthetic faxes (PNG + truth JSON) under fixtures/faxes/.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { buildFax, phase0Specs } from '../generator/fax.js';

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function parseSeed(raw: string, source: string): number {
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))) {
    fail(`The seed must be a whole number, such as 42. Got "${raw}" from ${source}.`);
  }
  return Number(raw);
}

let values: { seed?: string | undefined };
try {
  const parsed = parseArgs({
    options: { seed: { type: 'string' }, count: { type: 'string' }, levels: { type: 'string' } },
    allowPositionals: false,
  });
  values = parsed.values;
  if (parsed.values.count !== undefined || parsed.values.levels !== undefined) {
    fail('Only the three Phase 0 faxes are supported. Use --seed N to change the seed.');
  }
} catch {
  fail('Unknown option. Only --seed N is supported; it writes the three Phase 0 faxes.');
}

const envSeed = process.env['FAX_SEED'];
const seed =
  values.seed !== undefined
    ? parseSeed(values.seed, '--seed')
    : envSeed !== undefined && envSeed !== ''
      ? parseSeed(envSeed, 'FAX_SEED')
      : 42;

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const specs = phase0Specs(seed);

for (const spec of specs) {
  const { png, truth, truthJson } = buildFax(spec);
  const dir = join(root, 'fixtures', 'faxes', spec.level);
  mkdirSync(dir, { recursive: true });
  const pngPath = join(dir, `${spec.id}.png`);
  writeFileSync(pngPath, png);
  writeFileSync(join(dir, `${spec.id}.truth.json`), truthJson, 'utf8');
  const rel = `fixtures/faxes/${spec.level}/${spec.id}.png`;
  console.log(
    `${rel}  template=${truth.template}  trap=${truth.trap ?? 'none'}  skew=${truth.degradation.skewDegrees}`,
  );
}
console.log(`${specs.length} synthetic faxes written (seed ${seed}).`);
