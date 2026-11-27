/**
 * The cursor and click ring drawn into the page for the recording. Headless Chrome draws no mouse
 * pointer, so this script draws one: a white arrow with a dark outline that follows the real mouse
 * events Playwright sends, and a ring that grows and fades on each mouse press.
 *
 * It runs in the browser, added to every page with context.addInitScript, so it is kept here as the text
 * of a script. It draws inside a closed shadow root on a host element that is a child of <html>, outside the
 * React root: the site's CSS cannot reach it, and it cannot change the site's layout. The host is
 * aria-hidden and ignores the mouse (pointer-events: none), so clicks and Playwright's checks go through to the
 * page. The colours are the site's cream text colour and its near-black ground, not amber (the interface),
 * coral (flags) or teal (source ghosts), so the cursor is never mistaken for one of those.
 *
 * Running it again on the same window (for example after the export card replaces the document) adds the host
 * back where the cursor last was, and adds no second set of listeners.
 */

/** The host element's attribute, so tests and the capture script can find it. */
export const OVERLAY_ATTRIBUTE = 'data-demo-cursor';

/** How long the click ring takes to grow and fade, in milliseconds. */
export const RING_MS = 450;

export const OVERLAY_SCRIPT = `(() => {
  const ATTR = ${JSON.stringify(OVERLAY_ATTRIBUTE)};
  const RING_MS = ${RING_MS};
  const state = window.__demoCursor || (window.__demoCursor = { x: -100, y: -100, listening: false, host: null, cursor: null, layer: null });

  function build() {
    const host = document.createElement('div');
    host.setAttribute(ATTR, '');
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;overflow:hidden;';
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML =
      '<style>' +
      '.cursor{position:absolute;left:0;top:0;width:28px;height:28px;overflow:visible;will-change:transform;}' +
      '.ring{position:absolute;left:0;top:0;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;' +
      'border:3px solid #fff3dc;box-shadow:0 0 0 2px rgba(20,20,20,.85),inset 0 0 0 2px rgba(20,20,20,.85);opacity:0;}' +
      '</style>' +
      '<div class="layer"></div>' +
      '<svg class="cursor" viewBox="0 0 28 28" aria-hidden="true">' +
      '<path d="M2 2 L2 22 L7.5 16.5 L11 25 L14.5 23.5 L11 15 L19 15 Z" fill="#fff3dc" stroke="#141414" stroke-width="1.6" stroke-linejoin="round"/>' +
      '</svg>';
    state.host = host;
    state.cursor = root.querySelector('.cursor');
    state.layer = root.querySelector('.layer');
    place();
  }

  function place() {
    if (state.cursor) state.cursor.style.transform = 'translate(' + state.x + 'px,' + state.y + 'px)';
  }

  function attach() {
    if (!document.documentElement) return false;
    if (!state.host) build();
    if (!state.host.isConnected) document.documentElement.appendChild(state.host);
    return true;
  }

  function ring() {
    if (!attach()) return;
    const el = document.createElement('div');
    el.className = 'ring';
    el.style.left = state.x + 'px';
    el.style.top = state.y + 'px';
    state.layer.appendChild(el);
    if (typeof el.animate === 'function') {
      const run = el.animate(
        [ { transform: 'scale(0.3)', opacity: 0.95 }, { transform: 'scale(1)', opacity: 0 } ],
        { duration: RING_MS, easing: 'cubic-bezier(.2,.7,.3,1)' },
      );
      run.onfinish = () => el.remove();
    } else {
      setTimeout(() => el.remove(), RING_MS);
    }
  }

  if (!state.listening) {
    state.listening = true;
    window.addEventListener('mousemove', (event) => {
      state.x = event.clientX;
      state.y = event.clientY;
      if (attach()) place();
    }, { capture: true, passive: true });
    window.addEventListener('mousedown', () => ring(), { capture: true, passive: true });
  }
  if (!attach()) document.addEventListener('DOMContentLoaded', attach, { once: true });
})();
`;
