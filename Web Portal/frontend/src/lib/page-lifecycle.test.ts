import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createPageLifecycle, SLEEP_DRIFT_MS, type PageLifecycle } from './page-lifecycle';

// 1.23.14 (the Error log's time rules) — whether the page was on screen. A page in a background tab,
// a frozen tab, a page being left or prerendered, or a device asleep is not "slow": its clocks ran on
// while nothing could happen. Each test drives the page's events and two fake clocks.

let mono: number;
let wall: number;
let life: PageLifecycle;
const clock = { mono: () => mono, wall: () => wall };

const setVisibility = (state: 'visible' | 'hidden') => Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
const hide = () => {
  setVisibility('hidden');
  document.dispatchEvent(new Event('visibilitychange'));
};
const show = () => {
  setVisibility('visible');
  document.dispatchEvent(new Event('visibilitychange'));
};
const later = (ms: number) => {
  mono += ms;
  wall += ms;
};

beforeEach(() => {
  mono = 1000;
  wall = Date.parse('2026-11-11T00:41:00Z');
  setVisibility('visible');
  life = createPageLifecycle(window, { clock });
});
afterEach(() => {
  life.stop();
  setVisibility('visible');
});

describe('createPageLifecycle: was the page on screen?', () => {
  it('a request with the page on screen all along is not interrupted', () => {
    const start = life.mark();
    later(12_000);
    expect(life.awaySince(start)).toBe(false);
  });

  it('hidden at any moment during it (a background tab), even if visible again at its end: interrupted', () => {
    const start = life.mark();
    later(1000);
    hide();
    later(20_000);
    show();
    later(500);
    expect(life.awaySince(start)).toBe(true);
    // A request that starts after the page came back is clean again.
    const next = life.mark();
    later(11_000);
    expect(life.awaySince(next)).toBe(false);
  });

  it('started while hidden, or still hidden at its end: interrupted', () => {
    hide();
    const start = life.mark();
    later(30_000);
    show();
    expect(life.awaySince(start)).toBe(true);
    const visible = life.mark();
    hide();
    expect(life.awaySince(visible)).toBe(true);
  });

  it('a frozen tab (freeze … resume) interrupts what was waiting, even with the page visible', () => {
    const start = life.mark();
    document.dispatchEvent(new Event('freeze'));
    later(29_800);
    document.dispatchEvent(new Event('resume'));
    expect(life.awaySince(start)).toBe(true);
    expect(life.awaySince(life.mark())).toBe(false);
  });

  it('the page being left (pagehide), or restored from the back-forward cache: interrupted', () => {
    const start = life.mark();
    window.dispatchEvent(new Event('pagehide'));
    later(60_000);
    window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
    expect(life.awaySince(start)).toBe(true);
    expect(life.restored()).toBe(true);
  });

  it('a device that slept: the wall clock ran on while the page’s own clock did not (by over 2 s)', () => {
    const start = life.mark();
    mono += 10_500;
    wall += 10_500 + SLEEP_DRIFT_MS + 1;
    expect(life.awaySince(start)).toBe(true);
    // A small difference (the wall clock nudged by a time sync) is not a sleep.
    const next = life.mark();
    mono += 12_000;
    wall += 12_000 + 900;
    expect(life.awaySince(next)).toBe(false);
  });

  it('a wall clock moved back (a time sync) by over 2 s: not trusted either', () => {
    const start = life.mark();
    mono += 12_000;
    wall += 12_000 - 5000;
    expect(life.awaySince(start)).toBe(true);
  });
});

