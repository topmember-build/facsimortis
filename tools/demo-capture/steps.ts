import { describeTarget, type Target } from './labels.js';

/**
 * The step runner. A scene is a list of steps run in order. A step finds what it needs through
 * `need`, which stops the whole run with a LabelNotFoundError naming the scene, the step and the label:
 * a missing label is never skipped. After each action the runner pauses, so that the clip reaches its
 * goal length (see pauseAfter). The runner knows nothing about Playwright: the browser is behind Driver,
 * so the runner is tested with a fake one.
 */

export interface Driver<H> {
  /** The one element for the target, waiting up to timeoutMs for it. null when it does not appear. */
  find(target: Target, timeoutMs: number): Promise<H | null>;
  wait(ms: number): Promise<void>;
  /** A monotonic clock in milliseconds. */
  now(): number;
}

export interface StepContext<H> {
  /** The element for the target. Stops the run with a LabelNotFoundError when it is not there. */
  need(target: Target): Promise<H>;
  /** Holds for `ms` milliseconds. */
  hold(ms: number): Promise<void>;
}

export interface Step<H> {
  name: string;
  /** How long the step is expected to take (a hold's length, or a glide and a click). Used for the pause budget. */
  plannedMs: number;
  /** Actions (clicks, typing) get a pause after them; holds do not. */
  action: boolean;
  run(context: StepContext<H>): Promise<void>;
}

export interface SceneRef {
  id: string;
  goalMs: number;
}

export class LabelNotFoundError extends Error {
  constructor(
    readonly sceneId: string,
    readonly stepNumber: number,
    readonly stepName: string,
    readonly target: Target,
  ) {
    super(`${sceneId}, step ${stepNumber} (${stepName}): could not find the ${describeTarget(target)}. The run stopped here.`);
    this.name = 'LabelNotFoundError';
  }
}

export class StepFailedError extends Error {
  constructor(
    readonly sceneId: string,
    readonly stepNumber: number,
    readonly stepName: string,
    cause: unknown,
  ) {
    super(`${sceneId}, step ${stepNumber} (${stepName}) failed: ${cause instanceof Error ? cause.message : String(cause)}. The run stopped here.`, {
      cause,
    });
    this.name = 'StepFailedError';
  }
}

export interface PauseInput {
  goalMs: number;
  /** Time since the scene started. */
  elapsedMs: number;
  /** The planned time of the steps still to come. */
  plannedRestMs: number;
  /** Actions still owed a pause, counting the one just done. */
  actionsLeft: number;
  /** The shortest pause after an action, so a viewer can follow even when the scene runs long. */
  minPauseMs: number;
}

/**
 * Pure. The pause after an action: the time still spare before the goal, shared evenly between the
 * actions still owed a pause, and never shorter than minPauseMs. Whole milliseconds, rounded down; what
 * is left goes into the final hold.
 */
export function pauseAfter({ goalMs, elapsedMs, plannedRestMs, actionsLeft, minPauseMs }: PauseInput): number {
  if (actionsLeft <= 0) return 0;
  const spare = goalMs - elapsedMs - plannedRestMs;
  return Math.max(minPauseMs, Math.floor(spare / actionsLeft));
}

export interface RunOptions {
  /** How long `need` waits for a label. */
  findTimeoutMs?: number;
  minPauseMs?: number;
}

export interface SceneRun {
  sceneId: string;
  goalMs: number;
  /** From the first step to the end of the final hold. */
  elapsedMs: number;
  /** The pause after each action, in order. */
  pausesMs: number[];
  /** The hold after the last step that brings the scene up to its goal (0 when the scene ran long). */
  finalHoldMs: number;
}

export const DEFAULT_FIND_TIMEOUT_MS = 5_000;
export const DEFAULT_MIN_PAUSE_MS = 500;

export async function runScene<H>(
  scene: SceneRef,
  steps: readonly Step<H>[],
  driver: Driver<H>,
  options: RunOptions = {},
): Promise<SceneRun> {
  const findTimeoutMs = options.findTimeoutMs ?? DEFAULT_FIND_TIMEOUT_MS;
  const minPauseMs = options.minPauseMs ?? DEFAULT_MIN_PAUSE_MS;
  const start = driver.now();
  const pausesMs: number[] = [];

  for (const [index, step] of steps.entries()) {
    const stepNumber = index + 1;
    const context: StepContext<H> = {
      async need(target) {
        const found = await driver.find(target, findTimeoutMs);
        if (found === null) throw new LabelNotFoundError(scene.id, stepNumber, step.name, target);
        return found;
      },
      hold: (ms) => driver.wait(ms),
    };
    try {
      await step.run(context);
    } catch (error) {
      if (error instanceof LabelNotFoundError) throw error;
      throw new StepFailedError(scene.id, stepNumber, step.name, error);
    }
    if (step.action) {
      const rest = steps.slice(index + 1);
      const pause = pauseAfter({
        goalMs: scene.goalMs,
        elapsedMs: driver.now() - start,
        plannedRestMs: rest.reduce((sum, next) => sum + next.plannedMs, 0),
        actionsLeft: 1 + rest.filter((next) => next.action).length,
        minPauseMs,
      });
      pausesMs.push(pause);
      await driver.wait(pause);
    }
  }

  const finalHoldMs = Math.max(0, scene.goalMs - (driver.now() - start));
  if (finalHoldMs > 0) await driver.wait(finalHoldMs);
  return { sceneId: scene.id, goalMs: scene.goalMs, elapsedMs: driver.now() - start, pausesMs, finalHoldMs };
}
