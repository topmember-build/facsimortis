import type { Locator, Page } from 'playwright-core';
import type { Pointer, Point } from './cursor.js';
import { EXPORT_CARD_TITLE, cardFields, exportCardHtml, parseExport } from './export-card.js';
import {
  BUTTON,
  acceptButton,
  button,
  editBox,
  editButton,
  faxHeading,
  faxIcon,
  fieldCard,
  flaggedInName,
  laidToRestHeading,
  nameMatcher,
  readerGroup,
  type CardField,
  type Target,
} from './labels.js';
import { OVERLAY_SCRIPT } from './overlay.js';
import type { OutDir } from './paths.js';
import { DEMO_NOW_UTC, HOLD, SCENES, TYPED_PHONE, type Scene, type SceneId } from './plan.js';
import type { Wait } from './report.js';
import type { Step } from './steps.js';

/**
 * The six demo scenes. Each has set-up steps, run at once before the recording starts (a scene gets a fresh
 * browser context, so it reaches its own starting screen), and the steps on camera. Labels are found through
 * `need`, so a missing one stops the run with its name. Steps marked as actions get a pause after them so the
 * clip reaches its goal (target plus 15%). The end-state checks are part of the steps, so demo:check, which
 * runs the same steps with no waits and no recording, proves each scene reaches its end.
 */

export interface SceneEnv {
  sceneId: SceneId;
  page: Page;
  siteUrl: string;
  out: OutDir;
  pointer: Pointer;
  /** demo:check: no glides, holds, pauses or typing delay, and nothing recorded. */
  fast: boolean;
  /** Every wait for a label or an end state, with how long it took. */
  waits: Wait[];
  /** "set-up" or the current step, for the wait log. */
  currentStep: string;
}

export interface SceneDef {
  scene: Scene;
  /** Off camera, before the recording starts. */
  setup(env: SceneEnv): Step<Locator>[];
  /** On camera. */
  steps(env: SceneEnv): Step<Locator>[];
}

/** Where the mouse rests when a recording starts: right of the middle, clear of the controls it will click. */
export const REST_POINT: Point = { x: 1340, y: 640 };

const CLICK_MS = 900;
const CHECK_TIMEOUT_MS = 5_000;

const scene = (id: SceneId): Scene => {
  const found = SCENES.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`No scene ${id} in the plan.`);
  return found;
};

/** Waits until `test` is true, logging how long it took. Throws a plain error naming `what` after 5 s. */
async function until(env: SceneEnv, what: string, test: () => Promise<boolean>): Promise<void> {
  const start = performance.now();
  for (;;) {
    if (await test()) {
      env.waits.push({ sceneId: env.sceneId, step: env.currentStep, what, ms: performance.now() - start });
      return;
    }
    if (performance.now() - start > CHECK_TIMEOUT_MS) throw new Error(`${what}: not seen within ${CHECK_TIMEOUT_MS / 1000} s`);
    await env.page.waitForTimeout(100);
  }
}

const exists = (page: Page, selector: string) => async () => (await page.locator(selector).count()) > 0;
const pressed = (locator: Locator) => async () => (await locator.getAttribute('aria-pressed')) === 'true';
const roleLocator = (page: Page, target: Target) =>
  page.getByRole(target.role, { name: nameMatcher(target), exact: target.match !== 'prefix' });

// Step builders.

function click(env: SceneEnv, name: string, target: Target, plannedMs = CLICK_MS): Step<Locator> {
  return { name, plannedMs, action: true, run: async (ctx) => env.pointer.click(await ctx.need(target)) };
}

function hold(name: string, ms: number): Step<Locator> {
  return { name, plannedMs: ms, action: false, run: (ctx) => ctx.hold(ms) };
}

function waitFor(name: string, target: Target): Step<Locator> {
  return { name, plannedMs: 300, action: false, run: async (ctx) => void (await ctx.need(target)) };
}

