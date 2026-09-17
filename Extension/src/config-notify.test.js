import { describe, it, expect } from 'vitest';
import { resolveBases, DEFAULTS } from './config.js';
import { shouldNotify, notificationText } from './notify.js';

describe('resolveBases', () => {
  it('uses defaults when nothing is stored', () => {
    expect(resolveBases()).toEqual(DEFAULTS);
    expect(resolveBases({})).toEqual(DEFAULTS);
  });
  it('applies overrides and trims trailing slashes/whitespace', () => {
    expect(resolveBases({ apiBase: 'https://api.co/api/v1/ ', appBase: ' https://app.co/' })).toEqual({
      apiBase: 'https://api.co/api/v1',
      appBase: 'https://app.co',
    });
  });
  it('ignores blank values', () => {
    expect(resolveBases({ apiBase: '   ', appBase: '' })).toEqual(DEFAULTS);
  });
});

describe('shouldNotify', () => {
  it('notifies only when the unread count increases', () => {
    expect(shouldNotify(0, 2)).toBe(true);
    expect(shouldNotify(undefined, 1)).toBe(true);
    expect(shouldNotify(3, 3)).toBe(false);
    expect(shouldNotify(5, 2)).toBe(false);
  });
  it('formats singular/plural text', () => {
    expect(notificationText(1)).toMatch(/1 new notification$/);
    expect(notificationText(4)).toMatch(/4 new notifications$/);
  });
});
