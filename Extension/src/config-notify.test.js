import { describe, it, expect } from 'vitest';
import {
  resolveBases, DEFAULTS, checkBaseUrl, basesFromServer, runtimeOriginsFor, sameOrigin, originOf, safeTimeZone, isPrivateHost,
} from './config.js';
import { shouldNotify, notificationText, unreadBaseline, findAppContext } from './notify.js';

describe('DEFAULTS (EXT-01)', () => {
  it('points at production out of the box', () => {
    expect(DEFAULTS).toEqual({ apiBase: 'https://task.mico360.com/api/v1', appBase: 'https://task.mico360.com' });
  });
});

describe('resolveBases', () => {
  it('uses the production defaults when nothing is stored', () => {
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
  it('EXT-04: ignores an insecure stored value instead of sending tokens over http', () => {
    expect(resolveBases({ apiBase: 'http://tasks.example.com/api/v1' }).apiBase).toBe(DEFAULTS.apiBase);
    expect(resolveBases({ apiBase: 'javascript:alert(1)' }).apiBase).toBe(DEFAULTS.apiBase);
    expect(resolveBases({ apiBase: 'http://localhost:4000/api/v1' }).apiBase).toBe('http://localhost:4000/api/v1');
  });
});

describe('checkBaseUrl (EXT-04)', () => {
  it('accepts https and local http only', () => {
    expect(checkBaseUrl('https://task.mico360.com/api/v1/')).toEqual({ ok: true, url: 'https://task.mico360.com/api/v1' });
    expect(checkBaseUrl('http://localhost:4000/api/v1').ok).toBe(true);
    expect(checkBaseUrl('http://127.0.0.1:4000').ok).toBe(true);
    expect(checkBaseUrl('http://[::1]:4000').ok).toBe(true);
    for (const bad of ['http://task.mico360.com/api/v1', 'ftp://x.com', 'not a url', '', 'https://user:pw@x.com', 'http://localhost.evil.com', 'http://8.8.8.8:4000', 'http://172.32.0.1', 'http://192.168.1.5.evil.com']) {
      const r = checkBaseUrl(bad);
      expect(r.ok, bad).toBe(false);
      expect(r.error).toBeTruthy();
    }
  });
  it('also accepts http to a private office-network address (a self-hosted Windows server)', () => {
    for (const lan of ['http://192.168.1.20:4000', 'http://10.0.0.7:4000/api/v1', 'http://172.16.5.1', 'http://172.31.255.254:4000', 'http://office-pc.local:4000']) {
      expect(checkBaseUrl(lan).ok, lan).toBe(true);
    }
    expect(isPrivateHost('192.168.0.1')).toBe(true);
    expect(isPrivateHost('task.mico360.com')).toBe(false);
  });
  it('drops query strings and fragments', () => {
    expect(checkBaseUrl('https://x.com/api/v1?a=1#b').url).toBe('https://x.com/api/v1');
  });
});

describe('basesFromServer (login “Advanced”)', () => {
  it('accepts the site address or the API address', () => {
    expect(basesFromServer('https://tasks.example.com')).toEqual({ ok: true, apiBase: 'https://tasks.example.com/api/v1', appBase: 'https://tasks.example.com' });
    expect(basesFromServer('https://tasks.example.com/api/v1/')).toEqual({ ok: true, apiBase: 'https://tasks.example.com/api/v1', appBase: 'https://tasks.example.com' });
    expect(basesFromServer('http://evil.example.com').ok).toBe(false);
  });
});

describe('host helpers', () => {
  it('only non-production hosts need a runtime permission', () => {
    expect(runtimeOriginsFor(DEFAULTS.apiBase)).toEqual([]);
    expect(runtimeOriginsFor('https://staging.example.com/api/v1')).toEqual(['https://staging.example.com/*']);
    expect(runtimeOriginsFor('http://localhost:4000/api/v1')).toEqual(['http://localhost/*']);
    expect(runtimeOriginsFor('http://192.168.1.20:4000/api/v1')).toEqual(['http://192.168.1.20/*']);
  });
  it('compares hosts by origin', () => {
    expect(sameOrigin('https://a.com/api/v1', 'https://a.com/x')).toBe(true);
    expect(sameOrigin('https://a.com', 'https://b.com')).toBe(false);
    expect(sameOrigin('https://a.com', 'http://a.com')).toBe(false);
    expect(sameOrigin(null, null)).toBe(false);
    expect(originOf('nope')).toBeNull();
  });
  it('validates time zones', () => {
    expect(safeTimeZone('Europe/London')).toBe('Europe/London');
    expect(safeTimeZone('Not/AZone')).toBe('Asia/Muscat');
    expect(safeTimeZone(undefined)).toBe('Asia/Muscat');
  });
});

describe('shouldNotify', () => {
  it('notifies only when the unread count increases over a known baseline', () => {
    expect(shouldNotify(0, 2)).toBe(true);
    expect(shouldNotify(3, 3)).toBe(false);
    expect(shouldNotify(5, 2)).toBe(false);
  });
  it('EXT-06: with no baseline (first poll after sign-in) nothing is announced', () => {
    expect(shouldNotify(undefined, 1)).toBe(false);
    expect(shouldNotify(null, 12)).toBe(false);
  });
  it('EXT-06: another user’s count is not a baseline', () => {
    expect(unreadBaseline({ lastUnread: 3, lastUnreadUser: 'u1' }, 'u1')).toBe(3);
    expect(unreadBaseline({ lastUnread: 3, lastUnreadUser: 'u1' }, 'u2')).toBeUndefined();
    expect(unreadBaseline({ lastUnread: 3 }, 'u1')).toBeUndefined();
  });
  it('formats singular/plural text', () => {
    expect(notificationText(1)).toMatch(/1 new notification$/);
    expect(notificationText(4)).toMatch(/4 new notifications$/);
  });
});

describe('findAppContext (EXT-07: focus the app tab without the "tabs" permission)', () => {
  const APP = 'chrome-extension://abc/app/app.html';
  it('finds the app tab regardless of its route', () => {
    const contexts = [
      { contextType: 'TAB', documentUrl: 'chrome-extension://abc/other.html', tabId: 1, windowId: 1 },
      { contextType: 'TAB', documentUrl: `${APP}#/board/p1?date=2026-09-26`, tabId: 7, windowId: 2 },
    ];
    expect(findAppContext(contexts, APP)).toMatchObject({ tabId: 7, windowId: 2 });
  });
  it('returns null when no tab is open', () => {
    expect(findAppContext([], APP)).toBeNull();
    expect(findAppContext(undefined, APP)).toBeNull();
    expect(findAppContext([{ documentUrl: APP, tabId: -1 }], APP)).toBeNull();
  });
});