function check(env: SceneEnv, name: string, test: () => Promise<boolean>): Step<Locator> {
  return { name, plannedMs: 100, action: false, run: () => until(env, name, test) };
}

/** A set-up click: found by label like any step, clicked at once (no glide). */
function quickClick(name: string, target: Target): Step<Locator> {
  return { name, plannedMs: 0, action: false, run: async (ctx) => (await ctx.need(target)).click() };
}

/** The selected card, its source ghost and its source string. */
function selectedWithGhost(env: SceneEnv, field: CardField): Step<Locator> {
  const { page } = env;
  return check(env, `${field}: card selected, source ghost and source string shown`, async () => {
    const card = await pressed(roleLocator(page, fieldCard(field)))();
    const ghost = await exists(page, `.ghost[data-field="${field}"][data-selected="true"] rect`)();
    const string = await exists(page, `[data-source-field="${field}"]`)();
    return card && ghost && string;
  });
}

// Set-up pieces.

async function fontsReady(page: Page): Promise<void> {
  // Written as text: the root project has no browser types.
  await page.evaluate('document.fonts.ready.then(() => true)');
}

function openInbox(env: SceneEnv): Step<Locator>[] {
  return [
    {
      name: 'open the inbox (?skipboot)',
      plannedMs: 0,
      action: false,
      run: async (ctx) => {
        await env.page.goto(`${env.siteUrl}?skipboot`);
        await fontsReady(env.page);
        await ctx.need(faxIcon('fax-0002'));
      },
    },
  ];
}

const revealFax3: Step<Locator>[] = [quickClick('click Incoming fax', button(BUTTON.incomingFax)), waitFor('wait for fax-0003', faxIcon('fax-0003'))];
const openFax3: Step<Locator>[] = [quickClick('open fax-0003', faxIcon('fax-0003')), waitFor('wait for fax-0003 to open', faxHeading('fax-0003'))];
const resolveAndVerify: Step<Locator>[] = [
  quickClick('Accept anyway on the provider number', acceptButton('npi')),
  quickClick('Edit the callback phone', editButton('callbackPhone')),
  { name: 'type 555-0151', plannedMs: 0, action: false, run: async (ctx) => (await ctx.need(editBox('callbackPhone'))).fill(TYPED_PHONE) },
  quickClick('Save', button(BUTTON.save)),
  quickClick('Verify record', button(BUTTON.verifyRecord)),
  waitFor('wait for Laid to rest', laidToRestHeading),
];

/** Moves the mouse one pixel, so the drawn cursor shows on a page that has just loaded. */
async function showCursor(env: SceneEnv): Promise<void> {
  const at = env.pointer.at;
  await env.pointer.park({ x: at.x + 1, y: at.y });
}

// The scenes.

const boot: SceneDef = {
  scene: scene('scene-1'),
  setup: (env) => [
    {
      name: 'a dark blank page to start from',
      plannedMs: 0,
      action: false,
      run: async () => env.page.setContent('<!doctype html><html><body style="margin:0;background:#141414"></body></html>'),
    },
  ],
  steps: (env) => [
    {
      name: 'open the site without ?skipboot',
      plannedMs: 800,
      action: false,
      run: async (ctx) => {
        await env.page.goto(env.siteUrl);
        await ctx.need(button(BUTTON.receiveFaxes));
        await showCursor(env);
      },
    },
    hold('hold the boot screen', HOLD.bootScreen),
    click(env, 'click Receive faxes', button(BUTTON.receiveFaxes)),
    waitFor('wait for the inbox', faxIcon('fax-0002')),
    check(env, 'the inbox shows fax-0001 and fax-0002, not fax-0003', async () => {
      const count = (id: string) => roleLocator(env.page, faxIcon(id)).count();
      return (await count('fax-0001')) === 1 && (await count('fax-0002')) === 1 && (await count('fax-0003')) === 0;
    }),
    hold('hold the inbox', HOLD.inboxAfterBoot),
  ],
};

