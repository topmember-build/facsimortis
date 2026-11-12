import { checkCitations } from './citation.js';
import { checkNpi } from './checks.js';
import { ExtractionError } from './types.js';
import type { ExtractionAdapter } from './types.js';

export * from './schema.js';
export * from './types.js';

/**
 * Rule extractor seam: the rule-based extractor (step 0.5.2) calls
 * registerRuleExtractor(() => new RuleExtractor()). Until then createExtractor
 * throws a clear ExtractionError for "rules" or unset.
 */
let ruleFactory: (() => ExtractionAdapter) | undefined;

export function registerRuleExtractor(factory: (() => ExtractionAdapter) | undefined): void {
  ruleFactory = factory;
}

/**
 * Central checks (0.6, 0.8.1). Every adapter that createExtractor returns is wrapped
 * here, so the rule-based reader and any future model or recorded reader get both
 * checks without doing anything. Order: citation check first, then the NPI check
 * (a field the citation check emptied is null and skipped). Add new providers inside
 * createExtractor, never return a bare adapter. Name and close() pass through unchanged.
 */
export function withChecks(inner: ExtractionAdapter): ExtractionAdapter {
  const wrapped: ExtractionAdapter = {
    name: inner.name,
    async extract(ocr) {
      const cited = checkCitations(await inner.extract(ocr), ocr).result;
      return checkNpi(cited).result;
    },
  };
  if (inner.close !== undefined) {
    wrapped.close = () => inner.close!();
  }
  return wrapped;
}

/** Kept for callers that used the old name. */
export const withCitationCheck = withChecks;

export function createExtractor(
  env: Record<string, string | undefined> = process.env,
): ExtractionAdapter {
  const provider = (env['EXTRACT_PROVIDER'] ?? '').trim().toLowerCase() || 'rules';
  if (provider === 'rules') {
    if (ruleFactory === undefined) {
      throw new ExtractionError('The rule-based reader is not available yet.');
    }
    return withChecks(ruleFactory());
  }
  if (provider === 'model' || provider === 'recorded') {
    throw new ExtractionError('The model reader is not set up yet. Use the rule-based reader.');
  }
  throw new ExtractionError(
    `EXTRACT_PROVIDER "${provider}" is not recognised. Allowed values are "rules", "model" and "recorded".`,
  );
}
