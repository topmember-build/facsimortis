/** Fake referral content. All names, clinics and numbers are invented. ASCII only. */
import { computeNpiCheckDigit } from '../validators/npi.js';
import type { Rng } from './prng.js';

export const REFERENCE_DATE = '2026-10-01';

export type Urgency = 'routine' | 'urgent' | 'emergent';
export type Trap = 'bad-npi' | null;

export interface Referral {
  patientName: string;
  dob: string;
  referringProvider: string;
  npi: string;
  reason: string;
  urgency: Urgency;
  callbackPhone: string;
}

export interface ReferralOptions {
  trap: Trap;
  referenceDate: string;
}

const FIRST_NAMES = [
  'Alder', 'Bramwell', 'Cora', 'Dalton', 'Elowen', 'Fenn', 'Greta', 'Hollis',
  'Iris', 'Jasper', 'Kestrel', 'Linnea', 'Marlow', 'Nell', 'Orson', 'Pippa',
] as const;
const LAST_NAMES = [
  'Ashgrove', 'Birchwell', 'Copperfield', 'Dunmore', 'Ellery', 'Fairbanks',
  'Greywood', 'Hartley', 'Ivesley', 'Juniper', 'Kingsley', 'Lockhart',
  'Marsh', 'Northcott', 'Oakhurst', 'Pemberton',
] as const;
const CLINICS = [
  'Willowbrook Family Clinic', 'Fakeville Medical Group', 'Northfield Example Health',
  'Maple Hollow Practice', 'Sample Valley Care Center', 'Pinecrest Demo Clinic',
] as const;
const REASONS = [
  'orthopedic evaluation, knee pain',
  'cardiology consult, routine follow-up',
  'dermatology review, persistent rash',
  'physical therapy assessment, lower back pain',
  'ENT evaluation, recurring sinus congestion',
  'neurology consult, frequent headaches',
  'endocrinology review, thyroid check',
  'ophthalmology exam, blurred vision',
] as const;
const URGENCIES: readonly Urgency[] = ['routine', 'urgent', 'emergent'];

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Adult DOB, 18 to 99 full years before the reference date, always a valid date. */
function generateDob(rng: Rng, referenceDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(referenceDate);
  if (!m) throw new Error('referenceDate must be YYYY-MM-DD');
  const refYear = Number(m[1]);
  const year = refYear - rng.int(19, 99); // birthday year; strictly inside 18..100 years
  const month = rng.int(1, 12);
  const day = rng.int(1, daysInMonth(year, month));
  return `${pad2(month)}/${pad2(day)}/${year}`;
}

export function generateReferral(rng: Rng, options: ReferralOptions): Referral {
  const patientName = `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`;
  const dob = generateDob(rng, options.referenceDate);
  const referringProvider =
    `Dr ${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}, ${rng.pick(CLINICS)}`;

  let first9 = String(rng.int(1, 9));
  for (let i = 0; i < 8; i++) first9 += String(rng.int(0, 9));
  let check = computeNpiCheckDigit(first9);
  if (options.trap === 'bad-npi') check = (check + 1) % 10;
  const npi = first9 + String(check);

  const reason = rng.pick(REASONS);
  const urgency = rng.pick(URGENCIES);
  const callbackPhone = `555-01${pad2(rng.int(0, 99))}`;

  return { patientName, dob, referringProvider, npi, reason, urgency, callbackPhone };
}