const inbox: SceneDef = {
  scene: scene('scene-2'),
  setup: openInbox,
  steps: (env) => [
    hold('show the two faxes', 1_000),
    click(env, 'click Incoming fax', button(BUTTON.incomingFax)),
    waitFor('wait for fax-0003', faxIcon('fax-0003')),
    check(env, 'fax-0003 says 2 flagged', async () =>
      ((await roleLocator(env.page, faxIcon('fax-0003')).getAttribute('aria-label')) ?? '').includes(flaggedInName(2)),
    ),
    hold('hold fax-0003 and its badge', HOLD.fax0003Arrived),
  ],
};

const sourceGhost: SceneDef = {
  scene: scene('scene-3'),
  setup: (env) => [...openInbox(env), ...revealFax3],
  steps: (env) => [
    click(env, 'open ./fax-0003', faxIcon('fax-0003')),
    waitFor('wait for fax-0003 to open', faxHeading('fax-0003')),
    hold('hold the open fax', HOLD.fax0003Opened),
    click(env, 'select the Provider number card', fieldCard('npi')),
    selectedWithGhost(env, 'npi'),
    hold('hold the source ghost and source string', HOLD.providerNumberSelected),
    click(env, 'select the Callback phone card', fieldCard('callbackPhone')),
    selectedWithGhost(env, 'callbackPhone'),
    click(env, 'select the Provider number card again', fieldCard('npi')),
    selectedWithGhost(env, 'npi'),
  ],
};

const resolve: SceneDef = {
  scene: scene('scene-4'),
  setup: (env) => [...openInbox(env), ...revealFax3, ...openFax3],
  steps: (env) => [
    click(env, 'Accept anyway on the provider number', acceptButton('npi')),
    click(env, 'Edit the callback phone', editButton('callbackPhone')),
    {
      name: 'select all, then type 555-0151',
      plannedMs: 1_800,
      action: true,
      run: async (ctx) => {
        const box = await ctx.need(editBox('callbackPhone'));
        await env.pointer.click(box);
        await env.page.keyboard.press('Control+A');
        await env.page.keyboard.type(TYPED_PHONE, { delay: env.fast ? 0 : 110 });
        const value = await box.inputValue();
        if (value !== TYPED_PHONE) throw new Error(`the callback phone box holds "${value}", not "${TYPED_PHONE}"`);
      },
    },
    click(env, 'click Save', button(BUTTON.save)),
    click(env, 'click Verify record', button(BUTTON.verifyRecord)),
    waitFor('wait for Laid to rest', laidToRestHeading),
    check(env, 'the fax window is laid to rest', exists(env.page, '.fax-view[data-state="laid-to-rest"]')),
    {
      // At 1080p the panel opens below the fold (focus moves to its heading, which only just scrolls in), so the
      // page scrolls it to the middle before the hold.
      name: 'bring the Laid to rest panel into view',
      plannedMs: 900,
      action: false,
      run: async () => {
        const behavior = env.fast ? 'instant' : 'smooth';
        await env.page.evaluate(`document.querySelector('[data-laid-to-rest]').scrollIntoView({ block: 'center', behavior: '${behavior}' })`);
        await until(env, 'the whole Laid to rest panel is on screen', async () => {
          const box = await env.page.locator('[data-laid-to-rest]').boundingBox();
          const viewport = env.page.viewportSize();
          return box !== null && viewport !== null && box.y >= 0 && box.y + box.height <= viewport.height;
        });
      },
    },
    hold('hold the Laid to rest panel', HOLD.laidToRest),
  ],
};

