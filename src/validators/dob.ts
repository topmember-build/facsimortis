/** Pure DOB validation. Format MM/DD/YYYY. The caller supplies "today". */

const MAX_AGE_YEARS = 120;

function parseToday(today: Date | string): [number, number, number] | null {
  if (today instanceof Date) {
    if (Number.isNaN(today.getTime())) return null;
    return [today.getUTCFullYear(), today.getUTCMonth() + 1, today.getUTCDate()];
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(today);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function isValidDob(dob: string, today: Date | string): boolean {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(dob);
  const t = parseToday(today);
  if (!m || !t) return false;
  const month = Number(m[1]);
  const day = Number(m[2]);
  const year = Number(m[3]);
  if (year < 1 || month < 1 || month > 12) return false;
  if (day < 1 || day > daysInMonth(year, month)) return false;

  const key = (y: number, mo: number, d: number): number => y * 10000 + mo * 100 + d;
  const dobKey = key(year, month, day);
  const [ty, tm, td] = t;
  if (dobKey > key(ty, tm, td)) return false;
  // Oldest allowed: same calendar day 120 years ago (Feb 29 clamps to Feb 28).
  const oldestDay = Math.min(td, daysInMonth(ty - MAX_AGE_YEARS, tm));
  return dobKey >= key(ty - MAX_AGE_YEARS, tm, oldestDay);
}
