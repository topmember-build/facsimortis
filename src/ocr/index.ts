import { CloudOcrAdapter } from './cloud.js';
import { OcrError } from './types.js';
import type { OcrAdapter } from './types.js';

export * from './types.js';
export { assignWordIds, clampBox, normalizeConfidence } from './normalize.js';
export { CloudOcrAdapter } from './cloud.js';

/**
 * Local adapter seam: the local adapter (step 0.4.3) calls
 * registerLocalAdapter(() => new LocalOcrAdapter()) when its module loads, and
 * imports of it are wired in here then. Until then no local adapter exists and
 * createOcrAdapter throws a clear OcrError for "local" or unset.
 */
let localFactory: (() => OcrAdapter) | undefined;

export function registerLocalAdapter(factory: (() => OcrAdapter) | undefined): void {
  localFactory = factory;
}

export function createOcrAdapter(
  env: Record<string, string | undefined> = process.env,
): OcrAdapter {
  const provider = (env['OCR_PROVIDER'] ?? '').trim().toLowerCase() || 'local';
  if (provider === 'cloud') {
    const apiKey = env['OCR_API_KEY'];
    return new CloudOcrAdapter(apiKey ? { apiKey } : {});
  }
  if (provider === 'local') {
    if (localFactory === undefined) {
      throw new OcrError('The local reader is not available yet.');
    }
    return localFactory();
  }
  throw new OcrError(
    `OCR_PROVIDER "${provider}" is not recognised. Allowed values are "local" and "cloud".`,
  );
}
