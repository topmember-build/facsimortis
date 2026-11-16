import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, '..', 'web', 'src', 'styles.css'), 'utf8').replace(/\r\n/g, '\n');

function rule(prelude: string): string {
  const start = css.indexOf(`${prelude} {`);
  expect(start, `${prelude} not found`).toBeGreaterThanOrEqual(0);
  return css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
}

describe('styles.css: sr-only, edit form and buttons', () => {
  it('has the standard visually-hidden rule', () => {
    const sr = rule('.sr-only');
    expect(sr).toMatch(/position:\s*absolute/);
    expect(sr).toMatch(/width:\s*1px/);
    expect(sr).toMatch(/height:\s*1px/);
    expect(sr).toMatch(/overflow:\s*hidden/);
    expect(sr).toMatch(/clip:\s*rect\(0,\s*0,\s*0,\s*0\)/);
    expect(sr).toMatch(/white-space:\s*nowrap/);
  });

  it('does not hide the visible selection status line', () => {
    expect(rule('.selection-line')).not.toMatch(/clip|1px/);
  });

  it('lays the edit form out as an inset panel with a 44px input and a block label', () => {
    expect(rule('.edit-form')).toMatch(/border:\s*1px solid var\(--edge\)/);
    expect(rule('.edit-form input')).toMatch(/min-height:\s*2\.75rem/);
    expect(rule('.edit-label')).toMatch(/display:\s*block/);
  });

  it('lays field actions out as a wrapping row with gaps', () => {
    const actions = rule('.field-actions');
    expect(actions).toMatch(/display:\s*flex/);
    expect(actions).toMatch(/flex-wrap:\s*wrap/);
    expect(actions).toMatch(/gap:/);
  });

  it('gives the primary button a neutral filled style, not the ghost or flag colour', () => {
    const primary = rule('.button-primary,\n.button.button-primary');
    expect(primary).toMatch(/background:\s*var\(--primary-fill\)/);
    expect(primary).not.toMatch(/--ghost|--flag/);
    const disabled = rule(".button.button-primary[aria-disabled='true'],\n.button.button-primary[aria-disabled='true']:hover");
    expect(disabled).toMatch(/cursor:\s*not-allowed/);
    expect(disabled).toMatch(/dashed/);
  });
});
