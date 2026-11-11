/** Pure NPI validation (Luhn over the "80840" prefix + 9 digits). */

export function computeNpiCheckDigit(first9: string): number {
  if (!/^\d{9}$/.test(first9)) {
    throw new Error('first9 must be exactly 9 ASCII digits');
  }
  const digits = ('80840' + first9).split('').map(Number);
  let sum = 0;
  // Check digit sits to the right of these 14 digits, so the rightmost one is doubled.
  for (let i = digits.length - 1, double = true; i >= 0; i--, double = !double) {
    let d = digits[i] ?? 0;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return (10 - (sum % 10)) % 10;
}

export function isValidNpi(npi: string): boolean {
  if (!/^\d{10}$/.test(npi)) return false;
  return Number(npi[9]) === computeNpiCheckDigit(npi.slice(0, 9));
}
