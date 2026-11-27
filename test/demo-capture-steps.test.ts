import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { button, faxIcon, type Target } from '../tools/demo-capture/labels.js';
import {
  LabelNotFoundError,
  StepFailedError,
  pauseAfter,
  runScene,
  type Driver,
  type Step,
} from '../tools/demo-capture/steps.js';

// V1a. The step runner with a fake browser: a virtual clock and a set of labels that are "on the page".

class FakeDriver implements Driver<string> {
  clock = 0;
  readonly waits: number[] = [];
  readonly finds: string[] = [];
  constructor(private readonly onPage: ReadonlySet<string>) {}
  async find(target: Target, timeoutMs: number): Promise<string | null> {
    this.finds.push(target.name);
    if (this.onPage.has(target.name)) return target.name;
    this.clock += timeoutMs;
    return null;
  }
  async wait(ms: number): Promise<void> {
    this.waits.push(ms);
    this.clock += ms;
  }
  now(): number {
    return this.clock;
  }
}

/** An action that finds its label and takes `ms` of virtual time. */
function click(driver: FakeDriver, name: string, ms: number, log: string[], plannedMs = ms): Step<string> {
  return {
    name: `click ${name}`,
    plannedMs,
    action: true,
    async run(context) {
      await context.need(button(name));
      driver.clock += ms;
      log.push(name);
    },
  };
}

function hold(ms: number, log: string[]): Step<string> {
  return {
    name: `hold ${ms} ms`,
    plannedMs: ms,
    action: false,
    async run(context) {
      await context.hold(ms);
      log.push(`hold ${ms}`);
    },
  };
}

