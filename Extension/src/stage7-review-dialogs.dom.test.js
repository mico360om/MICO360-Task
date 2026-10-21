// @vitest-environment jsdom
/**
 * Stage 7 review fixes — dialogs (app/dialog.js, app/search.js): Ctrl+K over a board’s New task
 * dialog, and dialogs closed out of order or taken off the page without being released.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { showModal, createRouteHold } from '../app/dialog.js';
import { searchShortcut } from '../app/search.js';

const settle = async () => {
  for (let i = 0; i < 10; i += 1) await new Promise((r) => setTimeout(r, 0));
};

beforeEach(() => {
  document.body.innerHTML = '';
});
afterEach(() => {
  document.body.innerHTML = '';
});

// ---- #4 Ctrl+K over a board's New task dialog -----------------------------------------------------

describe('review fix #4: Ctrl+K over a board’s New task dialog', () => {
  it('opens nothing (a result would wait for the dialog to close, then jump), and Chrome still doesn’t get the keys', () => {
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    const title = document.createElement('input');
    dialog.append(title);
    document.body.append(dialog);
    const release = showModal(dialog);
    title.focus();
    // As app/app.js has it: the route hold (which doesn't count the task panel) says whether to wait.
    const hold = createRouteHold(document, { except: () => null });
    const open = vi.fn();
    const handler = (e) => searchShortcut(e, { doc: document, open, blocked: () => hold.busy() });
    document.addEventListener('keydown', handler);
    try {
      const e = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true });
      title.dispatchEvent(e);
      expect(e.defaultPrevented).toBe(true);
      expect(open).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(title);
    } finally {
      document.removeEventListener('keydown', handler);
      release();
    }
  });
});

// ---- #11 dialogs closed out of order ----------------------------------------------------------------

describe('review fix #11: dialogs closed out of order', () => {
  const make = (label) => {
    const d = document.createElement('div');
    d.setAttribute('role', 'dialog');
    d.setAttribute('aria-modal', 'true');
    const b = document.createElement('button');
    b.textContent = label;
    d.append(b);
    document.body.append(d);
    return { d, b };
  };
  const page = () => {
    const app = document.createElement('div');
    app.id = 'app';
    const b = document.createElement('button');
    b.textContent = 'Behind';
    app.append(b);
    document.body.append(app);
    return { app, b };
  };

  it('the dialog underneath closes first: the page behind stays out of reach until the one on top closes too', () => {
    const { app } = page();
    const below = make('Below');
    const releaseBelow = showModal(below.d);
    const top = make('Top');
    const releaseTop = showModal(top.d);
    releaseBelow();
    below.d.remove();
    expect(app.hasAttribute('inert')).toBe(true);
    releaseTop();
    top.d.remove();
    expect(app.hasAttribute('inert')).toBe(false);
  });

  it('…and in the usual order the one below gets the keys back while the page stays out of reach', () => {
    const { app } = page();
    const below = make('Below');
    const releaseBelow = showModal(below.d);
    const top = make('Top');
    const releaseTop = showModal(top.d);
    releaseTop();
    top.d.remove();
    expect(app.hasAttribute('inert')).toBe(true);
    expect(below.d.hasAttribute('inert')).toBe(false);
    releaseBelow();
    below.d.remove();
    expect(app.hasAttribute('inert')).toBe(false);
  });

  it('a dialog taken off the page without being released: Tab isn’t held any more and the page comes back', async () => {
    const { app, b } = page();
    const gone = make('Gone');
    showModal(gone.d);
    gone.d.remove();
    await settle();
    expect(app.hasAttribute('inert')).toBe(false);
    b.focus();
    const e = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    b.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(b);
  });
});
