import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { keyboardInset, isTypingField, revealField, installKeyboardAwareness } from './keyboard-aware';

// jsdom has no layout: every box is placed by hand (viewport px), and the visual viewport — the part
// of the window above a phone's on-screen keyboard — is a stub.
type Box = { top: number; bottom: number; left?: number; right?: number };
function place(el: Element, b: Box) {
  el.getBoundingClientRect = () =>
    ({ top: b.top, bottom: b.bottom, left: b.left ?? 0, right: b.right ?? 360, width: (b.right ?? 360) - (b.left ?? 0), height: b.bottom - b.top, x: b.left ?? 0, y: b.top, toJSON: () => ({}) }) as DOMRect;
}
function scrollable(el: HTMLElement, box: Box, scrollHeight = 2000) {
  el.style.overflowY = 'auto';
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: scrollHeight });
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: box.bottom - box.top });
  place(el, box);
  el.scrollBy = vi.fn() as unknown as typeof el.scrollBy;
}
const vv = { height: 640, offsetTop: 0, scale: 1, listeners: {} as Record<string, ((e: Event) => void)[]> };
function setViewport(height: number, offsetTop = 0) {
  vv.height = height;
  vv.offsetTop = offsetTop;
}
function fireViewport(type: 'resize' | 'scroll') {
  for (const fn of vv.listeners[type] ?? []) fn(new Event(type));
}

beforeEach(() => {
  document.body.innerHTML = '';
  setViewport(640);
  vv.scale = 1;
  vv.listeners = {};
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 640 });
  Object.defineProperty(window, 'visualViewport', {
    configurable: true,
    value: {
      get height() { return vv.height; },
      get offsetTop() { return vv.offsetTop; },
      get scale() { return vv.scale; },
      addEventListener: (t: string, fn: (e: Event) => void) => { (vv.listeners[t] ??= []).push(fn); },
      removeEventListener: (t: string, fn: (e: Event) => void) => { vv.listeners[t] = (vv.listeners[t] ?? []).filter((f) => f !== fn); },
    },
  });
  document.elementFromPoint = () => null;
});
afterEach(() => {
  vi.useRealTimers();
  document.documentElement.style.removeProperty('--keyboard-inset');
});

describe('keyboardInset', () => {
  it('is how much of the window bottom the keyboard covers when the browser doesn’t shrink the page (iPhone)', () => {
    setViewport(340);
    expect(keyboardInset()).toBe(300);
    setViewport(340, 40); // the browser also scrolled the page up a little
    expect(keyboardInset()).toBe(260);
  });
  it('is 0 where the page itself shrinks (Chrome on Android) or nothing covers it', () => {
    expect(keyboardInset()).toBe(0);
  });
  it('is 0 while the page is pinch-zoomed (the viewport is smaller for that reason, not a keyboard)', () => {
    setViewport(320);
    vv.scale = 2;
    expect(keyboardInset()).toBe(0);
  });
});

describe('isTypingField', () => {
  it('is true for fields that bring up a keyboard, false for the rest', () => {
    document.body.innerHTML = `<input id="a"><input id="b" type="email"><textarea id="c"></textarea><div id="d" contenteditable="true"></div>
      <input id="e" type="checkbox"><input id="f" type="date"><button id="g"></button><input id="h" readonly><select id="i"></select>`;
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];
    expect(ids.map((id) => isTypingField(document.getElementById(id)))).toEqual([true, true, true, true, false, false, false, false, false]);
  });
});

