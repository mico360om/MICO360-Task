import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { createSafeFetch, isPrivateAddress, isPrivateHostname, pinnedFetch, providerFetch, readProviderJson, validateProviderUrl } from './ai-network';
import { ValidationError } from '../../lib/http-errors';

describe('isPrivateAddress', () => {
  it('flags loopback, private, link-local, CGNAT, multicast and reserved IPv4', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });

  it('allows public IPv4', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '104.18.0.1']) expect(isPrivateAddress(ip), ip).toBe(false);
  });

  it('flags private IPv6, including IPv4-mapped forms', () => {
    for (const ip of ['::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '[::1]']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    expect(isPrivateAddress('2606:4700:4700::1111')).toBe(false);
  });
});

describe('isPrivateHostname', () => {
  it('treats localhost, internal suffixes and single-label names as internal', () => {
    for (const h of ['localhost', 'api.localhost', 'printer.local', 'db.internal', 'mysql', 'redis', '127.0.0.1', '[::1]']) {
      expect(isPrivateHostname(h), h).toBe(true);
    }
    for (const h of ['api.openai.com', 'api.anthropic.com', '8.8.8.8']) expect(isPrivateHostname(h), h).toBe(false);
  });
});

describe('validateProviderUrl', () => {
  it('normalises a public https URL', () => {
    expect(validateProviderUrl(' https://API.openai.com/v1/ ')).toBe('https://api.openai.com/v1');
  });

  it('rejects non-http schemes, garbage and private hosts', () => {
    for (const u of ['ftp://x.com', 'file:///etc/passwd', 'not a url', 'http://localhost:11434', 'http://2130706433/']) {
      expect(() => validateProviderUrl(u), u).toThrow(ValidationError);
    }
    expect(validateProviderUrl('http://localhost:11434', true)).toBe('http://localhost:11434');
  });
});

describe('createSafeFetch', () => {
  it('refuses a public name that resolves to a private address', async () => {
    const inner = vi.fn(async () => new Response('{}'));
    const safe = createSafeFetch({ lookup: async () => [{ address: '10.0.0.7' }], fetchImpl: inner as unknown as typeof fetch });
    await expect(safe('https://evil.example.com/v1/models')).rejects.toBeInstanceOf(ValidationError);
    expect(inner).not.toHaveBeenCalled();
  });

  it('passes public hosts through with redirects disabled', async () => {
    const inner = vi.fn(async (_url: string, _init?: RequestInit) => new Response('{}'));
    const safe = createSafeFetch({ lookup: async () => [{ address: '104.18.0.1' }], fetchImpl: inner as unknown as typeof fetch });
    await safe('https://api.openai.com/v1/models', { method: 'GET' });
    expect(inner.mock.calls[0]![1]).toMatchObject({ method: 'GET', redirect: 'error' });
  });

  it('allows private hosts when configured (local model server)', async () => {
    const inner = vi.fn(async () => new Response('{}'));
    const safe = createSafeFetch({ allowPrivateHosts: true, lookup: async () => [{ address: '127.0.0.1' }], fetchImpl: inner as unknown as typeof fetch });
    await safe('http://localhost:11434/api/tags');
    expect(inner).toHaveBeenCalledOnce();
  });
});

describe('providerFetch / readProviderJson', () => {
  it('turns a timeout into a readable error', async () => {
    const hang = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal!.reason)))) as unknown as typeof fetch;
    await expect(providerFetch('https://api.example.com/x', {}, { fetchImpl: hang, timeoutMs: 20 })).rejects.toThrow(/did not respond in time/);
  });

  it('turns a network failure into a readable error', async () => {
    const down = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    await expect(providerFetch('https://api.example.com/x', {}, { fetchImpl: down, timeoutMs: 1000 })).rejects.toThrow(/Could not reach/);
  });

  it('refuses a private request URL before calling fetch', async () => {
    const inner = vi.fn(async () => new Response('{}'));
    await expect(providerFetch('http://127.0.0.1/x', {}, { fetchImpl: inner as unknown as typeof fetch, timeoutMs: 1000 })).rejects.toBeInstanceOf(ValidationError);
    expect(inner).not.toHaveBeenCalled();
  });

  it('reports a non-JSON body as a readable error instead of a 500', async () => {
    await expect(readProviderJson(new Response('<html>502</html>'))).rejects.toBeInstanceOf(ValidationError);
    expect(await readProviderJson(new Response('{"a":1}'))).toEqual({ a: 1 });
  });
});

describe('pinnedFetch — the checked address is the one connected to (AI-01, DNS rebinding)', () => {
  let server: import('node:http').Server;
  let port = 0;
  const seen: { method?: string; auth?: string; body?: string }[] = [];

  beforeAll(async () => {
    const { createServer } = await import('node:http');
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        seen.push({ method: req.method, auth: req.headers.authorization, body });
        if (req.url === '/redirect') {
          res.writeHead(302, { location: 'http://127.0.0.1/admin' });
          return res.end();
        }
        res.writeHead(200, { 'content-type': 'application/json', 'x-provider': 'test' });
        res.end(JSON.stringify({ ok: true, echo: body }));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    port = (server.address() as import('node:net').AddressInfo).port;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it('refuses a name whose DNS answer turns private between the check and the connection', async () => {
    let calls = 0;
    // First answer public (passes the pre-check), then the attacker's DNS flips to loopback.
    const lookup = async () => (calls++ === 0 ? [{ address: '93.184.216.34' }] : [{ address: '127.0.0.1' }]);
    const safe = createSafeFetch({ lookup });
    await expect(safe(`http://rebind.example.com:${port}/v1/models`)).rejects.toThrow(/not allowed/i);
    expect(seen.length).toBe(0);
  });

  it('sends the request and returns a normal Response when the address is allowed', async () => {
    const pinned = pinnedFetch({ allowPrivateHosts: true, lookup: async () => [{ address: '127.0.0.1' }] });
    const res = await pinned(`http://model-host.example.com:${port}/v1/chat`, {
      method: 'POST',
      headers: { authorization: 'Bearer k', 'content-type': 'application/json' },
      body: JSON.stringify({ q: 'مرحبا' }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('x-provider')).toBe('test');
    expect(await res.json()).toEqual({ ok: true, echo: JSON.stringify({ q: 'مرحبا' }) });
    expect(seen.at(-1)).toMatchObject({ method: 'POST', auth: 'Bearer k' });
  });

  it('never follows redirects', async () => {
    const pinned = pinnedFetch({ allowPrivateHosts: true, lookup: async () => [{ address: '127.0.0.1' }] });
    await expect(pinned(`http://model-host.example.com:${port}/redirect`)).rejects.toThrow(/redirect/i);
  });

  it('honours an abort signal (timeouts)', async () => {
    const pinned = pinnedFetch({ allowPrivateHosts: true, lookup: () => new Promise(() => {}) });
    await expect(pinned('http://slow.example.com/', { signal: AbortSignal.timeout(30) })).rejects.toMatchObject({ name: expect.stringMatching(/Abort|Timeout/) });
  });
});