const exportScene: SceneDef = {
  scene: scene('scene-5'),
  setup: (env) => [
    ...openInbox(env),
    ...revealFax3,
    ...openFax3,
    ...resolveAndVerify,
    {
      name: 'bring Download JSON into view',
      plannedMs: 0,
      action: false,
      run: async (ctx) => {
        await (await ctx.need(button(BUTTON.downloadJson))).scrollIntoViewIfNeeded();
        await env.page.waitForTimeout(500);
      },
    },
  ],
  steps: (env) => {
    let fileName = '';
    return [
      {
        name: 'click Download JSON',
        plannedMs: 1_000,
        action: true,
        run: async (ctx) => {
          const target = await ctx.need(button(BUTTON.downloadJson));
          const [download] = await Promise.all([env.page.waitForEvent('download', { timeout: 5_000 }), env.pointer.click(target)]);
          fileName = download.suggestedFilename();
          // OutDir refuses any name that is not a plain file name, so a strange suggested name stops the run.
          await download.saveAs(env.out.path(`${env.sceneId}/${fileName}`));
        },
      },
      check(env, 'the downloaded record has the original values, the edit, the failed check and the fixed clock', async () => {
        const record = parseExport(env.out.read(`${env.sceneId}/${fileName}`).toString('utf8'), fileName);
        const fields = cardFields(record);
        const npi = fields.find((field) => field.label === 'Provider number (NPI)');
        const phone = fields.find((field) => field.label === 'Callback phone');
        return (
          record.verifiedAtUtc === DEMO_NOW_UTC &&
          record.verifier.length > 0 &&
          npi !== undefined &&
          npi.lines.some((line) => line.key === 'acceptedDespiteFlag' && line.value === 'true') &&
          npi.lines.filter((line) => line.key === 'failedChecks').length === 1 &&
          phone !== undefined &&
          phone.lines.some((line) => line.key === 'finalValue' && line.value === JSON.stringify(TYPED_PHONE))
        );
      }),
      {
        name: 'show the export card from the downloaded file',
        plannedMs: 800,
        action: true,
        run: async (ctx) => {
          const record = parseExport(env.out.read(`${env.sceneId}/${fileName}`).toString('utf8'), fileName);
          await env.page.setContent(exportCardHtml(record, { fileName, siteUrl: env.siteUrl }));
          await fontsReady(env.page);
          // The card replaced the document, so the cursor is put back.
          await env.page.evaluate(OVERLAY_SCRIPT);
          await showCursor(env);
          await ctx.need({ role: 'heading', name: EXPORT_CARD_TITLE });
        },
      },
    ];
  },
};

const twoReaders: SceneDef = {
  scene: scene('scene-6'),
  setup: (env) => [
    ...openInbox(env),
    ...revealFax3,
    ...openFax3,
    ...resolveAndVerify,
    {
      name: 'back to the top of the fax window',
      plannedMs: 0,
      action: false,
      run: async (ctx) => {
        await env.page.evaluate('window.scrollTo(0, 0)');
        await ctx.need(button(BUTTON.backToInbox));
        await env.page.waitForTimeout(300);
      },
    },
  ],
  steps: (env) => {
    const group = () => roleLocator(env.page, readerGroup);
    const toggle = (name: string) => group().getByRole('button', { name, exact: true });
    return [
      click(env, 'click Back to inbox', button(BUTTON.backToInbox)),
      waitFor('wait for the inbox', faxIcon('fax-0002')),
      click(env, 'open ./fax-0002', faxIcon('fax-0002')),
      waitFor('wait for fax-0002 to open', faxHeading('fax-0002')),
      check(env, 'the model reader is on and no field is flagged', async () =>
        (await pressed(toggle(BUTTON.modelAnswers))()) && (await env.page.getByText('No fields are flagged.', { exact: true }).count()) === 1,
      ),
      click(env, 'switch to the rules reader', button(BUTTON.rulesReader)),
      check(env, 'the rules reader is on with three flagged fields', async () =>
        (await pressed(toggle(BUTTON.rulesReader))()) &&
        (await env.page.locator('[data-section="needs-your-eyes"] button[data-field]').count()) === 3,
      ),
      click(env, 'select the Referring provider card', fieldCard('referringProvider')),
      selectedWithGhost(env, 'referringProvider'),
    ];
  },
};

export const SCENE_DEFS: readonly SceneDef[] = [boot, inbox, sourceGhost, resolve, exportScene, twoReaders];
