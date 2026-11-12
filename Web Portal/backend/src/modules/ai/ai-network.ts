import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Readable } from 'node:stream';
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
  upgradeToHttps(url);
  return url.href.replace(/[?#].*$/, '').replace(/\/+$/, '');
}

/**
 * Hosts that answer nothing on plain http. MICO360 Connect's AI platform: since 2.6.17 (21 Oct 2026)
 * port 5310 speaks only HTTPS, under the certificate for ai.mico360.com (its API guide, the header and §9).
 */
const HTTPS_ONLY_HOSTS = new Set(['ai.mico360.com']);
const MICO360_AI_HOST = 'ai.mico360.com';

/**
 * Is this provider MICO360 AI (MICO360 Connect's AI platform)? Its preset, or its address — a provider
 * added as "Other" at ai.mico360.com is the same platform, with the same rules.
 */
export function isMico360Provider(provider: { preset?: string | null; apiBaseUrl?: string | null }): boolean {
  if (provider.preset === 'mico360') return true;
  try {
    return new URL(provider.apiBaseUrl ?? '').hostname.replace(/\.$/, '').toLowerCase() === MICO360_AI_HOST;
  } catch {
    return false;
  }
}

/** Switch an http URL to https when its host speaks only HTTPS; true when it was switched. */
function upgradeToHttps(url: URL): boolean {
  if (url.protocol !== 'http:' || !HTTPS_ONLY_HOSTS.has(url.hostname.replace(/\.$/, '').toLowerCase())) return false;
  url.protocol = 'https:';
  return true;
}

/**
 * A saved address as it must be called: http to an HTTPS-only host (a MICO360 AI provider saved before
 * Connect 2.6.17) is read as https. Anything else — and anything that isn't an address — is unchanged.
 */
export function httpsOnlyAddress(address: string): string {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return address;
  }
  return upgradeToHttps(url) ? address.replace(/^\s*http:/i, 'https:') : address;
}

export type LookupAll = (hostname: string) => Promise<Array<{ address: string }>>;

const defaultLookup: LookupAll = (hostname) => dnsLookup(hostname, { all: true, verbatim: true });

type LookupCallback = (err: Error | null, address: string | Array<{ address: string; family: number }>, family?: number) => void;

/**
 * A fetch whose connection uses the address it checked. `fetch` would resolve the name again when
 * it connects, so a name that answers "public" to the check and "127.0.0.1" a moment later (DNS
 * rebinding) would still reach inside. Here the request goes through node:http(s) with a `lookup`
 * that refuses private answers, so the check and the connection share one DNS answer. Redirects
 * are never followed.
 */
export function pinnedFetch(opts: { allowPrivateHosts?: boolean; lookup?: LookupAll } = {}): typeof fetch {
  const { allowPrivateHosts = false, lookup = defaultLookup } = opts;
  const connectLookup = (hostname: string, options: { all?: boolean }, cb: LookupCallback) => {
    lookup(hostname).then(
      (answers) => {
        if (!answers.length) return cb(new Error(`No address for ${hostname}`), '');
        if (!allowPrivateHosts && answers.some((a) => isPrivateAddress(a.address))) {
          return cb(new ValidationError('The AI provider address is not allowed.'), '');
        }
        const all = answers.map((a) => ({ address: a.address, family: isIP(a.address) || 4 }));
        if (options?.all) cb(null, all);
        else cb(null, all[0]!.address, all[0]!.family);
      },
      (err: Error) => cb(err, ''),
    );
  };

  return (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const { request } = url.protocol === 'https:' ? await import('node:https') : await import('node:http');
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((value, key) => (headers[key] = value));
    // A Buffer (a document for MICO360 AI, up to 64 MB) is sent as it is, not copied twice more (review minor 9).
    const body =
      init.body == null
        ? undefined
        : typeof init.body === 'string'
          ? init.body
          : Buffer.isBuffer(init.body)
            ? init.body
            : Buffer.from(await new Response(init.body).arrayBuffer());
    if (body !== undefined) headers['content-length'] = String(Buffer.byteLength(body));

    // b15: an event stream (MICO360 AI's live text) is handed over as it arrives; anything else whole.
    const streaming = /text\/event-stream/i.test(headers['accept'] ?? '');
    return new Promise<Response>((resolve, reject) => {
      const req = request(url, { method: init.method ?? 'GET', headers, lookup: connectLookup as never, signal: init.signal ?? undefined }, (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          res.resume();
          return reject(new ValidationError('The AI provider tried to redirect the request, which is not allowed.'));
        }
        const responseHeaders = () => {
          const out = new Headers();
          for (const [k, v] of Object.entries(res.headers)) {
            if (v === undefined) continue;
            for (const one of Array.isArray(v) ? v : [v]) out.append(k, one);
          }
          return out;
        };
        if (streaming && status >= 200 && status < 300) {
          // An abort (the caller's stop, a time-out) destroys the request, which ends this body with an error.
          return resolve(new Response(Readable.toWeb(res) as ReadableStream<Uint8Array>, { status, statusText: res.statusMessage, headers: responseHeaders() }));
        }
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('error', reject);
        res.on('end', () => {
          const noBody = status === 204 || status === 304 || init.method === 'HEAD';
          resolve(new Response(noBody ? null : Buffer.concat(chunks), { status, statusText: res.statusMessage, headers: responseHeaders() }));
        });
      });
      req.on('error', reject);
      if (body !== undefined) req.write(body);
      req.end();
    });
  }) as typeof fetch;
}

