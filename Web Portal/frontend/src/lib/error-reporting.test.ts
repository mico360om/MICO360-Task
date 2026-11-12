import { describe, it, expect, vi, afterEach } from 'vitest';
import { browserReporterWorld, mayRetryRequest, serverUptimeMs } from './error-reporting';
import { installErrorCapture } from './error-capture';

afterEach(() => vi.unstubAllGlobals());

describe('browserReporterWorld: how the page sends its reports', () => {
  it('POSTs the batch as text with keepalive and the signed-in person’s token; the server may say “off”', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(null, { status: 204, headers: { 'x-collect-browser-errors': 'off' } }));
    vi.stubGlobal('fetch', fetchMock);
    const world = browserReporterWorld({ baseUrl: '/api/v1', getToken: () => 'tok' });
    expect(await world.send('{"reports":[]}', false)).toEqual({ delivered: true, stop: true });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/v1/client-errors');
    expect(init).toMatchObject({ method: 'POST', keepalive: true, body: '{"reports":[]}' });
    expect(init!.headers).toEqual({ 'Content-Type': 'text/plain;charset=UTF-8', Authorization: 'Bearer tok' });
  });

  it('signed out: no token; fetch failing as the page goes: the beacon', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('no keepalive'); }));
    const beacon = vi.fn(() => true);
    Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true });
    const world = browserReporterWorld({ baseUrl: '/api/v1', getToken: () => null });
    expect(await world.send('{}', false)).toEqual({ delivered: false, stop: false });
    expect(beacon).not.toHaveBeenCalled();
    expect(await world.send('{}', true)).toEqual({ delivered: true, stop: false });
    expect(beacon).toHaveBeenCalledWith('/api/v1/client-errors', expect.any(Blob));
  });

  it('asks /config whether the site collects at all', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: { collectBrowserErrors: false } }))));
    expect(await browserReporterWorld({ baseUrl: '/api/v1', getToken: () => null }).collecting()).toBe(false);
  });
});

// 1.23.14: a request that never reached the server asks the server how long it has been up (an update restart?).
describe('serverUptimeMs: how long the server has been up, from /health', () => {
  it('its uptime in ms; null when it doesn’t answer, answers an error page, or says nonsense', async () => {
    const answer = vi.fn(async () => new Response(JSON.stringify({ data: { status: 'ok', uptimeSeconds: 42 } })));
    vi.stubGlobal('fetch', answer);
    expect(await serverUptimeMs('/api/v1')).toBe(42_000);
    expect(answer).toHaveBeenCalledWith('/api/v1/health', expect.objectContaining({ cache: 'no-store' }));
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>503</html>', { status: 503 })));
    expect(await serverUptimeMs('/api/v1')).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    expect(await serverUptimeMs('/api/v1')).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: { uptimeSeconds: -3 } }))));
    expect(await serverUptimeMs('/api/v1')).toBeNull();
  });
});

describe('serverUptimeMs: never waits for ever (1.23.14 review)', () => {
  it('gives up after 10 s', async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))));
      const answer = serverUptimeMs('/api/v1');
      await vi.advanceTimersByTimeAsync(10_001);
      expect(await answer).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

// 1.23.23 (review): the API client tries a dropped read again only on a page that is on screen, online and not
// being left (Firefox and Safari fail a page's requests as it navigates away, with the page still visible).
describe('mayRetryRequest: may a dropped read be tried again now?', () => {
  const setVisibility = (state: string) => Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  afterEach(() => {
    setVisibility('visible');
    vi.restoreAllMocks();
  });

  it('yes on a visible, online page; no while hidden, offline or being left', () => {
    const uninstall = installErrorCapture(window, { report: () => undefined, flush: async () => undefined }, { origin: window.location.origin });
    try {
      setVisibility('visible');
      expect(mayRetryRequest()).toBe(true);
      setVisibility('hidden');
      expect(mayRetryRequest()).toBe(false);
      setVisibility('visible');
      const offline = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
      expect(mayRetryRequest()).toBe(false);
      offline.mockRestore();
      window.dispatchEvent(new Event('beforeunload'));
      expect(mayRetryRequest()).toBe(false);
      window.dispatchEvent(new Event('focus')); // a cancelled "Leave site?" prompt: the page stays
      expect(mayRetryRequest()).toBe(true);
    } finally {
      uninstall();
    }
  });
});
