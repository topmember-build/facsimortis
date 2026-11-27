import { describe, expect, it } from 'vitest';
import { goalMs, SCENES } from '../tools/demo-capture/plan.js';
import { LONG_WAIT_MS, lengthNote, longWaits, reachesGoal } from '../tools/demo-capture/report.js';
import { SCENE_DEFS } from '../tools/demo-capture/scenes.js';
import { runScene, type Driver, type Step } from '../tools/demo-capture/steps.js';

// V1c. The scene list, the step hook the wait log uses, and the report. The scenes themselves run in a
// browser: `npm run demo:check` (no recording) and `npm run demo:capture`.

describe('the scene list', () => {
  it('has the six planned scenes in order', () => {
    expect(SCENE_DEFS.map((def) => def.scene)).toEqual(SCENES);
  });
});

describe('runScene onStep', () => {
  it('tells which step is starting, before it runs', async () => {
    const seen: string[] = [];
    const driver: Driver<string> = { find: async () => 'x', wait: async () => {}, now: () => 0 };
    const step = (name: string): Step<string> => ({ name, plannedMs: 0, action: false, run: async () => void seen.push(`run ${name}`) });
    await runScene({ id: 's', goalMs: 0 }, [step('a'), step('b')], driver, { onStep: (n, name) => seen.push(`start ${n} ${name}`) });
    expect(seen).toEqual(['start 1 a', 'run a', 'start 2 b', 'run b']);
  });
});

describe('the report', () => {
  it('lists only the waits longer than 3 s, longest first', () => {
    const wait = (ms: number) => ({ sceneId: 'scene-1', step: 'step 1 (x)', what: 'button "Receive faxes"', ms });
    expect(LONG_WAIT_MS).toBe(3_000);
    expect(longWaits([wait(3_000), wait(3_000.4), wait(9_100.6), wait(120)]).map((w) => w.ms)).toEqual([9_101, 3_000]);
  });

  it('gives the real length against the target and the goal', () => {
    const scene = SCENES[0]!;
    const entry = { targetMs: scene.targetMs, goalMs: goalMs(scene), realMs: 14_167 };
    expect(lengthNote(entry)).toBe('+18.1% on target, +2.7% on goal');
    expect(reachesGoal(entry)).toBe(true);
    expect(reachesGoal({ ...entry, realMs: 13_799 })).toBe(false);
  });
});