/**
 * A fetch that also refuses hosts whose DNS answer is a private address (a public-looking name
 * pointing inside) and never follows redirects (a public URL redirecting to an internal one).
 * By default the request itself goes through pinnedFetch, so a DNS answer that changes after this
 * check still can't reach an internal address.
 */
export function createSafeFetch(opts: { allowPrivateHosts?: boolean; lookup?: LookupAll; fetchImpl?: typeof fetch } = {}): typeof fetch {
  const { allowPrivateHosts = false, lookup = defaultLookup } = opts;
  const fetchImpl = opts.fetchImpl ?? pinnedFetch({ allowPrivateHosts, lookup });
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
  /** The caller's own stop (MICO AI's Stop button): the call ends at once with AiCallStoppedError. */
  signal?: AbortSignal;
}

/** The caller stopped the AI call (not a provider problem, not a timeout). */
export class AiCallStoppedError extends Error {
  constructor() {
    super('Stopped.');
    this.name = 'AiCallStoppedError';
  }
}

/**
 * The provider did not answer in time. Said as before (a 400 in plain words); its own class so that
 * work running in the background (1.22) knows to try again later.
 */
export class AiTimeoutError extends ValidationError {
  /** MICO360 AI (b3, b10): the job the platform kept running, when it said which. */
  constructor(
    public readonly jobId: string | null = null,
    public readonly correlationId: string | null = null,
  ) {
    super('The AI provider did not respond in time. Try again later.');
  }
}

/** One provider HTTP call: host check, timeout, no redirects; network problems become readable errors. */
export async function providerFetch(url: string, init: RequestInit, opts: ProviderRequestOptions): Promise<Response> {
  validateProviderUrl(url, opts.allowPrivateHosts);
  if (opts.signal?.aborted) throw new AiCallStoppedError();
  const timeout = AbortSignal.timeout(opts.timeoutMs);
  try {
    return await opts.fetchImpl(url, { ...init, redirect: 'error', signal: opts.signal ? AbortSignal.any([timeout, opts.signal]) : timeout });
  } catch (err) {
    if (err instanceof ValidationError) throw err;
    if (opts.signal?.aborted) throw new AiCallStoppedError();
    const name = (err as { name?: string } | null)?.name;
    if (name === 'TimeoutError' || name === 'AbortError') throw new AiTimeoutError();
    throw new ValidationError('Could not reach the AI provider. Check the API URL and network.');
  }
}

/** Parse a provider's JSON body; a non-JSON answer (HTML error page, proxy page) is a readable error, not a 500. */
export async function readProviderJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch (err) {
    // The time allowed ran out while the answer was still coming (1.22: tried again in the background).
    const name = (err as { name?: string } | null)?.name;
    if (name === 'TimeoutError' || name === 'AbortError') throw new AiTimeoutError();
    throw new ValidationError('The AI provider returned an unreadable response.');
  }
}

/** A MICO360 AI id as the platform writes them (letters, digits and - _ : .), else null. */
export function micoId(value: unknown, max = 100): string | null {
  return typeof value === 'string' && value.length <= max && /^[A-Za-z0-9][A-Za-z0-9_:.-]*$/.test(value) ? value : null;
}

/**
 * A refusal's body, read once (bounded): the provider's explanation, if there is a readable one, and —
 * MICO360 AI — the job a 504 left running and the request's correlation id (its guide, §5, §8): the
 * native surface says `{ error, jobId, correlationId }`, the OpenAI one names the job in its message
 * ("… (job JOB-…, correlation id REQ-…)"). An empty body (a native 400 or 415) is no reason.
 */
export async function readRefusal(res: Response): Promise<{ detail: string | null; jobId: string | null; correlationId: string | null }> {
  let text = '';
  try {
    text = (await res.text()).slice(0, 4000);
  } catch {
    text = '';
  }
  let msg: unknown = text;
  let jobId: string | null = null;
  let correlationId = micoId(res.headers.get('x-mico-correlation-id'), 64);
  try {
    const j = JSON.parse(text) as { error?: unknown; message?: unknown; detail?: unknown; jobId?: unknown; correlationId?: unknown };
    const e = j.error;
    msg = (e && typeof e === 'object' ? (e as { message?: unknown }).message : e) ?? j.message ?? j.detail;
    jobId = micoId(j.jobId);
    correlationId = micoId(j.correlationId, 64) ?? correlationId;
  } catch {
    // not JSON: the text itself, if it isn't a web page
    if (/^\s*</.test(text)) msg = null;
  }
  // eslint-disable-next-line no-control-regex
  const detail = typeof msg === 'string' && msg.trim() ? msg.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 300) : null;
  if (!jobId && detail) jobId = micoId(/\(job ([A-Za-z0-9][A-Za-z0-9_:.-]{2,99})[,)]/.exec(detail)?.[1]);
  return { detail, jobId, correlationId };
}

/** The provider's explanation in an error body, if there is a readable one (bounded). */
export async function providerErrorDetail(res: Response): Promise<string | null> {
  return (await readRefusal(res)).detail;
}
