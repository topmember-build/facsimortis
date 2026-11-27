/**
 * Pure. What the capture and the check report: the waits that took longer than 3 s, and one manifest entry per
 * clip with its target, its goal (target plus 15%) and its real length from ffprobe.
 */

export const LONG_WAIT_MS = 3_000;

export interface Wait {
  sceneId: string;
  /** "set-up" or "step 3 (click Incoming fax)". */
  step: string;
  what: string;
  ms: number;
}

/** The waits longer than LONG_WAIT_MS, longest first, rounded to the millisecond. */
export function longWaits(waits: readonly Wait[], thresholdMs: number = LONG_WAIT_MS): Wait[] {
  return waits
    .filter((wait) => wait.ms > thresholdMs)
    .map((wait) => ({ ...wait, ms: Math.round(wait.ms) }))
    .sort((a, b) => b.ms - a.ms);
}

export interface ClipEntry {
  sceneId: string;
  title: string;
  targetMs: number;
  goalMs: number;
  /** The clip's length from ffprobe (the MP4 copy). */
  realMs: number;
  /** From the first step to the end of the final hold. */
  timelineMs: number;
  pausesMs: number[];
  finalHoldMs: number;
  files: { webm: string; mp4: string; finalPng: string };
}

/** The real length against the target and the goal, for example "+18.4% on target, +2.9% on goal". */
export function lengthNote(entry: Pick<ClipEntry, 'targetMs' | 'goalMs' | 'realMs'>): string {
  const percent = (value: number, base: number) => {
    const share = ((value - base) / base) * 100;
    return `${share >= 0 ? '+' : ''}${share.toFixed(1)}%`;
  };
  return `${percent(entry.realMs, entry.targetMs)} on target, ${percent(entry.realMs, entry.goalMs)} on goal`;
}

/** True when the clip is at least its goal long, so the editor only ever has to trim. */
export const reachesGoal = (entry: Pick<ClipEntry, 'goalMs' | 'realMs'>): boolean => entry.realMs >= entry.goalMs;
