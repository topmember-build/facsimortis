import { afterEach, describe, expect, it, vi } from 'vitest';
import { OVERLAY_ATTRIBUTE, OVERLAY_SCRIPT, RING_MS } from '../../tools/demo-capture/overlay.js';

// V1b. The cursor overlay script in jsdom (the web test project). It sits outside web/ because nothing under
// web/ may refer to tools/. The real look is checked in the probe clip.

function inject() {
  // The same text the capture script gives context.addInitScript.
  new Function(OVERLAY_SCRIPT)();
}

const hosts = () => document.querySelectorAll(`[${OVERLAY_ATTRIBUTE}]`);

afterEach(() => {
  hosts().forEach((host) => host.remove());
  delete (window as unknown as { __demoCursor?: unknown }).__demoCursor;
  vi.useRealTimers();
});

describe('the cursor overlay', () => {
  it('adds one hidden host on <html>, outside the page, that ignores the mouse', () => {
    inject();
    const all = hosts();
    expect(all).toHaveLength(1);
    const host = all[0] as HTMLElement;
    expect(host.parentElement).toBe(document.documentElement);
    expect(host.getAttribute('aria-hidden')).toBe('true');
    expect(host.style.pointerEvents).toBe('none');
    expect(host.style.position).toBe('fixed');
    // Closed shadow root: the page cannot see into it.
    expect(host.shadowRoot).toBeNull();
    expect(document.body.contains(host)).toBe(false);
  });

  it('does not add a second host or a second set of listeners when run again', () => {
    const spy = vi.spyOn(window, 'addEventListener');
    inject();
    inject();
    expect(hosts()).toHaveLength(1);
    expect(spy.mock.calls.filter(([type]) => type === 'mousemove')).toHaveLength(1);
    expect(spy.mock.calls.filter(([type]) => type === 'mousedown')).toHaveLength(1);
  });

  it('puts the host back after the document is replaced, and lets clicks through to the page', () => {
    inject();
    hosts()[0]!.remove();
    expect(hosts()).toHaveLength(0);
    inject();
    expect(hosts()).toHaveLength(1);
    const button = document.createElement('button');
    const clicked = vi.fn();
    button.addEventListener('click', clicked);
    document.body.append(button);
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 40, clientY: 30 }));
    button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    button.click();
    expect(clicked).toHaveBeenCalledTimes(1);
    button.remove();
  });

  it('follows the mouse and draws a ring on each press that is gone after the animation', () => {
    vi.useFakeTimers();
    const state = () => (window as unknown as { __demoCursor: { x: number; y: number; layer: HTMLElement; cursor: SVGElement } }).__demoCursor;
    inject();
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 120, clientY: 80 }));
    expect([state().x, state().y]).toEqual([120, 80]);
    expect(state().cursor.style.transform).toBe('translate(120px, 80px)');
    window.dispatchEvent(new MouseEvent('mousedown'));
    const rings = state().layer.querySelectorAll('.ring');
    expect(rings).toHaveLength(1);
    expect((rings[0] as HTMLElement).style.left).toBe('120px');
    // jsdom has no Web Animations, so the script falls back to a timer of the same length.
    vi.advanceTimersByTime(RING_MS);
    expect(state().layer.querySelectorAll('.ring')).toHaveLength(0);
  });
});
