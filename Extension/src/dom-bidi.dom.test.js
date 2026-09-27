// @vitest-environment jsdom
/**
 * Arabic (right-to-left) text in the extension: an element that shows user text takes its
 * direction from that text (dir="auto"), so "مشروع الإطلاق 99ece3" isn't reordered into
 * "99 مشروع الإطلاقece3" inside the left-to-right UI, and fields follow what the user types.
 */
import { describe, it, expect } from 'vitest';
import { el, mount, hasRtl } from '../app/dom.js';

describe('right-to-left text in the extension UI', () => {
  it('detects Arabic and Hebrew text', () => {
    expect(hasRtl('مشروع الإطلاق 99ece3')).toBe(true);
    expect(hasRtl('פרויקט')).toBe(true);
    expect(hasRtl('Release project 2')).toBe(false);
    expect(hasRtl('')).toBe(false);
  });

  it('gives elements showing Arabic text dir="auto" and leaves English alone', () => {
    expect(el('div', {}, 'مشروع الإطلاق 99ece3').getAttribute('dir')).toBe('auto');
    expect(el('span', {}, 'Offline retry 99ece3').hasAttribute('dir')).toBe(false);
    const title = el('h2', {});
    mount(title, 'متابعة العميل من الخادم');
    expect(title.getAttribute('dir')).toBe('auto');
  });

  it('keeps an explicit direction', () => {
    expect(el('div', { dir: 'ltr' }, 'مرحبا').getAttribute('dir')).toBe('ltr');
  });

  it('lets text fields follow the typed language, but not addresses and passwords', () => {
    expect(el('input', { type: 'text' }).getAttribute('dir')).toBe('auto');
    expect(el('input', {}).getAttribute('dir')).toBe('auto');
    expect(el('textarea', {}).getAttribute('dir')).toBe('auto');
    for (const type of ['url', 'email', 'password', 'number', 'date', 'checkbox']) {
      expect(el('input', { type }).hasAttribute('dir'), type).toBe(false);
    }
  });
});
