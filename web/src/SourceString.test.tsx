import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SampleFaxSchema } from '../../src/samples/schema.js';
import { App } from './App';
import { cropBox } from './crop';
import { ghostRects } from './ghost';
import { imageToScreen } from './source-string';
import { committedFaxes, stubSite } from './test-site';

/*
 * jsdom has no layout, so every rectangle is 0x0. These tests stub getBoundingClientRect to hand the
 * overlay fixed inputs (a card column on the right, the fax on the left, a summary bar at the top) and
 * check what the component does with them. They do NOT prove that the string lands on the right pixels
 * in a real browser: real positions, scrolling, resizing and stacking are browser-only.
 */

type UserApi = ReturnType<typeof userEvent.setup>;

const BAR_BOTTOM = 100;
const SVG_RECT = { x: 40, y: 150, width: 600, height: 800 };

function rectOf(x: number, y: number, width: number, height: number) {
  return { x, y, width, height, left: x, top: y, right: x + width, bottom: y + height, toJSON: () => ({}) } as DOMRect;
}

function stubLayout() {
  vi.stubGlobal('innerWidth', 1360);
  vi.stubGlobal('innerHeight', 1400);
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (this.matches('svg.fax-image')) return rectOf(SVG_RECT.x, SVG_RECT.y, SVG_RECT.width, SVG_RECT.height);
    if (this.matches('.fax-sheet')) return rectOf(20, 130, 640, 840);
    if (this.matches('li.field-card')) return rectOf(700, 300, 400, 100);
    if (this.matches('.viewer-side')) return rectOf(690, BAR_BOTTOM + 8, 420, 900);
    if (this.matches('.summary-bar')) return rectOf(0, 40, 1360, BAR_BOTTOM - 40);
    return rectOf(0, 0, 0, 0);
  });
}

function stubMedia({ wide, reduce }: { wide: boolean; reduce: boolean }) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('prefers-reduced-motion') ? reduce : query.includes('min-width') ? wide : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

async function openFax(user: UserApi, id: string) {
  const view = render(<App now={() => new Date(Date.UTC(2026, 9, 1, 9, 30))} />);
  await screen.findByRole('heading', { level: 2, name: 'Inbox' });
  if (id === 'fax-0003') await user.click(screen.getByRole('button', { name: 'Incoming fax' }));
  await user.click(screen.getAllByRole('button').find((b) => b.dataset['faxId'] === id)!);
  await screen.findByRole('heading', { level: 2, name: `Fax ${id}` });
  return view;
}

const fieldButton = (name: string) => document.querySelector<HTMLElement>(`button[data-field="${name}"]`)!;
const overlay = () => document.querySelector<SVGSVGElement>('svg.source-string-overlay')!;
const paths = () => Array.from(overlay().querySelectorAll('path'));

function numbers(d: string): number[] {
  return (d.match(/-?\d+(\.\d+)?(e-?\d+)?/g) ?? []).map(Number);
}

