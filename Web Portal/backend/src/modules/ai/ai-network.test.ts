import { describe, it, expect, vi } from 'vitest';
import { createSafeFetch, isPrivateAddress, isPrivateHostname, providerFetch, readProviderJson, validateProviderUrl } from './ai-network';
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
