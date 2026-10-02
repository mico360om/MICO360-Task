import { describe, it, expect } from 'vitest';
import { createMemoryStore } from './storage';
import {
  SERVER_ADDRESS_KEY,
  isPrivateHost,
  parseServerAddress,
  serverLabel,
  loadServerOverride,
  saveServerOverride,
  probeServer,
  sitePageUrl,
} from './server-address';

describe('isPrivateHost', () => {
  it('recognises this device, the emulator host and private office networks', () => {
    for (const h of ['localhost', '127.0.0.1', '10.0.2.2', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.20', 'office-pc.local']) {
      expect(isPrivateHost(h), h).toBe(true);
    }
    for (const h of ['task.mico360.com', '8.8.8.8', '172.32.0.1', '192.169.0.1', '192.168.1.5.evil.com', '']) {
      expect(isPrivateHost(h), h).toBe(false);
    }
  });
});

describe('parseServerAddress', () => {
  it('accepts the site or its API address over https', () => {
    expect(parseServerAddress('https://tasks.example.com')).toEqual({ ok: true, apiBase: 'https://tasks.example.com/api/v1' });
    expect(parseServerAddress(' https://tasks.example.com/api/v1/ ')).toEqual({ ok: true, apiBase: 'https://tasks.example.com/api/v1' });
    expect(parseServerAddress('https://x.example.com/tasks?a=1#b')).toEqual({ ok: true, apiBase: 'https://x.example.com/tasks/api/v1' });
  });

  it('accepts plain http only for a private office-network server', () => {
    expect(parseServerAddress('http://192.168.1.20:4000')).toEqual({ ok: true, apiBase: 'http://192.168.1.20:4000/api/v1' });
    expect(parseServerAddress('http://10.0.2.2:4000/api/v1')).toEqual({ ok: true, apiBase: 'http://10.0.2.2:4000/api/v1' });
    const r = parseServerAddress('http://task.mico360.com');
    expect(r.ok).toBe(false);
  });

  it('fills in the scheme when it is left out', () => {
    expect(parseServerAddress('192.168.1.20:4000')).toEqual({ ok: true, apiBase: 'http://192.168.1.20:4000/api/v1' });
    expect(parseServerAddress('localhost:4000')).toEqual({ ok: true, apiBase: 'http://localhost:4000/api/v1' });
    expect(parseServerAddress('office-pc.local:4000/')).toEqual({ ok: true, apiBase: 'http://office-pc.local:4000/api/v1' });
    expect(parseServerAddress('tasks.example.com')).toEqual({ ok: true, apiBase: 'https://tasks.example.com/api/v1' });
  });

  it('rejects blanks, junk, other schemes and embedded credentials', () => {
    for (const bad of ['', '   ', 'not a url at all', 'ftp://x.com', 'https://user:pw@x.com', 'javascript:alert(1)']) {
      const r = parseServerAddress(bad);
      expect(r.ok, bad).toBe(false);
      if (!r.ok) expect(r.error).toBeTruthy();
    }
  });
});

describe('serverLabel', () => {
  it('shows the host (and port) people recognise', () => {
    expect(serverLabel('https://task.mico360.com/api/v1')).toBe('task.mico360.com');
    expect(serverLabel('http://192.168.1.20:4000/api/v1')).toBe('192.168.1.20:4000');
    expect(serverLabel('garbage')).toBe('garbage');
  });
});

describe('server override storage', () => {
  it('round-trips a valid address and clears it', async () => {
    const store = createMemoryStore();
    expect(await loadServerOverride(store)).toBeNull();
    await saveServerOverride(store, 'http://192.168.1.20:4000/api/v1');
    expect(await loadServerOverride(store)).toBe('http://192.168.1.20:4000/api/v1');
    await saveServerOverride(store, null);
    expect(await loadServerOverride(store)).toBeNull();
  });

  it('ignores a stored value that is no longer acceptable', async () => {
    const store = createMemoryStore({ [SERVER_ADDRESS_KEY]: 'http://evil.example.com/api/v1' });
    expect(await loadServerOverride(store)).toBeNull();
  });

  it('treats a storage failure as "no override"', async () => {
    const store = { ...createMemoryStore(), getItem: async () => { throw new Error('disk'); } };
    expect(await loadServerOverride(store)).toBeNull();
  });
});

describe('probeServer', () => {
  const json = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status });

  it('is true only for a healthy MICO360 Tasks server', async () => {
    expect(await probeServer('http://192.168.1.20:4000/api/v1', json(200, { data: { status: 'ok' } }))).toBe(true);
    expect(await probeServer('http://x/api/v1', json(503, { data: { status: 'ok' } }))).toBe(false);
    expect(await probeServer('http://x/api/v1', json(200, { hello: 'world' }))).toBe(false);
    expect(await probeServer('http://x/api/v1', async () => new Response('<html>', { status: 200 }))).toBe(false);
    expect(await probeServer('http://x/api/v1', async () => { throw new TypeError('Network request failed'); })).toBe(false);
  });

  it('calls the health endpoint of the given API base', async () => {
    const urls: string[] = [];
    await probeServer('https://tasks.example.com/api/v1', async (url) => {
      urls.push(String(url));
      return new Response(JSON.stringify({ data: { status: 'ok' } }));
    });
    expect(urls).toEqual(['https://tasks.example.com/api/v1/health']);
  });

  it('gives up after the timeout', async () => {
    const hang: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
    expect(await probeServer('http://x/api/v1', hang, 20)).toBe(false);
  });
});

describe('sitePageUrl', () => {
  it('points at a web-app page on the same server', () => {
    expect(sitePageUrl('https://task.mico360.com/api/v1', '/privacy')).toBe('https://task.mico360.com/privacy');
    expect(sitePageUrl('http://192.168.1.20:4000/api/v1/', 'terms')).toBe('http://192.168.1.20:4000/terms');
  });
});
