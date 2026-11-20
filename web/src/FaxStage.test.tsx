import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';
import { SampleFaxSchema } from '../../src/samples/schema.js';
import { App } from './App';
import { ghostRects } from './ghost';
import { committedFaxes, stubSite } from './test-site';

type UserApi = ReturnType<typeof userEvent.setup>;

async function openFax(user: UserApi, id: string) {
  const view = render(<App now={() => new Date(Date.UTC(2026, 9, 1, 9, 30))} />);
  await screen.findByRole('heading', { level: 2, name: 'Inbox' });
  if (id === 'fax-0003') await user.click(screen.getByRole('button', { name: 'Incoming fax' }));
  await user.click(screen.getAllByRole('button').find((b) => b.dataset['faxId'] === id)!);
  await screen.findByRole('heading', { level: 2, name: `Fax ${id}` });
  return view;
}

const accept = (name: string) => document.querySelector<HTMLElement>(`[data-accept="${name}"]`)!;
const edit = (name: string) => document.querySelector<HTMLElement>(`[data-edit="${name}"]`)!;

describe('fax stage frame', () => {
  it('wraps the viewer SVG in a stage and a paper sheet, before the field column', async () => {
    stubSite();
    const user = userEvent.setup();
    await openFax(user, 'fax-0003');
    const svg = document.querySelector('svg.fax-image')!;
    const sheet = svg.closest('.fax-sheet')!;
    expect(sheet).not.toBeNull();
    expect(sheet.parentElement).toHaveClass('fax-stage');
    // Only the frame is added: the sheet holds the SVG and nothing else, so no extra overlay element exists.
    expect(sheet.children).toHaveLength(1);
    const image = document.querySelector('.viewer-image')!;
    const side = document.querySelector('.viewer-side')!;
    expect(image.compareDocumentPosition(side) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(image.nextElementSibling).toBe(side);
    expect(screen.getByRole('button', { name: 'Show full page' })).toBeInTheDocument();
    expect(screen.getByText('The highlight shows where the page value was read.')).toBeInTheDocument();
  });

  it('keeps every rect equal to its word box in the cropped and full views', async () => {
    stubSite();
    const user = userEvent.setup();
    await openFax(user, 'fax-0003');
    const fax = SampleFaxSchema.parse(committedFaxes['fax-0003.json']);
    const check = () => {
      const rects = [...document.querySelectorAll<SVGRectElement>('svg.fax-image rect[data-word-id]')];
      expect(rects.length).toBeGreaterThan(0);
      for (const rect of rects) {
        const [x0, y0, x1, y1] = fax.ocr.words.find((w) => w.id === rect.dataset['wordId'])!.box;
        expect(rect.getAttribute('x')).toBe(String(x0));
        expect(rect.getAttribute('y')).toBe(String(y0));
        expect(rect.getAttribute('width')).toBe(String(x1 - x0));
        expect(rect.getAttribute('height')).toBe(String(y1 - y0));
      }
    };
    check();
    await user.click(screen.getByRole('button', { name: 'Show full page' }));
    check();
    const all = fax.readers.model.status === 'ok' ? fax.readers.model.fields : [];
    expect(all.some((f) => ghostRects(f, fax.ocr.words).length > 0)).toBe(true);
  });

  it('has no axe violations on the review screen (model and rules) and when laid to rest', async () => {
    stubSite();
    const user = userEvent.setup();
    const view = await openFax(user, 'fax-0003');
    expect((await axe.run(view.container)).violations).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Rules reader' }));
    expect((await axe.run(view.container)).violations).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Model answers' }));
    await user.click(accept('npi'));
    await user.click(edit('callbackPhone'));
    const input = screen.getByLabelText('New value for Callback phone');
    await user.clear(input);
    await user.type(input, '555-0151{Enter}');
    await user.click(screen.getByRole('button', { name: 'Verify record' }));
    await screen.findByRole('button', { name: 'Download JSON' });
    expect(document.querySelector('.fax-sheet')).not.toBeNull();
    expect((await axe.run(view.container)).violations).toEqual([]);
  });
});
