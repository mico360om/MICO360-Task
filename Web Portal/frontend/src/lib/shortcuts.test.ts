import { describe, it, expect } from 'vitest';
import {
  SHORTCUTS,
  ariaKeyshortcuts,
  detectPlatform,
  isTypingTarget,
  matchShortcut,
  shortcutLabel,
  withShortcut,
  type KeyLike,
} from './shortcuts';

const key = (k: Partial<KeyLike>): KeyLike => ({ key: '', code: '', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...k });
const ON = { typing: false, singleKeys: true };
const TYPING = { typing: true, singleKeys: true };

describe('matchShortcut: Ctrl (⌘ on a Mac) shortcuts', () => {
  it('saves, submits, searches and opens the list with Ctrl on Windows and Linux', () => {
    expect(matchShortcut(key({ key: 's', code: 'KeyS', ctrlKey: true }), 'other', ON)).toBe('save');
    expect(matchShortcut(key({ key: 'Enter', code: 'Enter', ctrlKey: true }), 'other', ON)).toBe('submit');
    expect(matchShortcut(key({ key: 'Enter', code: 'NumpadEnter', ctrlKey: true }), 'other', ON)).toBe('submit');
    expect(matchShortcut(key({ key: 'k', code: 'KeyK', ctrlKey: true }), 'other', ON)).toBe('search');
    expect(matchShortcut(key({ key: '/', code: 'Slash', ctrlKey: true }), 'other', ON)).toBe('help');
  });

  it('uses ⌘ on a Mac, where Ctrl does nothing', () => {
    expect(matchShortcut(key({ key: 's', code: 'KeyS', metaKey: true }), 'mac', ON)).toBe('save');
    expect(matchShortcut(key({ key: 's', code: 'KeyS', ctrlKey: true }), 'mac', ON)).toBeNull();
    expect(matchShortcut(key({ key: 's', code: 'KeyS', metaKey: true }), 'other', ON)).toBeNull();
  });

  it('works while typing in a field', () => {
    expect(matchShortcut(key({ key: 's', code: 'KeyS', ctrlKey: true }), 'other', TYPING)).toBe('save');
    expect(matchShortcut(key({ key: 'Enter', code: 'Enter', ctrlKey: true }), 'other', TYPING)).toBe('submit');
  });

  it('leaves other combinations to the browser and the keyboard', () => {
    // Ctrl+Shift+S, and AltGr (Ctrl+Alt) on European and Arabic keyboards, are not ours.
    expect(matchShortcut(key({ key: 'S', code: 'KeyS', ctrlKey: true, shiftKey: true }), 'other', ON)).toBeNull();
    expect(matchShortcut(key({ key: 's', code: 'KeyS', ctrlKey: true, altKey: true }), 'other', ON)).toBeNull();
    // Browser shortcuts stay the browser's: new window, reload, find, print.
    for (const code of ['KeyN', 'KeyR', 'KeyF', 'KeyP', 'KeyT', 'KeyW']) {
      expect(matchShortcut(key({ code, key: code.slice(3).toLowerCase(), ctrlKey: true }), 'other', ON)).toBeNull();
    }
  });

  it('follows the key’s place, not its letter, so it works with the Arabic layout', () => {
    expect(matchShortcut(key({ key: 'س', code: 'KeyS', ctrlKey: true }), 'other', ON)).toBe('save');
    expect(matchShortcut(key({ key: 'ى', code: 'KeyN' }), 'other', ON)).toBe('new');
  });
});

describe('matchShortcut: single keys', () => {
  it('adds, edits, deletes, refreshes and searches the page when not typing', () => {
    expect(matchShortcut(key({ key: 'n', code: 'KeyN' }), 'other', ON)).toBe('new');
    expect(matchShortcut(key({ key: 'e', code: 'KeyE' }), 'other', ON)).toBe('edit');
    expect(matchShortcut(key({ key: 'Delete', code: 'Delete' }), 'other', ON)).toBe('delete');
    expect(matchShortcut(key({ key: 'r', code: 'KeyR' }), 'other', ON)).toBe('refresh');
    expect(matchShortcut(key({ key: '/', code: 'Slash' }), 'other', ON)).toBe('find');
    expect(matchShortcut(key({ key: '?', code: 'Slash', shiftKey: true }), 'other', ON)).toBe('help');
    expect(matchShortcut(key({ key: 'N', code: 'KeyN', shiftKey: true }), 'mac', ON)).toBeNull();
  });

  it('does nothing while typing, when switched off, with a modifier, held down or mid-composition', () => {
    expect(matchShortcut(key({ key: 'n', code: 'KeyN' }), 'other', TYPING)).toBeNull();
    expect(matchShortcut(key({ key: 'n', code: 'KeyN' }), 'other', { typing: false, singleKeys: false })).toBeNull();
    expect(matchShortcut(key({ key: 'n', code: 'KeyN', altKey: true }), 'other', ON)).toBeNull();
    expect(matchShortcut(key({ key: 'n', code: 'KeyN', repeat: true }), 'other', ON)).toBeNull();
    expect(matchShortcut(key({ key: 'n', code: 'KeyN', isComposing: true }), 'other', ON)).toBeNull();
  });

  it('cancels with Escape, typing or not', () => {
    expect(matchShortcut(key({ key: 'Escape', code: 'Escape' }), 'other', TYPING)).toBe('cancel');
    expect(matchShortcut(key({ key: 'Escape', code: 'Escape' }), 'mac', { typing: false, singleKeys: false })).toBe('cancel');
  });
});

