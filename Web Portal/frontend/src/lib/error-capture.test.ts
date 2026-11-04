import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installErrorCapture, isLeaving, layoutShiftScore, requestReport, SLOW } from './error-capture';
import type { ErrorReport } from './error-reporter';

let reports: ErrorReport[];
let flushed: { hidden?: boolean }[];
let uninstall: () => void;

beforeEach(() => {
  reports = [];
  flushed = [];
  uninstall = installErrorCapture(window, { report: (r) => reports.push(r), flush: async (o) => void flushed.push(o ?? {}) }, { origin: window.location.origin });
});
afterEach(() => {
  uninstall();
  document.body.innerHTML = '';
});

function errorEvent(init: ErrorEventInit) {
  window.dispatchEvent(new ErrorEvent('error', { cancelable: true, ...init }));
}

describe('installErrorCapture: what the page reports by itself', () => {
  it('an uncaught error: its name, message and stack', () => {
    const err = new TypeError('x is undefined');
    errorEvent({ message: 'Uncaught TypeError: x is undefined', error: err, filename: `${window.location.origin}/assets/a-Ab12Cd34.js` });
    expect(reports).toEqual([{ kind: 'ERROR', detail: 'error', message: 'TypeError: x is undefined', stack: err.stack }]);
  });

  it('an error from a browser extension is left out', () => {
    errorEvent({ message: 'boom', filename: 'chrome-extension://abc/content.js' });
    expect(reports).toEqual([]);
  });

  it('an unhandled promise rejection; a failed load of the site’s code after a deploy is a “chunk” error', () => {
    const rejection = (reason: unknown) => {
      const e = new Event('unhandledrejection') as Event & { reason: unknown };
      e.reason = reason;
      window.dispatchEvent(e);
    };
    rejection(new Error('Task is gone'));
    rejection(new TypeError('Failed to fetch dynamically imported module: https://h/assets/BoardPage-B3x9kQ2a.js'));
    rejection('plain words');
    expect(reports.map((r) => [r.detail, r.message])).toEqual([
      ['rejection', 'Error: Task is gone'],
      ['chunk', 'TypeError: Failed to fetch dynamically imported module: https://h/assets/BoardPage-B3x9kQ2a.js'],
      ['rejection', 'plain words'],
    ]);
  });

  it('API refusals and lost connections are not page errors (the server and the network report cover them)', () => {
    const rejection = (reason: unknown) => {
      const e = new Event('unhandledrejection') as Event & { reason: unknown };
      e.reason = reason;
      window.dispatchEvent(e);
    };
    const api = Object.assign(new Error('Not found.'), { name: 'ApiError' });
    rejection(api);
    rejection(new TypeError('Failed to fetch'));
    rejection(new DOMException('The user aborted a request.', 'AbortError'));
    expect(reports).toEqual([]);
  });

  it('a site file that failed to load (an antivirus, a firewall, an ad blocker): blocked, with its path', () => {
    const script = document.createElement('script');
    script.src = `${window.location.origin}/assets/index-Ab12Cd34.js?v=1`;
    document.body.appendChild(script);
    script.dispatchEvent(new Event('error'));
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = `${window.location.origin}/assets/index-Qq11Ww22.css`;
    document.body.appendChild(css);
    css.dispatchEvent(new Event('error'));
    expect(reports).toEqual([
      { kind: 'BLOCKED', detail: 'resource', tag: 'script', resource: '/assets/index-Ab12Cd34.js' },
      { kind: 'BLOCKED', detail: 'resource', tag: 'link', resource: '/assets/index-Qq11Ww22.css' },
    ]);
  });

  it('another site’s file, an uploaded picture or an avatar that is gone is not a blocked site file', () => {
    for (const src of ['https://elsewhere.example/x.png', `${window.location.origin}/uploads/avatar.png`]) {
      const img = document.createElement('img');
      img.src = src;
      document.body.appendChild(img);
      img.dispatchEvent(new Event('error'));
    }
    expect(reports).toEqual([]);
  });

  it('what the security policy blocked (the page’s own event)', () => {
    const e = new Event('securitypolicyviolation') as Event & Record<string, unknown>;
    Object.assign(e, { blockedURI: 'https://evil.example/x.js?token=1', effectiveDirective: 'script-src-elem', violatedDirective: 'script-src-elem', sourceFile: '', disposition: 'enforce' });
    document.dispatchEvent(e);
    const ext = new Event('securitypolicyviolation') as Event & Record<string, unknown>;
    Object.assign(ext, { blockedURI: 'inline', effectiveDirective: 'script-src-elem', sourceFile: 'chrome-extension://abc/inject.js', disposition: 'enforce' });
    document.dispatchEvent(ext);
    expect(reports).toEqual([{ kind: 'BLOCKED', detail: 'csp', directive: 'script-src-elem', resource: 'https://evil.example/x.js?token=1' }]);
  });

  it('hiding the page sends what is waiting', () => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    window.dispatchEvent(new Event('pagehide'));
    expect(flushed).toEqual([{ hidden: true }, { hidden: true }]);
  });

  it('leaving the page: its failing requests are not reported — until a cancelled “Leave site?” brings the person back', () => {
    window.dispatchEvent(new Event('beforeunload'));
    expect(isLeaving()).toBe(true);
    window.dispatchEvent(new Event('focus'));
    expect(isLeaving()).toBe(false);
    window.dispatchEvent(new Event('beforeunload'));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    expect(isLeaving()).toBe(false);
  });

  it('a capture step that throws never reaches the page', () => {
    uninstall();
    uninstall = installErrorCapture(window, { report: () => { throw new Error('reporter broke'); }, flush: async () => {} }, { origin: window.location.origin });
    expect(() => errorEvent({ message: 'x', error: new Error('x') })).not.toThrow();
  });
});