describe('revealField', () => {
  function dialogForm() {
    document.body.innerHTML = `
      <div id="scroller">
        <form>
          <label for="title" id="label">Title</label>
          <input id="title" aria-describedby="hint">
          <p id="hint">Keep it short</p>
          <div id="row"><button type="submit">Save</button><button type="button">Cancel</button></div>
        </form>
      </div>`;
    const scroller = document.getElementById('scroller')!;
    scrollable(scroller, { top: 0, bottom: 640 });
    return scroller;
  }

  it('scrolls the field, its label and hint, and the form’s buttons above the keyboard', () => {
    const scroller = dialogForm();
    place(document.getElementById('label')!, { top: 380, bottom: 400 });
    place(document.getElementById('title')!, { top: 404, bottom: 444 });
    place(document.getElementById('hint')!, { top: 448, bottom: 464 });
    place(document.getElementById('row')!, { top: 480, bottom: 524 });
    setViewport(340); // the keyboard covers the bottom 300 px
    revealField(document.getElementById('title') as HTMLElement);
    // Label 380 … buttons 524, plus 16 px of room: the bottom (540) must reach 340.
    expect(scroller.scrollBy).toHaveBeenCalledWith(expect.objectContaining({ top: 200 }));
  });

  it('does not move anything when the field and its buttons are already in view', () => {
    const scroller = dialogForm();
    place(document.getElementById('label')!, { top: 80, bottom: 100 });
    place(document.getElementById('title')!, { top: 104, bottom: 144 });
    place(document.getElementById('hint')!, { top: 148, bottom: 164 });
    place(document.getElementById('row')!, { top: 180, bottom: 224 });
    setViewport(340);
    revealField(document.getElementById('title') as HTMLElement);
    expect(scroller.scrollBy).not.toHaveBeenCalled();
  });

  it('drops the label and hint when they would push the box itself out of a small visible area', () => {
    const scroller = dialogForm();
    place(document.getElementById('label')!, { top: 300, bottom: 320 });
    place(document.getElementById('title')!, { top: 380, bottom: 450 });
    place(document.getElementById('hint')!, { top: 460, bottom: 500 }); // label…hint: 200 px
    place(document.getElementById('row')!, { top: 900, bottom: 944 });
    scrollable(scroller, { top: 0, bottom: 640 });
    setViewport(130); // only 130 px visible: the box (70 px) fits, its label and hint don't
    revealField(document.getElementById('title') as HTMLElement);
    // Just the box with its 16 px of room: its bottom 450 + 16 must reach 130.
    expect(scroller.scrollBy).toHaveBeenCalledWith(expect.objectContaining({ top: 336 }));
  });

  it('treats a bar fixed to the bottom of the visible area as covering it', () => {
    const scroller = dialogForm();
    document.body.insertAdjacentHTML('beforeend', '<div id="bar" style="position: fixed"></div>');
    const bar = document.getElementById('bar')!;
    place(bar, { top: 280, bottom: 340 });
    document.elementFromPoint = (_x: number, y: number) => (y >= 280 && y <= 340 ? bar : null);
    place(document.getElementById('label')!, { top: 200, bottom: 220 });
    place(document.getElementById('title')!, { top: 224, bottom: 264 });
    place(document.getElementById('hint')!, { top: 268, bottom: 284 });
    place(document.getElementById('row')!, { top: 900, bottom: 944 }); // far below: can't come along
    setViewport(340);
    revealField(document.getElementById('title') as HTMLElement);
    // Visible area ends at the bar (280): the hint (284) + 16 px must clear it.
    expect(scroller.scrollBy).toHaveBeenCalledWith(expect.objectContaining({ top: 20 }));
  });

  it('leaves buttons that sit outside the scroll area (a fixed dialog footer) out of the sum', () => {
    document.body.innerHTML = `
      <form><div id="scroller"><input id="name"></div><footer id="foot"><button type="submit">Create</button></footer></form>`;
    const scroller = document.getElementById('scroller')!;
    scrollable(scroller, { top: 60, bottom: 280 });
    place(document.getElementById('name')!, { top: 300, bottom: 340 });
    place(document.getElementById('foot')!, { top: 280, bottom: 340 });
    setViewport(340);
    revealField(document.getElementById('name') as HTMLElement);
    // Only the field: its bottom 340 + 16 must reach the scroll area's bottom, 280.
    expect(scroller.scrollBy).toHaveBeenCalledWith(expect.objectContaining({ top: 76 }));
  });

  it('scrolls the page itself when no inner area scrolls', () => {
    document.body.innerHTML = '<form><input id="email"><button id="go" type="submit">Sign in</button></form>';
    place(document.getElementById('email')!, { top: 300, bottom: 340 });
    place(document.getElementById('go')!, { top: 360, bottom: 404 });
    const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
    Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: 1200 });
    Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: 640 });
    setViewport(340);
    revealField(document.getElementById('email') as HTMLElement);
    expect(scrollBy).toHaveBeenCalledWith(expect.objectContaining({ top: 80 }));
    scrollBy.mockRestore();
  });
});