describe('runScene', () => {
  it('runs the steps in order and pads with pauses after actions up to the goal', async () => {
    const driver = new FakeDriver(new Set(['Receive faxes', 'Incoming fax']));
    const log: string[] = [];
    const run = await runScene(
      { id: 'scene-x', goalMs: 10_000 },
      [hold(3_000, log), click(driver, 'Receive faxes', 800, log), click(driver, 'Incoming fax', 800, log), hold(2_000, log)],
      driver,
    );
    expect(log).toEqual(['hold 3000', 'Receive faxes', 'Incoming fax', 'hold 2000']);
    // Spare time: 10 000 - 3 000 - 800 - 800 - 2 000 = 3 400, shared by two actions.
    expect(run.pausesMs).toEqual([1_700, 1_700]);
    expect(run.finalHoldMs).toBe(0);
    expect(run.elapsedMs).toBe(10_000);
  });

  it('stops at a missing label with an error naming the scene, the step and the label, and runs nothing after it', async () => {
    const driver = new FakeDriver(new Set(['Receive faxes']));
    const log: string[] = [];
    const steps = [click(driver, 'Receive faxes', 500, log), click(driver, 'Accept anyway Provider number (NPI)', 500, log), click(driver, 'Receive faxes', 500, log)];
    const failure = runScene({ id: 'scene-4', goalMs: 5_000 }, steps, driver, { findTimeoutMs: 1_234 });
    await expect(failure).rejects.toBeInstanceOf(LabelNotFoundError);
    await expect(failure).rejects.toThrow(
      'scene-4, step 2 (click Accept anyway Provider number (NPI)): could not find the button "Accept anyway Provider number (NPI)". The run stopped here.',
    );
    expect(log).toEqual(['Receive faxes']);
    expect(driver.finds).toEqual(['Receive faxes', 'Accept anyway Provider number (NPI)']);
  });

  it('keeps the details of a missing label on the error', async () => {
    const driver = new FakeDriver(new Set());
    const step: Step<string> = {
      name: 'open fax-0003',
      plannedMs: 800,
      action: true,
      run: async (context) => {
        await context.need(faxIcon('fax-0003'));
      },
    };
    const error = await runScene({ id: 'scene-3', goalMs: 1_000 }, [step], driver).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LabelNotFoundError);
    const notFound = error as LabelNotFoundError;
    expect([notFound.sceneId, notFound.stepNumber, notFound.stepName]).toEqual(['scene-3', 1, 'open fax-0003']);
    expect(notFound.target).toEqual(faxIcon('fax-0003'));
    expect(notFound.message).toContain('button whose name starts with "fax-0003, received "');
  });

  it('wraps any other failure with the scene and step, and stops', async () => {
    const driver = new FakeDriver(new Set());
    const log: string[] = [];
    const broken: Step<string> = {
      name: 'type 555-0151',
      plannedMs: 500,
      action: true,
      run: async () => {
        throw new Error('the box is read-only');
      },
    };
    const failure = runScene({ id: 'scene-4', goalMs: 5_000 }, [broken, hold(1_000, log)], driver);
    await expect(failure).rejects.toBeInstanceOf(StepFailedError);
    await expect(failure).rejects.toThrow('scene-4, step 1 (type 555-0151) failed: the box is read-only. The run stopped here.');
    expect(log).toEqual([]);
  });

  it('keeps the shortest pause when a scene runs long, and adds no final hold', async () => {
    const driver = new FakeDriver(new Set(['A', 'B']));
    const log: string[] = [];
    const run = await runScene(
      { id: 'scene-x', goalMs: 2_000 },
      [click(driver, 'A', 1_500, log), click(driver, 'B', 1_500, log)],
      driver,
      { minPauseMs: 400 },
    );
    expect(run.pausesMs).toEqual([400, 400]);
    expect(run.finalHoldMs).toBe(0);
    expect(run.elapsedMs).toBe(3_800);
  });

  it('adds a final hold when a scene has no actions', async () => {
    const driver = new FakeDriver(new Set());
    const run = await runScene({ id: 'scene-x', goalMs: 5_000 }, [hold(2_000, [])], driver);
    expect(run.pausesMs).toEqual([]);
    expect(run.finalHoldMs).toBe(3_000);
    expect(run.elapsedMs).toBe(5_000);
  });

  it('ends exactly at the goal whenever the planned steps and the shortest pauses fit', async () => {
    const stepArb = fc.record({ ms: fc.integer({ min: 0, max: 3_000 }), action: fc.boolean() });
    await fc.assert(
      fc.asyncProperty(fc.array(stepArb, { minLength: 1, maxLength: 8 }), fc.integer({ min: 0, max: 60_000 }), async (specs, goal) => {
        const driver = new FakeDriver(new Set(['x']));
        const steps: Step<string>[] = specs.map((spec, i) =>
          spec.action ? { ...click(driver, 'x', spec.ms, []), name: `step ${i}` } : { ...hold(spec.ms, []), name: `step ${i}` },
        );
        const minPauseMs = 500;
        const run = await runScene({ id: 's', goalMs: goal }, steps, driver, { minPauseMs });
        const planned = specs.reduce((sum, spec) => sum + spec.ms, 0);
        const actions = specs.filter((spec) => spec.action).length;
        expect(run.pausesMs).toHaveLength(actions);
        expect(run.pausesMs.every((pause) => pause >= minPauseMs)).toBe(true);
        expect(run.elapsedMs).toBe(planned + run.pausesMs.reduce((a, b) => a + b, 0) + run.finalHoldMs);
        if (planned + actions * minPauseMs <= goal) {
          expect(run.elapsedMs).toBe(goal);
          // Rounding leaves less than one millisecond per action for the final hold.
          if (actions > 0) expect(run.finalHoldMs).toBeLessThan(actions);
        } else {
          expect(run.finalHoldMs).toBe(0);
        }
      }),
      { numRuns: 300 },
    );
  });
});

describe('pauseAfter', () => {
  it('shares the spare time evenly and never goes below the shortest pause', () => {
    expect(pauseAfter({ goalMs: 10_000, elapsedMs: 2_000, plannedRestMs: 2_000, actionsLeft: 3, minPauseMs: 500 })).toBe(2_000);
    expect(pauseAfter({ goalMs: 10_000, elapsedMs: 9_000, plannedRestMs: 2_000, actionsLeft: 2, minPauseMs: 500 })).toBe(500);
    expect(pauseAfter({ goalMs: 10_000, elapsedMs: 0, plannedRestMs: 0, actionsLeft: 0, minPauseMs: 500 })).toBe(0);
  });

  it('is a whole number of milliseconds, at least the shortest pause, for any input', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100_000 }),
        fc.integer({ min: 0, max: 100_000 }),
        fc.integer({ min: 0, max: 100_000 }),
        fc.integer({ min: 1, max: 20 }),
        fc.integer({ min: 0, max: 2_000 }),
        (goalMs, elapsedMs, plannedRestMs, actionsLeft, minPauseMs) => {
          const pause = pauseAfter({ goalMs, elapsedMs, plannedRestMs, actionsLeft, minPauseMs });
          return Number.isInteger(pause) && pause >= minPauseMs && pause * actionsLeft <= Math.max(minPauseMs * actionsLeft, goalMs - elapsedMs - plannedRestMs);
        },
      ),
    );
  });
});
