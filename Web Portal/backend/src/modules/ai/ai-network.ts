import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { ValidationError } from '../../lib/http-errors';

/**
 * Outbound-request safety for AI providers (AI-01). A provider base URL is admin-supplied, so
 * without checks it could point the server at internal services (databases, cloud metadata,
 * admin panels) and read the answers back. By default only public hosts are allowed; a local
 * model server (e.g. Ollama on localhost) needs AI_ALLOW_PRIVATE_HOSTS=true.
 */

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((n, part) => (n << 8) + Number(part), 0) >>> 0;
}

const PRIVATE_V4: Array<[string, number]> = [
  ['0.0.0.0', 8], // "this" network
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, incl. cloud metadata 169.254.169.254
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved + broadcast
];

function isPrivateV4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  return PRIVATE_V4.some(([base, bits]) => (n >>> (32 - bits)) === (ipv4ToInt(base) >>> (32 - bits)));
}

/** True for loopback, private, link-local, unique-local, multicast and other non-public addresses. */
export function isPrivateAddress(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, '').toLowerCase();
  const kind = isIP(ip);
  if (kind === 4) return isPrivateV4(ip);
  if (kind !== 6) return false;
  if (ip === '::' || ip === '::1') return true;
  const mapped = ip.match(/^(?:0*:)*:?ffff:(\d+\.\d+\.\d+\.\d+)$/) ?? ip.match(/^64:ff9b::(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateV4(mapped[1]!);
  if (/^::ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}$/.test(ip)) {
    const [hi, lo] = ip.slice('::ffff:'.length).split(':').map((h) => parseInt(h, 16));
    return isPrivateV4(`${hi! >> 8}.${hi! & 255}.${lo! >> 8}.${lo! & 255}`);
  }
  const first = parseInt(ip.split(':')[0] || '0', 16);
  return (
    (first & 0xfe00) === 0xfc00 || // fc00::/7 unique local
    (first & 0xffc0) === 0xfe80 || // fe80::/10 link-local
    (first & 0xff00) === 0xff00 || // ff00::/8 multicast
    ip.startsWith('2001:db8:') // documentation
  );
}

const INTERNAL_SUFFIXES = ['.localhost', '.local', '.internal', '.intranet', '.lan', '.home.arpa', '.corp'];

/** Hostnames that are internal by their form alone (no DNS needed). */
export function isPrivateHostname(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (isIP(host)) return isPrivateAddress(host);
  if (host === 'localhost' || INTERNAL_SUFFIXES.some((s) => host.endsWith(s))) return true;
  return !host.includes('.'); // single-label names resolve via the local network (e.g. "mysql", "redis")
}

/** Validate + normalise a provider base URL: http(s), no embedded credentials, public host unless allowed. */
export function validateProviderUrl(raw: string, allowPrivateHosts = false): string {
  let url: URL;
  try {
    url = new URL((raw ?? '').trim());
  } catch {
    throw new ValidationError('A valid API base URL is required.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new ValidationError('A valid API base URL is required.');
  if (url.username || url.password) throw new ValidationError('Put the API key in the key field, not in the URL.');
  if (!allowPrivateHosts && isPrivateHostname(url.hostname)) {
    throw new ValidationError('The API base URL must be a public address. Local or internal model servers need AI_ALLOW_PRIVATE_HOSTS=true.');
  }
  return url.href.replace(/[?#].*$/, '').replace(/\/+$/, '');
}

export type LookupAll = (hostname: string) => Promise<Array<{ address: string }>>;

const defaultLookup: LookupAll = (hostname) => dnsLookup(hostname, { all: true, verbatim: true });

/**
 * A fetch that also refuses hosts whose DNS answer is a private address (a public-looking name
 * pointing inside) and never follows redirects (a public URL redirecting to an internal one).
 */
export function createSafeFetch(opts: { allowPrivateHosts?: boolean; lookup?: LookupAll; fetchImpl?: typeof fetch } = {}): typeof fetch {
  const { allowPrivateHosts = false, lookup = defaultLookup, fetchImpl = fetch } = opts;
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (!allowPrivateHosts) {
      if (isPrivateHostname(url.hostname)) throw new ValidationError('The AI provider address is not allowed.');
      let addresses: Array<{ address: string }> = [];
      try {
        addresses = await lookup(url.hostname.replace(/^\[|\]$/g, ''));
      } catch {
        // Unresolvable: let the request itself fail with a normal "could not reach" error.
      }
      if (addresses.some((a) => isPrivateAddress(a.address))) throw new ValidationError('The AI provider address is not allowed.');
    }
    return fetchImpl(input, { ...init, redirect: 'error' });
  }) as typeof fetch;
}

export interface ProviderRequestOptions {
  fetchImpl: typeof fetch;
  timeoutMs: number;
  allowPrivateHosts?: boolean;
}

/** One provider HTTP call: host check, timeout, no redirects; network problems become readable errors. */
export async function providerFetch(url: string, init: RequestInit, opts: ProviderRequestOptions): Promise<Response> {
  validateProviderUrl(url, opts.allowPrivateHosts);
  try {
    return await opts.fetchImpl(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(opts.timeoutMs) });
  } catch (err) {
    if (err instanceof ValidationError) throw err;
    const name = (err as { name?: string } | null)?.name;
    if (name === 'TimeoutError' || name === 'AbortError') throw new ValidationError('The AI provider did not respond in time. Try again later.');
    throw new ValidationError('Could not reach the AI provider. Check the API URL and network.');
  }
}

/** Parse a provider's JSON body; a non-JSON answer (HTML error page, proxy page) is a readable error, not a 500. */
export async function readProviderJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    throw new ValidationError('The AI provider returned an unreadable response.');
  }
}
