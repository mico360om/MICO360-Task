import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { HOVER_DELAY_MS, LONG_PRESS_MS, installTruncationTips, isCut } from './truncation-tips';

/** Pretend an element is cut short (jsdom lays nothing out). */
function cut(el: HTMLElement, how: 'wide' | 'tall' | 'none' = 'wide') {
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: 100 });
  Object.defineProperty(el, 'scrollWidth', { configurable: true, value: how === 'wide' ? 260 : 100 });
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: 36 });
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: how === 'tall' ? 72 : 36 });
  el.getBoundingClientRect = () => ({ top: 100, left: 40, right: 140, bottom: 118, width: 100, height: 18, x: 40, y: 100, toJSON: () => ({}) }) as DOMRect;
  return el;
}
const tip = () => document.querySelector<HTMLElement>('[data-truncation-tip]');
let uninstall: () => void;

beforeEach(() => {
  // jsdom has no PointerEvent: a MouseEvent carries the same relatedTarget.
  if (typeof window.PointerEvent === 'undefined') vi.stubGlobal('PointerEvent', MouseEvent);
  vi.useFakeTimers();
  document.body.innerHTML = '';
  uninstall = installTruncationTips(document);
});
afterEach(() => {
  uninstall();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('tooltips on every truncation (1.23.8)', () => {
  it('a title cut short shows its whole words on hover (after a moment), and goes when the pointer leaves', () => {
    document.body.innerHTML = '<ul><li><span class="truncate" id="t">Replace the cracked expansion joint on the north ramp before the inspection</span></li></ul>';
    const el = cut(document.getElementById('t')!);
    fireEvent.pointerOver(el, { pointerType: 'mouse' });
    expect(tip()).toBeNull();
    vi.advanceTimersByTime(HOVER_DELAY_MS);
    expect(tip()).toHaveTextContent('Replace the cracked expansion joint on the north ramp before the inspection');
    // The page already has these words (screen readers read them whole): the tooltip is for the eyes only.
    expect(tip()).toHaveAttribute('aria-hidden', 'true');
    fireEvent.pointerOut(el, { relatedTarget: document.body });
    expect(tip()).toBeNull();
  });

  it('nothing when the words fit', () => {
    document.body.innerHTML = '<span class="truncate" id="t">Short</span>';
    const el = cut(document.getElementById('t')!, 'none');
    expect(isCut(el)).toBe(false);
    fireEvent.pointerOver(el, { pointerType: 'mouse' });
    vi.advanceTimersByTime(HOVER_DELAY_MS * 2);
    expect(tip()).toBeNull();
  });

  it('a few lines clamped (line-clamp) count as cut when more is hidden below', () => {
    document.body.innerHTML = '<div class="line-clamp-2" id="t">A long card title that wraps onto a third line in a narrow column</div>';
    const el = cut(document.getElementById('t')!, 'tall');
    expect(isCut(el)).toBe(true);
    fireEvent.pointerOver(el, { pointerType: 'mouse' });
    vi.advanceTimersByTime(HOVER_DELAY_MS);
    expect(tip()).toHaveTextContent('A long card title that wraps onto a third line in a narrow column');
  });

  it('keyboard focus on a control holding a cut title shows it at once; Escape puts it away', () => {
    document.body.innerHTML = '<button id="b"><span class="truncate" id="t">MICO-142 · Commission the standby generator and record the load test</span></button>';
    cut(document.getElementById('t')!);
    fireEvent.focusIn(document.getElementById('b')!);
    expect(tip()).toHaveTextContent('Commission the standby generator and record the load test');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(tip()).toBeNull();
  });

  it('focus moving away puts it away', () => {
    document.body.innerHTML = '<button id="b"><span class="truncate" id="t">A very long project name that does not fit</span></button><button id="c">Next</button>';
    cut(document.getElementById('t')!);
    fireEvent.focusIn(document.getElementById('b')!);
    expect(tip()).not.toBeNull();
    fireEvent.focusOut(document.getElementById('b')!, { relatedTarget: document.getElementById('c') });
    expect(tip()).toBeNull();
  });

  it('a long press on a touch screen shows it; a tap or a swipe does not', () => {
    document.body.innerHTML = '<span class="truncate" id="t">Nadia Al Harthy (Operations, Muscat office)</span>';
    const el = cut(document.getElementById('t')!);
    fireEvent.touchStart(el, { touches: [{ clientX: 50, clientY: 105 }] });
    vi.advanceTimersByTime(LONG_PRESS_MS / 2);
    fireEvent.touchEnd(el);
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(tip()).toBeNull();
    fireEvent.touchStart(el, { touches: [{ clientX: 50, clientY: 105 }] });
    fireEvent.touchMove(el, { touches: [{ clientX: 50, clientY: 160 }] });
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(tip()).toBeNull();
    fireEvent.touchStart(el, { touches: [{ clientX: 50, clientY: 105 }] });
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(tip()).toHaveTextContent('Nadia Al Harthy (Operations, Muscat office)');
    // The next touch anywhere puts it away.
    fireEvent.touchStart(document.body, { touches: [{ clientX: 5, clientY: 5 }] });
    expect(tip()).toBeNull();
  });

  it('where the browser already shows a title on hover, ours waits for focus or a long press (never two at once)', () => {
    document.body.innerHTML = '<button id="b" title="Site office, Block C — level 2 meeting room"><span class="truncate" id="t">Site office, Block C — level 2 meeting room</span></button>';
    const el = cut(document.getElementById('t')!);
    fireEvent.pointerOver(el, { pointerType: 'mouse' });
    vi.advanceTimersByTime(HOVER_DELAY_MS * 2);
    expect(tip()).toBeNull();
    fireEvent.focusIn(document.getElementById('b')!);
    expect(tip()).toHaveTextContent('Site office, Block C — level 2 meeting room');
  });

  it('stays while the pointer moves onto it, so it can be read', () => {
    document.body.innerHTML = '<span class="truncate" id="t">Weekly site coordination — structural, MEP and handover items</span>';
    const el = cut(document.getElementById('t')!);
    fireEvent.pointerOver(el, { pointerType: 'mouse' });
    vi.advanceTimersByTime(HOVER_DELAY_MS);
    fireEvent.pointerOut(el, { relatedTarget: tip() });
    expect(tip()).not.toBeNull();
  });
});

describe('review fixes (1.23.8)', () => {
  it('a visually hidden label (sr-only, 1px) is never “cut”: focusing a rail icon shows only the rail’s own name', () => {
    document.body.innerHTML = '<a href="/projects" id="l"><svg></svg><span class="truncate rail:sr-only" id="t">Projects</span></a>';
    const label = document.getElementById('t')!;
    Object.defineProperty(label, 'clientWidth', { configurable: true, value: 1 });
    Object.defineProperty(label, 'scrollWidth', { configurable: true, value: 60 });
    fireEvent.focusIn(document.getElementById('l')!);
    expect(tip()).toBeNull();
  });

  it('a dialog or a panel focusing itself (tabindex -1) isn’t searched for cut words', () => {
    document.body.innerHTML = '<div role="dialog" tabindex="-1" id="d"><p class="truncate" id="t">A long task title inside the panel that is cut</p></div>';
    cut(document.getElementById('t')!);
    fireEvent.focusIn(document.getElementById('d')!);
    expect(tip()).toBeNull();
  });

  it('a mouse click that focuses a card isn’t keyboard focus: no tooltip pops up', () => {
    document.body.innerHTML = '<div role="button" tabindex="0" id="c"><div class="line-clamp-2" id="t">Replace the cracked expansion joint on the north ramp before the inspection</div></div>';
    cut(document.getElementById('t')!, 'tall');
    fireEvent.pointerDown(document.getElementById('c')!);
    fireEvent.focusIn(document.getElementById('c')!);
    expect(tip()).toBeNull();
    // From the keyboard it does.
    fireEvent.keyDown(document, { key: 'Tab' });
    fireEvent.focusIn(document.getElementById('c')!);
    expect(tip()).toHaveTextContent('Replace the cracked expansion joint');
  });

  it('under a card-wide click area (a button’s overlay), hover and a long press find the cut words beneath the pointer', () => {
    document.body.innerHTML = '<div class="relative"><button id="b">Open</button><p class="truncate" id="t">Collect the site photos from Omar and the signed delivery notes</p></div>';
    const words = cut(document.getElementById('t')!);
    const button = document.getElementById('b')!;
    const before = document.elementsFromPoint;
    document.elementsFromPoint = () => [button, words, document.body];
    try {
      fireEvent.pointerOver(button, { pointerType: 'mouse', clientX: 60, clientY: 108 });
      vi.advanceTimersByTime(HOVER_DELAY_MS);
      expect(tip()).toHaveTextContent('Collect the site photos from Omar');
      fireEvent.pointerOut(button, { relatedTarget: document.body });
      fireEvent.touchStart(button, { touches: [{ clientX: 60, clientY: 108 }] });
      vi.advanceTimersByTime(LONG_PRESS_MS);
      expect(tip()).toHaveTextContent('Collect the site photos from Omar');
    } finally {
      document.elementsFromPoint = before;
    }
  });
});