beforeEach(() => {
  stubSite();
  stubMedia({ wide: true, reduce: false });
  stubLayout();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('source string overlay', () => {
  it('draws nothing until a field is selected, then exactly one path', async () => {
    const user = userEvent.setup();
    await openFax(user, 'fax-0003');
    expect(overlay()).not.toBeNull();
    expect(paths()).toHaveLength(0);
    await user.click(fieldButton('patientName'));
    expect(paths()).toHaveLength(1);
    expect(paths()[0]).toHaveAttribute('data-source-field', 'patientName');
  });

  it('starts on the left edge of the selected card and ends on the first cited word', async () => {
    const user = userEvent.setup();
    await openFax(user, 'fax-0003');
    const fax = SampleFaxSchema.parse(committedFaxes['fax-0003.json']);
    const model = fax.readers.model;
    if (model.status !== 'ok') throw new Error('no answer');
    const field = (name: string) => model.fields.find((f) => f.name === name)!;
    const crop = cropBox(fax.ocr.words, fax);

    const ends: number[][] = [];
    for (const name of ['patientName', 'dob']) {
      await user.click(fieldButton(name));
      const p = paths()[0]!;
      expect(p).toHaveAttribute('data-source-field', name);
      expect(p).toHaveAttribute('data-clamped', 'false');
      const [sx, sy, , , , , ex, ey] = numbers(p.getAttribute('d')!);
      // The fax is left of the card column: start on the card's left edge, at its vertical middle.
      expect([sx, sy]).toEqual([700, 350]);
      const word = imageToScreen(ghostRects(field(name), fax.ocr.words)[0]!, crop, rectOf(SVG_RECT.x, SVG_RECT.y, SVG_RECT.width, SVG_RECT.height))!;
      // End on the word's right edge (it faces the card), at its vertical middle.
      expect(ex).toBeCloseTo(word.x + word.width, 6);
      expect(ey).toBeCloseTo(word.y + word.height / 2, 6);
      ends.push([ex!, ey!]);
    }
    expect(ends[0]).not.toEqual(ends[1]);
  });

  it('is hidden from assistive technology, takes no pointer events and has no tab stops', async () => {
    const user = userEvent.setup();
    const { container } = await openFax(user, 'fax-0003');
    const before = Array.from(container.querySelectorAll('a, button, input, select, textarea, [tabindex]'));
    await user.click(fieldButton('npi'));
    expect(paths()).toHaveLength(1);
    const o = overlay();
    expect(o).toHaveAttribute('aria-hidden', 'true');
    expect(o).toHaveAttribute('focusable', 'false');
    expect(o.style.pointerEvents).toBe('none');
    expect(o.querySelectorAll('a, button, input, select, textarea, [tabindex], [role], title, desc, text')).toHaveLength(0);
    expect(o.hasAttribute('tabindex')).toBe(false);
    // The tab sequence is the same set of controls as without the overlay: none is inside it.
    const after = Array.from(container.querySelectorAll('a, button, input, select, textarea, [tabindex]'));
    expect(after.some((el) => o.contains(el))).toBe(false);
    expect(after.length).toBeGreaterThanOrEqual(before.length);
    // Sits after the viewer's controls and the fax, never between them.
    expect(o.closest('.viewer-image')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Verify record' })).toBeInTheDocument();
  });

  it('keeps one path when another field is selected, keyed to the new field', async () => {
    const user = userEvent.setup();
    await openFax(user, 'fax-0003');
    await user.click(fieldButton('patientName'));
    const first = paths()[0]!;
    await user.click(fieldButton('urgency'));
    expect(paths()).toHaveLength(1);
    expect(paths()[0]).toHaveAttribute('data-source-field', 'urgency');
    expect(paths()[0]).not.toBe(first);
  });

  it('draws no string for a field with no cited words', async () => {
    const user = userEvent.setup();
    await openFax(user, 'fax-0002');
    await user.click(screen.getByRole('button', { name: 'Rules reader' }));
    await user.click(fieldButton('urgency'));
    expect(paths()).toHaveLength(1);
    await user.click(fieldButton('npi')); // the rules reader found no provider number on this fax
    expect(document.querySelector('g[data-field="npi"]')).toBeNull();
    expect(paths()).toHaveLength(0);
  });

  it('uses the flag class for a flagged field and the plain class for a clean one', async () => {
    const user = userEvent.setup();
    await openFax(user, 'fax-0003');
    await user.click(fieldButton('npi'));
    expect(paths()[0]).toHaveClass('ghost-string', 'ghost-string-flag');
    await user.click(fieldButton('patientName'));
    expect(paths()[0]).toHaveClass('ghost-string');
    expect(paths()[0]).not.toHaveClass('ghost-string-flag');
  });

  it('keeps the flag class after the flagged field is accepted (same rule as the highlights)', async () => {
    const user = userEvent.setup();
    await openFax(user, 'fax-0003');
    await user.click(fieldButton('npi'));
    await user.click(document.querySelector<HTMLElement>('[data-accept="npi"]')!);
    expect(paths()[0]).toHaveClass('ghost-string-flag');
  });

  it('draws in with an animation class, and under reduced motion has none', async () => {
    const user = userEvent.setup();
    await openFax(user, 'fax-0003');
    await user.click(fieldButton('npi'));
    // jsdom does not run CSS; the 300ms timing itself is browser-only.
    expect(paths()[0]).toHaveClass('ghost-string-draw');
  });

  it('has no animation class under reduced motion', async () => {
    stubMedia({ wide: true, reduce: true });
    const user = userEvent.setup();
    await openFax(user, 'fax-0003');
    await user.click(fieldButton('npi'));
    expect(paths()).toHaveLength(1);
    expect(paths()[0]!.getAttribute('class')).toBe('ghost-string ghost-string-flag');
  });

  it('draws no string when the layout stacks to one column', async () => {
    stubMedia({ wide: false, reduce: false });
    const user = userEvent.setup();
    await openFax(user, 'fax-0003');
    await user.click(fieldButton('npi'));
    expect(overlay()).toHaveAttribute('aria-hidden', 'true');
    expect(paths()).toHaveLength(0);
  });

  it('draws no string when the card is under the sticky bar', async () => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this.matches('li.field-card')) return rectOf(700, 20, 400, 60);
      if (this.matches('.summary-bar')) return rectOf(0, 40, 1360, 60);
      if (this.matches('.viewer-side')) return rectOf(690, 0, 420, 900);
      if (this.matches('svg.fax-image')) return rectOf(40, 150, 600, 800);
      if (this.matches('.fax-sheet')) return rectOf(20, 130, 640, 840);
      return rectOf(0, 0, 0, 0);
    });
    const user = userEvent.setup();
    await openFax(user, 'fax-0003');
    await user.click(fieldButton('npi'));
    expect(paths()).toHaveLength(0);
  });

  it('has no axe violations with the overlay present', async () => {
    const user = userEvent.setup();
    const view = await openFax(user, 'fax-0003');
    await user.click(fieldButton('npi'));
    expect(paths()).toHaveLength(1);
    expect((await axe.run(view.container)).violations).toEqual([]);
  });
});
