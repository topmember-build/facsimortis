const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * "2026-10-01T09:00:00" becomes "Oct 1, 09:00". The value has no time zone and is read
 * as written, so the result never depends on the machine's time zone.
 */
export function formatReceived(receivedAt: string): string {
  const match = /^\d{4}-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(receivedAt);
  const month = match ? MONTHS[Number(match[1]) - 1] : undefined;
  if (!match || !month) return receivedAt;
  return `${month} ${Number(match[2])}, ${match[3]}:${match[4]}`;
}

/**
 * An ISO time ending in Z becomes "Oct 1, 09:30 UTC". Read from the text, never through
 * Date, so the result does not depend on the machine's time zone.
 */
export function formatUtc(isoUtc: string): string {
  return `${formatReceived(isoUtc)} UTC`;
}
