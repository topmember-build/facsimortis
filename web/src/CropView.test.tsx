import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { NO_SAVED_ANSWER_MESSAGE, SampleFaxSchema } from '../../src/samples/schema.js';
import { App } from './App';
import { boxContains, cropBox, fullPageBox, viewBoxAttr } from './crop';
import { ghostRects } from './ghost';
import { committedFaxes, json, stubSite, type Overrides } from './test-site';

type UserApi = ReturnType<typeof userEvent.setup>;

const IDS = ['fax-0001', 'fax-0002', 'fax-0003'];
const parse = (id: string) => SampleFaxSchema.parse(committedFaxes[`${id}.json`]);
const rowFor = (id: string) => screen.getAllByRole('button').find((b) => b.dataset['faxId'] === id)!;
const viewerSvg = () => document.querySelector<SVGSVGElement>('svg.fax-image')!;
const fieldButton = (name: string) => document.querySelector<HTMLElement>(`button[data-field="${name}"]`)!;

async function renderAll(user: UserApi) {
  render(<App />);
  await screen.findByRole('heading', { level: 2, name: 'Inbox' });
  await user.click(screen.getByRole('button', { name: 'Incoming fax' }));
}

async function open(user: UserApi, id: string) {
  await user.click(rowFor(id));
  await screen.findByRole('heading', { level: 2, name: `Fax ${id}` });
}

