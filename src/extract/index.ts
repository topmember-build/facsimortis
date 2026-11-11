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

export function createExtractor(
  env: Record<string, string | undefined> = process.env,
): ExtractionAdapter {
  const provider = (env['EXTRACT_PROVIDER'] ?? '').trim().toLowerCase() || 'rules';
  if (provider === 'rules') {
    if (ruleFactory === undefined) {
      throw new ExtractionError('The rule-based reader is not available yet.');
    }
    return ruleFactory();
  }
  if (provider === 'model' || provider === 'recorded') {
    throw new ExtractionError('The model reader is not set up yet. Use the rule-based reader.');
  }
  throw new ExtractionError(
    `EXTRACT_PROVIDER "${provider}" is not recognised. Allowed values are "rules", "model" and "recorded".`,
  );
}
