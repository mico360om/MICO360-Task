import { describe, it, expect, beforeEach } from 'vitest';
import { clientViewApi } from './client-view';
import { clientSharesApi } from './client-shares';
import { ApiError, type ApiClient } from '../lib/api-client';

const LINK = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde';

function fakeFetch(respond: (url: string, init: RequestInit) => Response = () => new Response(JSON.stringify({ data: {} }), { status: 200 })) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return respond(url, init);
  }) as unknown as typeof fetch;
  return { fn, calls };
}
const headersOf = (init: RequestInit) => init.headers as Record<string, string>;

describe('the client page’s API (no staff account)', () => {
  beforeEach(() => {
    // A staff session in this browser must never be sent to the client routes.
    localStorage.setItem('mico360-auth', JSON.stringify({ accessToken: 'staff-token', refreshToken: 'r' }));
  });

  it('sends the link in a header, the session cookie (credentials), never an Authorization header', async () => {
    const f = fakeFetch(() => new Response(JSON.stringify({ data: { project: { name: 'Rig' } } }), { status: 200 }));
    const view = await clientViewApi(LINK, { baseUrl: '/api/v1', fetch: f.fn }).view();
    expect(view).toEqual({ project: { name: 'Rig' } });
    expect(f.calls[0]!.url).toBe('/api/v1/client/view');
    expect(f.calls[0]!.init.credentials).toBe('include');
    expect(headersOf(f.calls[0]!.init)['X-Client-Link']).toBe(LINK);
    expect(Object.keys(headersOf(f.calls[0]!.init)).map((k) => k.toLowerCase())).not.toContain('authorization');
    expect(JSON.stringify(f.calls[0]!.init)).not.toContain('staff-token');
    // The link never goes into an address.
    expect(f.calls[0]!.url).not.toContain(LINK);
  });

  it('asks for a code, and signs in with the address and the code', async () => {
    const f = fakeFetch(() => new Response(JSON.stringify({ data: { sent: true } }), { status: 202 }));
    const api = clientViewApi(LINK, { baseUrl: '/api/v1', fetch: f.fn });
    await api.requestCode('fatma@client.example');
    await api.verify('fatma@client.example', '123456');
    expect(f.calls.map((c) => [c.url, c.init.method, c.init.body])).toEqual([
      ['/api/v1/client/code', 'POST', JSON.stringify({ email: 'fatma@client.example' })],
      ['/api/v1/client/verify', 'POST', JSON.stringify({ email: 'fatma@client.example', code: '123456' })],
    ]);
    expect(headersOf(f.calls[0]!.init)['Content-Type']).toBe('application/json');
  });

  it('turns a refusal into an ApiError with the server’s code and words', async () => {
    const f = fakeFetch(() => new Response(JSON.stringify({ error: { code: 'CLIENT_LINK_ENDED', message: 'This link isn’t active any more.' } }), { status: 404 }));
    const err = await clientViewApi(LINK, { baseUrl: '/api/v1', fetch: f.fn }).view().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 404, code: 'CLIENT_LINK_ENDED', message: 'This link isn’t active any more.' });
  });

  it('downloads the minutes PDF under the name the server gives it', async () => {
    const f = fakeFetch(() => new Response(new Blob(['%PDF-1.7']), { status: 200, headers: { 'Content-Disposition': 'attachment; filename="minutes-kick-off.pdf"' } }));
    const { fileName, blob } = await clientViewApi(LINK, { baseUrl: '/api/v1', fetch: f.fn }).minutesPdf('m 1');
    expect(fileName).toBe('minutes-kick-off.pdf');
    expect(blob.size).toBeGreaterThan(0);
    expect(f.calls[0]!.url).toBe('/api/v1/client/minutes/m%201/pdf');
  });
});

describe('sharing with a client (staff API)', () => {
  function fakeClient() {
    const calls: { method: string; path: string; body?: unknown }[] = [];
    const answer = () => Promise.resolve({ data: { ok: true } });
    const client = {
      get: (path: string) => (calls.push({ method: 'GET', path }), answer()),
      post: (path: string, body?: unknown) => (calls.push({ method: 'POST', path, body }), answer()),
      put: (path: string, body?: unknown) => (calls.push({ method: 'PUT', path, body }), answer()),
      del: (path: string) => (calls.push({ method: 'DELETE', path }), answer()),
    } as unknown as ApiClient;
    return { client, calls };
  }

  it('lists, shares, resends and removes a project’s clients; marks tasks and minutes', async () => {
    const { client, calls } = fakeClient();
    const api = clientSharesApi(client);
    await api.list('p 1');
    await api.add('p1', { name: 'Fatma', email: 'f@x.example' });
    await api.resend('p1', 's1');
    await api.remove('p1', 's1');
    await api.setTaskVisible('t1', true);
    await api.minutesVisibility('m1');
    await api.setMinutesVisible('m1', false);
    expect(calls).toEqual([
      { method: 'GET', path: '/projects/p%201/client-shares' },
      { method: 'POST', path: '/projects/p1/client-shares', body: { name: 'Fatma', email: 'f@x.example' } },
      { method: 'POST', path: '/projects/p1/client-shares/s1/resend', body: {} },
      { method: 'DELETE', path: '/projects/p1/client-shares/s1' },
      { method: 'PUT', path: '/tasks/t1/client-visible', body: { visible: true } },
      { method: 'GET', path: '/meetings/m1/client-visibility' },
      { method: 'PUT', path: '/meetings/m1/client-visibility', body: { visible: false } },
    ]);
  });
});