describe('isTypingTarget', () => {
  const el = (html: string) => {
    const box = document.createElement('div');
    box.innerHTML = html;
    return box.firstElementChild as HTMLElement;
  };

  it('is true in text fields, lists you type into and editable text', () => {
    expect(isTypingTarget(el('<input type="text">'))).toBe(true);
    expect(isTypingTarget(el('<input>'))).toBe(true);
    expect(isTypingTarget(el('<input type="search">'))).toBe(true);
    expect(isTypingTarget(el('<textarea></textarea>'))).toBe(true);
    expect(isTypingTarget(el('<select><option>a</option></select>'))).toBe(true);
    expect(isTypingTarget(el('<div contenteditable="true"></div>'))).toBe(true);
    expect(isTypingTarget(el('<div role="combobox"></div>'))).toBe(true);
  });

  it('is false on buttons, links, checkboxes and nothing', () => {
    expect(isTypingTarget(el('<button>Save</button>'))).toBe(false);
    expect(isTypingTarget(el('<a href="/x">x</a>'))).toBe(false);
    expect(isTypingTarget(el('<input type="checkbox">'))).toBe(false);
    expect(isTypingTarget(el('<input type="radio">'))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe('how shortcuts are shown', () => {
  it('names the keys as each keyboard has them', () => {
    expect(shortcutLabel('save', 'other')).toBe('Ctrl+S');
    expect(shortcutLabel('save', 'mac')).toBe('⌘S');
    expect(shortcutLabel('submit', 'other')).toBe('Ctrl+Enter');
    expect(shortcutLabel('submit', 'mac')).toBe('⌘↩');
    expect(shortcutLabel('help', 'other')).toBe('Ctrl+/');
    expect(shortcutLabel('new', 'other')).toBe('N');
    expect(shortcutLabel('delete', 'mac')).toBe('Delete');
    expect(shortcutLabel('cancel', 'other')).toBe('Esc');
  });

  it('adds the shortcut to a button’s tooltip', () => {
    expect(withShortcut('Save task', 'save', 'other')).toBe('Save task (Ctrl+S)');
    expect(withShortcut('New project', 'new', 'mac')).toBe('New project (N)');
  });

  it('tells screen readers the keys (aria-keyshortcuts)', () => {
    expect(ariaKeyshortcuts('save', 'other')).toBe('Control+S');
    expect(ariaKeyshortcuts('save', 'mac')).toBe('Meta+S');
    expect(ariaKeyshortcuts('submit', 'other')).toBe('Control+Enter');
    expect(ariaKeyshortcuts('new', 'other')).toBe('N');
    expect(ariaKeyshortcuts('delete', 'other')).toBe('Delete');
  });

  it('lists every action once, with what it does', () => {
    const actions = SHORTCUTS.map((s) => s.action);
    expect(new Set(actions).size).toBe(actions.length);
    expect(actions).toEqual(expect.arrayContaining(['save', 'submit', 'search', 'find', 'new', 'edit', 'delete', 'cancel', 'refresh', 'help']));
    expect(SHORTCUTS.every((s) => s.label && s.description)).toBe(true);
  });
});

describe('detectPlatform', () => {
  it('knows Apple devices', () => {
    expect(detectPlatform({ platform: 'MacIntel', userAgent: '' })).toBe('mac');
    expect(detectPlatform({ platform: '', userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)' })).toBe('mac');
    expect(detectPlatform({ platform: 'Win32', userAgent: 'Mozilla/5.0 (Windows NT 10.0)' })).toBe('other');
    expect(detectPlatform({ platform: 'Linux x86_64', userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' })).toBe('other');
  });
});