describe('installKeyboardAwareness', () => {
  it('publishes the covered height as --keyboard-inset and clears it when the keyboard closes', () => {
    const stop = installKeyboardAwareness();
    setViewport(340);
    fireViewport('resize');
    expect(document.documentElement.style.getPropertyValue('--keyboard-inset')).toBe('300px');
    setViewport(640);
    fireViewport('resize');
    expect(document.documentElement.style.getPropertyValue('--keyboard-inset')).toBe('0px');
    stop();
  });

  it('publishes where the visible part starts as --visible-top when the browser slides the page up to show a field (iPhone)', () => {
    const stop = installKeyboardAwareness();
    setViewport(250, 220); // 250 px visible, starting 220 px down the page; the keyboard covers the last 170
    fireViewport('scroll');
    const style = document.documentElement.style;
    expect(style.getPropertyValue('--visible-top')).toBe('220px');
    expect(style.getPropertyValue('--keyboard-inset')).toBe('170px');
    vv.scale = 2; // pinch-zoomed instead: no keyboard to make room for
    fireViewport('resize');
    expect(style.getPropertyValue('--visible-top')).toBe('0px');
    expect(style.getPropertyValue('--keyboard-inset')).toBe('0px');
    stop();
  });

  it('marks <html> with data-keyboard="open" while a keyboard is open, for layouts that change then', () => {
    const stop = installKeyboardAwareness();
    expect(document.documentElement.dataset.keyboard).toBeUndefined();
    setViewport(340);
    fireViewport('resize');
    expect(document.documentElement.dataset.keyboard).toBe('open');
    setViewport(600); // the address bar coming back is not a keyboard
    fireViewport('resize');
    expect(document.documentElement.dataset.keyboard).toBeUndefined();
    stop();
  });

  it('marks it "cramped" when the keyboard leaves very little (a phone held sideways)', () => {
    const stop = installKeyboardAwareness();
    setViewport(140);
    fireViewport('resize');
    expect(document.documentElement.dataset.keyboard).toBe('cramped');
    setViewport(340); // turned back upright: just "open"
    fireViewport('resize');
    expect(document.documentElement.dataset.keyboard).toBe('open');
    setViewport(640);
    fireViewport('resize');
    expect(document.documentElement.dataset.keyboard).toBeUndefined();
    stop();
  });

  it('keeps the field it was typing in on screen when the keyboard closes', () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="scroller"><input id="f"></div>';
    const scroller = document.getElementById('scroller')!;
    scrollable(scroller, { top: 0, bottom: 640 });
    const field = document.getElementById('f') as HTMLInputElement;
    const stop = installKeyboardAwareness();
    field.focus();
    setViewport(340);
    fireViewport('resize');
    vi.advanceTimersByTime(400);
    (scroller.scrollBy as ReturnType<typeof vi.fn>).mockClear();
    // The layout changed back (the panel scrolls differently again): the field now sits below.
    place(field, { top: 700, bottom: 740 });
    setViewport(640);
    fireViewport('resize');
    vi.advanceTimersByTime(400);
    expect(scroller.scrollBy).toHaveBeenCalledWith(expect.objectContaining({ top: 116 }));
    stop();
  });

  it('brings the focused field into view once the keyboard has opened, and stops when uninstalled', () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="scroller"><input id="f"></div>';
    const scroller = document.getElementById('scroller')!;
    scrollable(scroller, { top: 0, bottom: 640 });
    const field = document.getElementById('f') as HTMLInputElement;
    place(field, { top: 500, bottom: 540 });
    const stop = installKeyboardAwareness();
    field.focus();
    setViewport(340);
    fireViewport('resize');
    vi.advanceTimersByTime(400);
    expect(scroller.scrollBy).toHaveBeenCalledWith(expect.objectContaining({ top: 216 }));

    stop();
    (scroller.scrollBy as ReturnType<typeof vi.fn>).mockClear();
    fireViewport('resize');
    vi.advanceTimersByTime(400);
    expect(scroller.scrollBy).not.toHaveBeenCalled();
  });

  it('lets the person scroll away while typing: scrolling the page doesn’t pull the field back', () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="scroller"><input id="f"></div>';
    const scroller = document.getElementById('scroller')!;
    scrollable(scroller, { top: 0, bottom: 640 });
    const field = document.getElementById('f') as HTMLInputElement;
    place(field, { top: 100, bottom: 140 });
    const stop = installKeyboardAwareness();
    field.focus();
    setViewport(340);
    fireViewport('resize');
    vi.advanceTimersByTime(2000);
    // Later they scroll up to read something (iPhone: the visible part moves); the field is out of view.
    place(field, { top: 500, bottom: 540 });
    setViewport(340, 40);
    fireViewport('scroll');
    vi.advanceTimersByTime(400);
    expect(scroller.scrollBy).not.toHaveBeenCalled();
    stop();
  });

  it('follows the browser’s own slide right after the keyboard opens (iPhone), so the field still ends up in view', () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="scroller"><input id="f"></div>';
    const scroller = document.getElementById('scroller')!;
    scrollable(scroller, { top: 0, bottom: 640 });
    const field = document.getElementById('f') as HTMLInputElement;
    place(field, { top: 100, bottom: 140 });
    const stop = installKeyboardAwareness();
    field.focus();
    setViewport(340);
    fireViewport('resize');
    vi.advanceTimersByTime(200);
    // The browser slides the visible part to show the field, a moment after the keyboard opened.
    place(field, { top: 500, bottom: 540 });
    setViewport(340, 40);
    fireViewport('scroll');
    vi.advanceTimersByTime(400);
    expect(scroller.scrollBy).toHaveBeenCalled();
    stop();
  });

  it('ignores the keyboard opening for something that isn’t a typing field', () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="scroller"><button id="b">Go</button></div>';
    const scroller = document.getElementById('scroller')!;
    scrollable(scroller, { top: 0, bottom: 640 });
    place(document.getElementById('b')!, { top: 500, bottom: 540 });
    const stop = installKeyboardAwareness();
    (document.getElementById('b') as HTMLButtonElement).focus();
    setViewport(340);
    fireViewport('resize');
    vi.advanceTimersByTime(400);
    expect(scroller.scrollBy).not.toHaveBeenCalled();
    stop();
  });
});
