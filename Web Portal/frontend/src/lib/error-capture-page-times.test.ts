import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installErrorCapture, interactionText } from './error-capture';
import { createPageLifecycle, type PageLifecycle } from './page-lifecycle';
import type { ErrorReport } from './error-reporter';

// 1.23.14: page times count only while the page is on screen (the live log's 986–3386 s "Slow to show
// the page" were pages opened in a background tab, prerendered, restored or left on a sleeping machine).

type FakeEntry = Record<string, unknown> & { startTime: number };
class FakePO {
  static supportedEntryTypes = ['largest-contentful-paint', 'layout-shift', 'event', 'visibility-state'];
  static live: FakePO[] = [];
  type = '';
  constructor(private cb: (list: { getEntries: () => FakeEntry[] }) => void) {
    FakePO.live.push(this);
  }
  observe(o: { type: string }) {
    this.type = o.type;
  }
  disconnect() {
    FakePO.live = FakePO.live.filter((p) => p !== this);
  }
  static emit(type: string, entries: FakeEntry[]) {
    for (const p of FakePO.live.filter((x) => x.type === type)) p.cb({ getEntries: () => entries });
  }
}

let reports: ErrorReport[];
let uninstall: () => void;
let mono: number;
let life: PageLifecycle | null;
let navEntry: Record<string, number> | null;

const setVisibility = (state: 'visible' | 'hidden') => Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
const hide = () => {
  setVisibility('hidden');
  document.dispatchEvent(new Event('visibilitychange'));
};
const show = () => {
  setVisibility('visible');
  document.dispatchEvent(new Event('visibilitychange'));
};
const tick = () => new Promise((r) => setTimeout(r, 0));

/** Install with the fake observer, a fake clock, and the page visible or hidden from its start. */
function start(opts: { hidden?: boolean; activationStart?: number; visibilityEntries?: { name: string; startTime: number }[] } = {}) {
  uninstall();
  life?.stop();
  reports.length = 0;
  setVisibility(opts.hidden ? 'hidden' : 'visible');
  life = createPageLifecycle(window, { clock: { mono: () => mono, wall: () => mono }, activationStart: () => opts.activationStart ?? 0, visibilityEntries: () => opts.visibilityEntries ?? [] });
  uninstall = installErrorCapture(window, { report: (r) => reports.push(r), flush: async () => {} }, { origin: window.location.origin, lifecycle: life });
}
const slow = () => reports.filter((r) => r.kind === 'SLOW');

beforeEach(() => {
  reports = [];
  uninstall = () => {};
  life = null;
  mono = 0;
  navEntry = null;
  FakePO.live = [];
  (window as unknown as { PerformanceObserver: unknown }).PerformanceObserver = FakePO;
  vi.spyOn(window.performance, 'getEntriesByType').mockImplementation(((type: string) => (type === 'navigation' && navEntry ? [navEntry] : [])) as unknown as typeof performance.getEntriesByType);
});
afterEach(() => {
  uninstall();
  life?.stop();
  delete (window as unknown as { PerformanceObserver?: unknown }).PerformanceObserver;
  vi.restoreAllMocks();
  setVisibility('visible');
});

