import { z } from 'zod';

/**
 * The export card for scene 5: a clean excerpt of the JSON file the site downloaded, shown as a page.
 * Pure: it takes the file's text and returns HTML. It shows, exactly as saved, the original value of each
 * field that was flagged or reviewed, the reviewer's edits, the checks that failed when a field was
 * accepted anyway, the verifier, and the file's Synthetic data notice. Every value is escaped.
 */

/** Only the parts of the exported record the card shows. The site's own schema (web/src/record.ts) is stricter. */
const ExportFieldSchema = z.object({
  name: z.string().min(1),
  label: z.string().min(1),
  originalValue: z.string().nullable(),
  originalFlags: z.array(z.string()),
  finalValue: z.string().nullable(),
  source: z.enum(['page', 'reviewer']),
  reviewed: z.boolean(),
  acceptedDespiteFlag: z.boolean(),
  failedChecks: z.array(z.string()),
});

export const ExportExcerptSchema = z.object({
  synthetic: z.literal(true),
  notice: z.string().min(1),
  faxId: z.string().min(1),
  reader: z.enum(['model', 'rules']),
  verifiedAtUtc: z.string().min(1),
  verifier: z.string().min(1),
  fields: z.array(ExportFieldSchema).min(1),
});

export type ExportExcerpt = z.infer<typeof ExportExcerptSchema>;

/** Parses the downloaded file. Throws a plain error naming the file when it is not an exported record. */
export function parseExport(text: string, fileName: string): ExportExcerpt {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${fileName} is not valid JSON.`);
  }
  const result = ExportExcerptSchema.safeParse(json);
  if (!result.success) {
    const where = result.error.issues.map((issue) => issue.path.join('.') || '(top level)').join(', ');
    throw new Error(`${fileName} is not an exported record the card can show (problem at: ${where}).`);
  }
  return result.data;
}

export interface CardLine {
  /** Plain words for a front-desk reader. */
  caption: string;
  /** The key in the file. */
  key: string;
  /** The value exactly as saved, written as JSON writes it. */
  value: string;
  /** A line about a failed check, drawn in the flag colour. */
  flag: boolean;
}

export interface CardField {
  label: string;
  lines: CardLine[];
}

const asSaved = (value: string | boolean | null): string => JSON.stringify(value);

/** Pure. The fields the card shows (flagged or reviewed, in file order) and the lines for each. */
export function cardFields(record: ExportExcerpt): CardField[] {
  return record.fields
    .filter((field) => field.originalFlags.length > 0 || field.reviewed)
    .map((field) => {
      const lines: CardLine[] = [
        { caption: 'As read from the page', key: 'originalValue', value: asSaved(field.originalValue), flag: false },
      ];
      if (field.source === 'reviewer') {
        lines.push({ caption: 'Edited by the reviewer', key: 'finalValue', value: asSaved(field.finalValue), flag: false });
      }
      if (field.acceptedDespiteFlag) {
        lines.push({ caption: 'Accepted although the check failed', key: 'acceptedDespiteFlag', value: asSaved(true), flag: true });
        for (const check of field.failedChecks) {
          lines.push({ caption: 'The check that failed', key: 'failedChecks', value: asSaved(check), flag: true });
        }
      }
      return { label: field.label, lines };
    });
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** The site's own font files, under its fonts/ folder. */
const FONTS = [
  { family: 'Pixelify Sans', weight: 600, file: 'pixelify-sans/pixelify-sans-latin-600-normal.woff2' },
  { family: 'Inter Tight', weight: 400, file: 'inter-tight/inter-tight-latin-400-normal.woff2' },
  { family: 'Inter Tight', weight: 600, file: 'inter-tight/inter-tight-latin-600-normal.woff2' },
  { family: 'IBM Plex Mono', weight: 400, file: 'ibm-plex-mono/ibm-plex-mono-latin-400-normal.woff2' },
] as const;

export interface CardOptions {
  /** The downloaded file's name, shown at the top. */
  fileName: string;
  /** The served site, for its fonts, for example "http://localhost:4173/facsimortis/". */
  siteUrl: string;
}

function checkedSiteUrl(siteUrl: string): URL {
  const url = new URL(siteUrl);
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.pathname.endsWith('/') || url.search || url.hash) {
    throw new Error(`The site URL for the export card must be an http(s) folder URL ending in "/", got ${siteUrl}`);
  }
  return url;
}

/** Pure. The card as a complete HTML page. No scripts; a content security policy allows only the site's fonts. */
export function exportCardHtml(record: ExportExcerpt, options: CardOptions): string {
  const site = checkedSiteUrl(options.siteUrl);
  const fontFaces = FONTS.map(
    (font) =>
      `@font-face { font-family: '${font.family}'; font-weight: ${font.weight}; font-display: block; src: url('${new URL(`fonts/${font.file}`, site).href}') format('woff2'); }`,
  ).join('\n');
  const meta = [
    { caption: 'Fax', key: 'faxId', value: asSaved(record.faxId) },
    { caption: 'Reader', key: 'reader', value: asSaved(record.reader) },
    { caption: 'Verified by', key: 'verifier', value: asSaved(record.verifier) },
    { caption: 'Verified at', key: 'verifiedAtUtc', value: asSaved(record.verifiedAtUtc) },
  ];
  const line = (caption: string, key: string, value: string, flag: boolean) =>
    `<div class="line${flag ? ' flag' : ''}"><div class="caption">${escapeHtml(caption)}<span class="key">${escapeHtml(key)}</span></div><div class="value">${escapeHtml(value)}</div></div>`;
  const fields = cardFields(record)
    .map(
      (field) =>
        `<section class="field"><h2>${escapeHtml(field.label)}</h2>${field.lines.map((l) => line(l.caption, l.key, l.value, l.flag)).join('')}</section>`,
    )
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src ${escapeHtml(site.origin)}">
<title>${escapeHtml(options.fileName)}</title>
<style>
${fontFaces}
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; background: #141414; color: #fff3dc; font-family: 'Inter Tight', system-ui, sans-serif; font-size: 18px; }
.notice { padding: 8px 24px; background: #05101a; color: #c98a2b; border-bottom: 2px solid #5a3f14; font-size: 15px; }
.card { width: min(1100px, calc(100vw - 96px)); margin: 40px auto; padding: 28px 36px; background: #181512; border: 2px solid #f6a93b; }
h1 { margin: 0 0 4px; font-family: 'Pixelify Sans', ui-monospace, monospace; font-weight: 600; font-size: 34px; color: #f6a93b; }
.file { margin: 0 0 20px; font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 16px; color: #9aa4b2; }
h2 { margin: 18px 0 6px; font-size: 20px; font-weight: 600; }
.line { display: grid; grid-template-columns: 320px 1fr; gap: 16px; padding: 6px 0; border-top: 1px solid #262d38; }
.caption { color: #fff3dc; }
.key { display: block; font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 14px; color: #9aa4b2; }
.value { font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 18px; overflow-wrap: anywhere; }
.flag .caption, .flag .value { color: #ff9a8d; }
.foot { margin: 18px 0 0; font-size: 15px; color: #9aa4b2; }
</style>
</head>
<body>
<div class="notice" role="region" aria-label="Synthetic data notice">${escapeHtml(record.notice)}</div>
<main class="card">
<h1>Exported record</h1>
<p class="file">${escapeHtml(options.fileName)}</p>
<section class="meta">${meta.map((m) => line(m.caption, m.key, m.value, false)).join('')}</section>
${fields}
<p class="foot">An excerpt of the downloaded file. Values are shown exactly as saved.</p>
</main>
</body>
</html>
`;
}