describe('cropped view is the default', () => {
  it('opens cropped on first open and on every reopen, whatever the toggle was before', async () => {
    stubSite();
    const user = userEvent.setup();
    await renderAll(user);
    const fax = parse('fax-0003');
    const cropped = viewBoxAttr(cropBox(fax.ocr.words, fax));

    await open(user, 'fax-0003');
    expect(viewerSvg()).toHaveAttribute('viewBox', cropped);
    await user.click(screen.getByRole('button', { name: 'Show full page' }));
    expect(viewerSvg()).toHaveAttribute('viewBox', viewBoxAttr(fullPageBox(fax)));

    await user.click(screen.getByRole('button', { name: 'Back to inbox' }));
    await open(user, 'fax-0003');
    expect(viewerSvg()).toHaveAttribute('viewBox', cropped);
    expect(screen.getByRole('button', { name: 'Show full page' })).toBeInTheDocument();
  });

  it('opens each fax at its own crop, and a full page chosen on one fax does not carry to the next', async () => {
    stubSite();
    const user = userEvent.setup();
    await renderAll(user);
    for (const id of IDS) {
      const fax = parse(id);
      await open(user, id);
      expect(viewerSvg()).toHaveAttribute('viewBox', viewBoxAttr(cropBox(fax.ocr.words, fax)));
      await user.click(screen.getByRole('button', { name: 'Show full page' }));
      await user.click(screen.getByRole('button', { name: 'Back to inbox' }));
    }
  });

  it('keeps the chosen view when the reader changes on the same fax', async () => {
    stubSite();
    const user = userEvent.setup();
    await renderAll(user);
    await open(user, 'fax-0002');
    const fax = parse('fax-0002');
    await user.click(screen.getByRole('button', { name: 'Rules reader' }));
    expect(viewerSvg()).toHaveAttribute('viewBox', viewBoxAttr(cropBox(fax.ocr.words, fax)));
    await user.click(screen.getByRole('button', { name: 'Show full page' }));
    await user.click(screen.getByRole('button', { name: 'Model answers' }));
    expect(viewerSvg()).toHaveAttribute('viewBox', viewBoxAttr(fullPageBox(fax)));
  });

  it('has a plain toggle button whose label shows the state, and keeps the selected field and highlight', async () => {
    stubSite();
    const user = userEvent.setup();
    await renderAll(user);
    await open(user, 'fax-0003');
    await user.click(fieldButton('npi'));

    const toggle = screen.getByRole('button', { name: 'Show full page' });
    expect(toggle.tagName).toBe('BUTTON');
    expect(toggle).toHaveAttribute('type', 'button');
    expect(toggle).not.toHaveAttribute('aria-pressed');
    toggle.focus();
    expect(toggle).toHaveFocus();

    await user.click(toggle);
    const back = screen.getByRole('button', { name: 'Show cropped view' });
    expect(back).not.toHaveAttribute('aria-pressed');
    expect(document.querySelector('g[data-field="npi"]')).toHaveAttribute('data-selected', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('Showing source for Provider number (NPI)');

    await user.click(back);
    expect(document.querySelector('g[data-field="npi"]')).toHaveAttribute('data-selected', 'true');
  });

  it('keeps the selected highlight inside the visible box in both views, for every field of every sample', async () => {
    stubSite();
    const user = userEvent.setup();
    await renderAll(user);
    for (const id of ['fax-0002', 'fax-0003']) {
      const fax = parse(id);
      await open(user, id);
      for (const name of Array.from(document.querySelectorAll<HTMLElement>('button[data-field]')).map((b) => b.dataset['field']!)) {
        await user.click(fieldButton(name));
        const [x, y, width, height] = viewerSvg().getAttribute('viewBox')!.split(' ').map(Number);
        const visible = { x: x!, y: y!, width: width!, height: height! };
        const rects = Array.from(document.querySelectorAll(`g[data-field="${name}"] rect`)).map((r) => ({
          x: Number(r.getAttribute('x')),
          y: Number(r.getAttribute('y')),
          width: Number(r.getAttribute('width')),
          height: Number(r.getAttribute('height')),
        }));
        expect(boxContains(visible, rects)).toBe(true);
      }
      expect(fax.ocr.words.length).toBeGreaterThan(0);
      await user.click(screen.getByRole('button', { name: 'Back to inbox' }));
    }
  });

  it('draws every rect at its word box in both views', async () => {
    stubSite();
    const user = userEvent.setup();
    await renderAll(user);
    const fax = parse('fax-0003');
    await open(user, 'fax-0003');
    const drawn = () =>
      Array.from(document.querySelectorAll('g.ghost rect')).map((r) => [
        r.getAttribute('data-word-id'),
        r.getAttribute('x'),
        r.getAttribute('y'),
        r.getAttribute('width'),
        r.getAttribute('height'),
      ]);
    const expected = new Set(
      ['patientName', 'dob', 'npi', 'callbackPhone', 'urgency', 'referringProvider', 'reason'].flatMap((n) => {
        const result = fax.readers.model;
        if (result.status !== 'ok') return [];
        return ghostRects(result.fields.find((f) => f.name === n), fax.ocr.words).map((r) =>
          [r.id, String(r.x), String(r.y), String(r.width), String(r.height)].join('|'),
        );
      }),
    );
    const croppedRects = drawn();
    expect(croppedRects.length).toBeGreaterThan(0);
    for (const rect of croppedRects) expect(expected.has(rect.join('|'))).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Show full page' }));
    expect(drawn()).toEqual(croppedRects);
  });
});

describe('thumbnails match the viewer', () => {
  it('has the same viewBox as the viewer for each sample fax', async () => {
    stubSite();
    const user = userEvent.setup();
    await renderAll(user);
    for (const id of IDS) {
      const thumb = screen.getByRole('img', { name: `First page of fax ${id}` });
      const thumbBox = thumb.getAttribute('viewBox');
      await open(user, id);
      expect(viewerSvg().getAttribute('viewBox')).toBe(thumbBox);
      await user.click(screen.getByRole('button', { name: 'Back to inbox' }));
    }
  });
});

describe('a fax with no words', () => {
  it('is shown as the full page in the viewer and the thumbnail', async () => {
    const empty = structuredClone(committedFaxes['fax-0002.json']) as {
      ocr: { words: unknown[] };
      readers: { model: unknown; rules: unknown };
    };
    empty.ocr.words = [];
    empty.readers.model = { status: 'no-saved-answer', message: NO_SAVED_ANSWER_MESSAGE };
    empty.readers.rules = { status: 'no-saved-answer', message: NO_SAVED_ANSWER_MESSAGE };
    const overrides: Overrides = { 'fax-0002.json': () => json(empty) };
    stubSite(overrides);
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { level: 2, name: 'Inbox' });
    const base = parse('fax-0002');
    const full = viewBoxAttr(fullPageBox(base));
    expect(screen.getByRole('img', { name: 'First page of fax fax-0002' })).toHaveAttribute('viewBox', full);
    await open(user, 'fax-0002');
    expect(viewerSvg()).toHaveAttribute('viewBox', full);
  });
});
