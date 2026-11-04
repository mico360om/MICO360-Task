import { describe, it, expect, vi, afterEach } from 'vitest';
import { browserReporterWorld } from './error-reporting';

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
