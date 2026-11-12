import { checkCitations } from './citation.js';
import { checkNpi } from './checks.js';
import { GeminiClient } from './gemini.js';
import { ModelExtractor } from './model.js';
import { RecordedResponseCache } from './recorded.js';
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
  if (provider === 'model') {
    // Live call. The key and model are read from env only when a call is made.
    const client = new GeminiClient({ env });
    return withChecks(new ModelExtractor((_ocr, request) => client.generate(request)));
  }
  if (provider === 'recorded') {
    // Offline: saved answers only. Needs no .env and no key.
    const cache = new RecordedResponseCache();
    return withChecks(
      new ModelExtractor(async (ocr) => {
        const saved = await cache.get(ocr);
        if (saved === undefined) {
          throw new ExtractionError(
            'There is no saved answer for this fax. Run "npm run record:live" once, or use the rule-based reader.',
          );
        }
        return { model: saved.model, text: saved.text };
      }),
    );
  }
  throw new ExtractionError(
    `EXTRACT_PROVIDER "${provider}" is not recognised. Allowed values are "rules", "model" and "recorded".`,
  );
}
