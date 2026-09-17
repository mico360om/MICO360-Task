import { describe, it, expect, beforeEach } from 'vitest';
import { getStoredTheme, setTheme, applyTheme } from './theme';

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

describe('theme', () => {
  it('defaults to system when nothing is stored', () => {
    expect(getStoredTheme()).toBe('system');
  });

  it('persists and applies an explicit choice', () => {
    setTheme('dark');
    expect(getStoredTheme()).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    setTheme('light');
    expect(getStoredTheme()).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('resolves system to a concrete data-theme and clears storage', () => {
    setTheme('dark');
    setTheme('system');
    expect(localStorage.getItem('mico360.theme')).toBeNull();
    expect(getStoredTheme()).toBe('system');
    // system still stamps a concrete theme so dark: utilities work
    expect(document.documentElement.getAttribute('data-theme')).toMatch(/^(light|dark)$/);
  });

  it('applyTheme always stamps light or dark', () => {
    applyTheme('system');
    expect(document.documentElement.getAttribute('data-theme')).toMatch(/^(light|dark)$/);
  });
});
