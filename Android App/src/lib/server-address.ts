import type { KeyValueStore } from './storage';

/**
 * The server the app talks to. Each build has a default (task.mico360.com for production); a
 * different one — such as a self-hosted MICO360 Tasks server on the office network — can be
 * chosen on the sign-in screen and is remembered on the device.
 *
 * Only https is accepted, except plain http to a private office-network address (the self-hosted
 * Windows server has no certificate): passwords and tokens must never cross the internet in clear
 * text. Pure TypeScript, so it is unit-testable.
 */

export const SERVER_ADDRESS_KEY = 'mico360.serverAddress';

/** This device, the emulator's host (10.0.2.2), a private IPv4 range, or an mDNS `.local` name. */
export function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === 'localhost' || /^[a-z0-9-]+(\.[a-z0-9-]+)*\.local$/.test(h)) return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

export type ServerAddressCheck = { ok: true; apiBase: string } | { ok: false; error: string };

/**
 * Turn what the user typed (the site, its /api/v1 address, or just `host:port`) into an API base
 * URL. A missing scheme means http for a private address and https otherwise.
 */
export function parseServerAddress(input: string): ServerAddressCheck {
  let raw = input.trim();
  if (!raw) return { ok: false, error: 'Enter the server address.' };
  if (!raw.includes('://')) {
    const host = raw.split(/[/:?#]/)[0] ?? '';
    raw = `${isPrivateHost(host) ? 'http' : 'https'}://${raw}`;
  }
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, error: 'That is not a valid server address.' };
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { ok: false, error: 'The address must start with https://.' };
  if (!u.hostname || /\s/.test(input.trim())) return { ok: false, error: 'That is not a valid server address.' };
  if (u.username || u.password) return { ok: false, error: 'The address must not contain a user name or password.' };
  if (u.protocol === 'http:' && !isPrivateHost(u.hostname)) {
    return { ok: false, error: 'Use a secure https:// address. Plain http only works for a server on your office network.' };
  }
  const path = u.pathname.replace(/\/+$/, '');
  const apiBase = /\/api\/v\d+$/.test(path) ? `${u.origin}${path}` : `${u.origin}${path}/api/v1`;
  return { ok: true, apiBase };
}

/** Short label for an API base: host[:port]. */
export function serverLabel(apiBase: string): string {
  try {
    return new URL(apiBase).host;
  } catch {
    return apiBase;
  }
}

/** The remembered server, or null for the build default (also when the stored value is unusable). */
export async function loadServerOverride(store: KeyValueStore): Promise<string | null> {
  try {
    const stored = await store.getItem(SERVER_ADDRESS_KEY);
    if (!stored) return null;
    const check = parseServerAddress(stored);
    return check.ok ? check.apiBase : null;
  } catch {
    return null;
  }
}

/** Remember a server (an API base from parseServerAddress), or forget it with null. */
export async function saveServerOverride(store: KeyValueStore, apiBase: string | null): Promise<void> {
  if (apiBase) await store.setItem(SERVER_ADDRESS_KEY, apiBase);
  else await store.deleteItem(SERVER_ADDRESS_KEY);
}

/**
 * Whether a MICO360 Tasks server answers at this API base (GET /health → { data: { status: 'ok' } }).
 * Used before switching, so a typo can't strand the user on a dead address.
 */
export async function probeServer(
  apiBase: string,
  fetchImpl: typeof fetch = (...a) => fetch(...a),
  timeoutMs = 8000,
): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${apiBase}/health`, { signal: controller.signal });
    if (!res.ok) return false;
    const body = (await res.json()) as { data?: { status?: unknown } };
    return body?.data?.status === 'ok';
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