describe('page-show times: only while the page is on screen', () => {
  it('a page shown on screen slowly is still reported (its largest content at 5 s)', () => {
    start();
    FakePO.emit('largest-contentful-paint', [{ startTime: 1200 }, { startTime: 5000 }]);
    mono = 9000;
    hide();
    expect(slow()).toEqual([{ kind: 'SLOW', detail: 'lcp', value: 5000, page: '/' }]);
  });

  it('a page opened in a background tab: no page-show time at all (the live log’s 3386 s)', () => {
    start({ hidden: true });
    FakePO.emit('largest-contentful-paint', [{ startTime: 3_386_200 }]);
    mono = 3_390_000;
    show();
    hide();
    expect(slow()).toEqual([]);
  });

  it('switched away before it finished showing (even before this script ran): only what was shown before that counts', () => {
    mono = 900_000;
    start({ visibilityEntries: [{ name: 'visible', startTime: 0 }, { name: 'hidden', startTime: 3000 }, { name: 'visible', startTime: 890_000 }] });
    FakePO.emit('largest-contentful-paint', [{ startTime: 2000 }, { startTime: 891_300 }]);
    hide();
    expect(slow()).toEqual([]); // 2.0 s is not slow, and 891 s happened after the page was first hidden
  });

  it('a prerendered page counts from when it was shown (its activation)', () => {
    start({ activationStart: 7000 });
    FakePO.emit('largest-contentful-paint', [{ startTime: 12_500 }]);
    mono = 20_000;
    hide();
    expect(slow()).toEqual([{ kind: 'SLOW', detail: 'lcp', value: 5500, page: '/' }]);
  });

  it('a page-show time over 2 minutes is the page in the background (a sleeping machine), not slowness', () => {
    start();
    FakePO.emit('largest-contentful-paint', [{ startTime: 121_000 }]);
    mono = 130_000;
    hide();
    expect(slow()).toEqual([]);
  });

  it('a page restored from the back-forward cache never reports a page-show time again', () => {
    start();
    FakePO.emit('largest-contentful-paint', [{ startTime: 6000 }]);
    window.dispatchEvent(new Event('pagehide'));
    expect(slow()).toHaveLength(1);
    window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
    FakePO.emit('largest-contentful-paint', [{ startTime: 9000 }]);
    hide();
    expect(slow()).toHaveLength(1);
  });

  it('the page load: reported when on screen; not when hidden before it finished; from the activation; capped', async () => {
    navEntry = { loadEventEnd: 9000, duration: 9000 };
    start();
    await tick();
    expect(slow()).toEqual([{ kind: 'SLOW', detail: 'load', value: 9000, page: '/' }]);

    navEntry = { loadEventEnd: 54_400, duration: 54_400 };
    start();
    mono = 3000;
    hide();
    await tick();
    expect(slow()).toEqual([]);

    navEntry = { loadEventEnd: 15_000, duration: 15_000 };
    start({ activationStart: 5000 });
    await tick();
    expect(slow()).toEqual([{ kind: 'SLOW', detail: 'load', value: 10_000, page: '/' }]);

    navEntry = { loadEventEnd: 986_100, duration: 986_100 };
    start();
    await tick();
    expect(slow()).toEqual([]);
  });
});

describe('slow clicks and key presses (1.23.14)', () => {
  it('reported with what they were on (never its words); not while the page was away', () => {
    start();
    const button = document.createElement('button');
    button.textContent = 'Secret task title';
    const input = Object.assign(document.createElement('input'), { type: 'text' });
    FakePO.emit('event', [
      { name: 'click', interactionId: 7, duration: 640, startTime: 1000, target: button },
      { name: 'keydown', interactionId: 8, duration: 520, startTime: 2000, target: input },
      { name: 'pointerdown', interactionId: 0, duration: 900, startTime: 2500, target: button }, // not an interaction
    ]);
    expect(slow()).toEqual([
      { kind: 'SLOW', detail: 'inp', value: 640, resource: 'a click on a button' },
      { kind: 'SLOW', detail: 'inp', value: 520, resource: 'a key press in a text box' },
    ]);
    reports.length = 0;
    mono = 3000;
    document.dispatchEvent(new Event('freeze'));
    mono = 30_000;
    document.dispatchEvent(new Event('resume'));
    FakePO.emit('event', [{ name: 'click', interactionId: 9, duration: 28_000, startTime: 2900, target: button }]);
    mono = 31_000;
    hide();
    FakePO.emit('event', [{ name: 'click', interactionId: 10, duration: 700, startTime: 31_000, target: button }]);
    expect(slow()).toEqual([]);
  });

  it('layout shifts while the page was away do not count', () => {
    start();
    mono = 1000;
    hide();
    mono = 2000;
    show();
    FakePO.emit('layout-shift', [{ startTime: 1200, value: 0.4, hadRecentInput: false }, { startTime: 2500, value: 0.1, hadRecentInput: false }]);
    hide();
    expect(slow()).toEqual([]);
  });
});

describe('interactionText: what a slow click or key press was on, in plain words', () => {
  it('names the kind of element and of input, never its text or label', () => {
    const el = (html: string) => {
      const box = document.createElement('div');
      box.innerHTML = html;
      return box.firstElementChild!;
    };
    expect(interactionText('click', el('<a href="/x">Fire alarm</a>'))).toBe('a click on a link');
    expect(interactionText('pointerup', el('<span role="button" aria-label="Delete Fire alarm">x</span>'))).toBe('a click on a button');
    expect(interactionText('keydown', el('<textarea></textarea>'))).toBe('a key press in a text box');
    expect(interactionText('keyup', el('<div contenteditable="true"></div>'))).toBe('a key press in a text editor');
    expect(interactionText('click', el('<input type="checkbox">'))).toBe('a click on a tick box');
    expect(interactionText('click', el('<select></select>'))).toBe('a click on a list');
    expect(interactionText('click', el('<div role="tab"></div>'))).toBe('a click on a tab');
    expect(interactionText('click', el('<button><svg></svg></button>').firstElementChild)).toBe('a click on a button');
    expect(interactionText('click', el('<div><span>card</span></div>'))).toBe('a click on the page');
    expect(interactionText('click', null)).toBe('a click');
    expect(interactionText('touchend', null)).toBe('a tap');
  });
});