describe('the first time the page was hidden, and stretches of time away', () => {
  it('never hidden: Infinity; then the moment it was first hidden, and it stays the first', () => {
    expect(life.firstHiddenTime()).toBe(Infinity);
    later(4000);
    hide();
    expect(life.firstHiddenTime()).toBe(5000);
    show();
    later(10_000);
    hide();
    expect(life.firstHiddenTime()).toBe(5000);
  });

  it('a page that starts hidden (opened in a background tab): 0', () => {
    life.stop();
    setVisibility('hidden');
    life = createPageLifecycle(window, { clock });
    expect(life.firstHiddenTime()).toBe(0);
    expect(life.awayBetween(0, 50)).toBe(true);
  });

  it('a prerendered page is away until it is shown; its start is the activation', () => {
    life.stop();
    Object.defineProperty(document, 'prerendering', { value: true, configurable: true });
    setVisibility('hidden');
    life = createPageLifecycle(window, { clock, activationStart: () => 7000 });
    // Prerendering is not "hidden" for the first-hidden rule (web-vitals): it waits for the activation.
    expect(life.firstHiddenTime()).toBe(Infinity);
    expect(life.awaySince(life.mark())).toBe(true);
    Object.defineProperty(document, 'prerendering', { value: false, configurable: true });
    setVisibility('visible');
    mono = 7000;
    document.dispatchEvent(new Event('prerenderingchange'));
    expect(life.activationStart()).toBe(7000);
    const start = life.mark();
    later(2000);
    expect(life.awaySince(start)).toBe(false);
    Object.defineProperty(document, 'prerendering', { value: undefined, configurable: true });
  });

  it('the browser’s own visibility-state entries count from before this script ran', () => {
    life.stop();
    life = createPageLifecycle(window, {
      clock,
      visibilityEntries: () => [
        { name: 'visible', startTime: 0 },
        { name: 'hidden', startTime: 300 },
        { name: 'visible', startTime: 900 },
      ],
    });
    expect(life.firstHiddenTime()).toBe(300);
    expect(life.awayBetween(400, 500)).toBe(true);
    expect(life.awayBetween(950, 990)).toBe(false);
  });

  it('awayBetween: a stretch of the timeline that touched any time away', () => {
    later(1000); // 2000
    hide();
    later(3000); // 5000
    show();
    expect(life.awayBetween(1000, 1999)).toBe(false);
    expect(life.awayBetween(1500, 2500)).toBe(true);
    expect(life.awayBetween(4000, 6000)).toBe(true);
    expect(life.awayBetween(5001, 9000)).toBe(false);
    document.dispatchEvent(new Event('freeze'));
    expect(life.awayBetween(5001, 9000)).toBe(true); // frozen now, and not back yet
  });

  it('a page made to look visible again without an event (a test tool, an odd browser) is not away for ever', () => {
    hide();
    setVisibility('visible'); // no visibilitychange
    later(1000);
    const start = life.mark();
    later(500);
    expect(life.awaySince(start)).toBe(false);
    expect(life.awayBetween(mono - 100, mono)).toBe(false);
  });

  it('stop() removes its listeners', () => {
    life.stop();
    hide();
    expect(life.firstHiddenTime()).toBe(Infinity);
  });
});

// Review fixes (1.23.14).
describe('edges of a stretch away', () => {
  it('a request starting at the very moment the page came back is not counted as away (a coarse clock)', () => {
    hide();
    later(5000);
    show(); // the stretch ends at this moment…
    const start = life.mark(); // …and the refetch-on-return request starts at the same one
    expect(life.awayBetween(mono, mono + 10_000)).toBe(false);
    later(10_000);
    expect(life.awaySince(start)).toBe(false);
  });

  it('a prerendered page: the browser’s entries from before its activation are not "hidden" (web-vitals)', () => {
    life.stop();
    Object.defineProperty(document, 'prerendering', { value: true, configurable: true });
    setVisibility('hidden');
    life = createPageLifecycle(window, { clock, activationStart: () => 0, visibilityEntries: () => [{ name: 'hidden', startTime: 0 }] });
    expect(life.firstHiddenTime()).toBe(Infinity);
    Object.defineProperty(document, 'prerendering', { value: undefined, configurable: true });
    // Activated before this script ran: only entries after the activation count.
    life.stop();
    setVisibility('visible');
    life = createPageLifecycle(window, { clock, activationStart: () => 7000, visibilityEntries: () => [{ name: 'hidden', startTime: 0 }, { name: 'visible', startTime: 7000 }] });
    expect(life.firstHiddenTime()).toBe(Infinity);
  });
});