describe('requestReport: the API client’s requests', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('a request that never reached the server while online: a network problem', () => {
    expect(requestReport({ method: 'GET', path: '/tasks/1', status: 0, ms: 300 }, { online: true, leaving: false })).toEqual({ kind: 'NETWORK', detail: 'api', resource: 'GET /api/v1/tasks/1' });
  });
  it('offline, or the page going away: nothing', () => {
    expect(requestReport({ method: 'GET', path: '/tasks/1', status: 0, ms: 300 }, { online: false, leaving: false })).toBeNull();
    expect(requestReport({ method: 'GET', path: '/tasks/1', status: 0, ms: 300 }, { online: true, leaving: true })).toBeNull();
  });
  it('a slow request (over 10 s) whatever its answer; an ordinary error is the server’s to log', () => {
    expect(requestReport({ method: 'POST', path: '/tasks', status: 201, ms: SLOW.apiMs + 1 }, { online: true, leaving: false })).toEqual({ kind: 'SLOW', detail: 'api', value: SLOW.apiMs + 1, resource: 'POST /api/v1/tasks' });
    expect(requestReport({ method: 'GET', path: '/tasks', status: 500, ms: 100 }, { online: true, leaving: false })).toBeNull();
    expect(requestReport({ method: 'GET', path: '/tasks', status: 200, ms: 100 }, { online: true, leaving: false })).toBeNull();
  });
  it('never about its own reports', () => {
    expect(requestReport({ method: 'POST', path: '/client-errors', status: 0, ms: 20_000 }, { online: true, leaving: false })).toBeNull();
  });
});

describe('layoutShiftScore: how much the layout jumped (the largest session of shifts)', () => {
  it('adds shifts less than a second apart, at most five seconds long; shifts right after input do not count', () => {
    expect(layoutShiftScore([])).toBe(0);
    expect(layoutShiftScore([{ startTime: 0, value: 0.1, hadRecentInput: false }, { startTime: 500, value: 0.2, hadRecentInput: false }])).toBeCloseTo(0.3);
    expect(layoutShiftScore([{ startTime: 0, value: 0.1, hadRecentInput: false }, { startTime: 2000, value: 0.2, hadRecentInput: false }])).toBeCloseTo(0.2);
    expect(layoutShiftScore([{ startTime: 0, value: 0.5, hadRecentInput: true }])).toBe(0);
    const steady = Array.from({ length: 12 }, (_, i) => ({ startTime: i * 900, value: 0.05, hadRecentInput: false }));
    expect(layoutShiftScore(steady)).toBeCloseTo(0.3); // 0–4.5 s is one session (6 shifts), then a new one
  });
});
