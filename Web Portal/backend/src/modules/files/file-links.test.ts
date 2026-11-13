import { describe, it, expect } from 'vitest';
import { createHmac, hkdfSync } from 'node:crypto';
import { createFileLinks, FILE_LINK_BLOCK_HOURS, FILE_LINK_LIFE_HOURS, isSignedUploadUrl } from './file-links';

// 1.23.29 Private file links (design §7.1): a task or chat file's address is /uploads/<key>?u&e&s, signed
// for one person; the same link all through a 6-hour block, valid 24–30 hours.
const SECRET = 'file-links-test-secret';
const H = 3600_000;
const BLOCK_START = Date.UTC(2026, 10, 13, 6, 0, 0); // a 6-hour boundary (UTC)
const at = (ms: number) => createFileLinks({ secret: SECRET, now: () => ms });
const viewer = { id: 'cmuser0001aaaa', ver: 3 };
const KEY = '3f2b9c1e-8d4a-4b7e-9f10-2a6c5d7e8f90.jpg';

function parts(link: string) {
  const u = new URL(link, 'https://task.example');
  return { path: u.pathname, u: u.searchParams.get('u')!, e: u.searchParams.get('e')!, s: u.searchParams.get('s')!, query: Object.fromEntries(u.searchParams) };
}

describe('file links: the address', () => {
  it('is the same server-relative /uploads/ path with u, e and s added', () => {
    const link = at(BLOCK_START + H).sign(KEY, viewer);
    expect(link.startsWith(`/uploads/${KEY}?u=${viewer.id}&e=`)).toBe(true);
    const p = parts(link);
    expect(p.path).toBe(`/uploads/${KEY}`);
    expect(p.u).toBe(viewer.id);
  });

  it('uses only letters, digits, - and _ in what it adds (no dot, %, # or backslash: the extension and the app accept it)', () => {
    const link = at(BLOCK_START + 2 * H).sign(KEY, viewer);
    const query = link.slice(link.indexOf('?') + 1);
    expect(query).toMatch(/^u=[A-Za-z0-9_-]+&e=[A-Za-z0-9_-]+&s=[A-Za-z0-9_-]+$/);
    expect(link).not.toMatch(/\.\.|%|#|\\/);
  });

  it('carries at least 128 bits of signature', () => {
    expect(parts(at(BLOCK_START).sign(KEY, viewer)).s.length).toBeGreaterThanOrEqual(22);
  });

  it('expires 30 hours after the start of its 6-hour block (so it works 24–30 more hours), written in base 36 seconds', () => {
    expect(FILE_LINK_BLOCK_HOURS).toBe(6);
    expect(FILE_LINK_LIFE_HOURS).toBe(30);
    const e = parseInt(parts(at(BLOCK_START + 5.9 * H).sign(KEY, viewer)).e, 36);
    expect(e * 1000).toBe(BLOCK_START + 30 * H);
  });

  it('is the same all through one block, and new in the next', () => {
    const a = at(BLOCK_START).sign(KEY, viewer);
    const b = at(BLOCK_START + 6 * H - 1).sign(KEY, viewer);
    const c = at(BLOCK_START + 6 * H).sign(KEY, viewer);
    expect(b).toBe(a);
    expect(c).not.toBe(a);
  });

  it('differs for another person, another file and another session version', () => {
    const links = at(BLOCK_START);
    const base = links.sign(KEY, viewer);
    expect(links.sign(KEY, { id: 'cmuser0002bbbb', ver: 3 })).not.toBe(base);
    expect(links.sign('other.png', viewer)).not.toBe(base);
    expect(parts(links.sign(KEY, { ...viewer, ver: 4 })).s).not.toBe(parts(base).s);
  });

  it('is signed as the design says: HMAC-SHA256 under a key made for file links alone, over f1|key|u|e|version', () => {
    const link = at(BLOCK_START).sign(KEY, viewer);
    const p = parts(link);
    const k = Buffer.from(hkdfSync('sha256', SECRET, 'mico360-file-links', 'mico360/file-links/v1', 32));
    expect(p.s).toBe(createHmac('sha256', k).update(`f1|${KEY}|${viewer.id}|${p.e}|${viewer.ver}`).digest('base64url'));
  });

  it('signUrl signs a stored /uploads/<key> address and leaves anything else as it is', () => {
    const links = at(BLOCK_START);
    expect(links.signUrl(`/uploads/${KEY}`, viewer)).toBe(links.sign(KEY, viewer));
    expect(links.signUrl('https://elsewhere.example/x.png', viewer)).toBe('https://elsewhere.example/x.png');
    expect(links.signUrl('/uploads/faces/abc.webp', viewer)).toBe('/uploads/faces/abc.webp');
    expect(links.signUrl('', viewer)).toBe('');
  });

  it('isSignedUploadUrl tells a signed address from a plain one', () => {
    expect(isSignedUploadUrl(at(BLOCK_START).sign(KEY, viewer))).toBe(true);
    expect(isSignedUploadUrl(`/uploads/${KEY}`)).toBe(false);
  });
});

describe('file links: checking one', () => {
  const issued = BLOCK_START + 2 * H;
  const link = at(issued).sign(KEY, viewer);
  const q = parts(link).query;

  it('accepts its own link, for its key, person and version, while it lasts', () => {
    const links = at(issued + 20 * H);
    const parsed = links.parse(q)!;
    expect(parsed).toEqual({ u: viewer.id, e: q.e, s: q.s });
    expect(links.fresh(parsed)).toBe(true);
    expect(links.verify(KEY, parsed, viewer.ver)).toBe(true);
  });

  it('refuses it once expired (30 h after its block began)', () => {
    const parsed = at(0).parse(q)!;
    expect(at(BLOCK_START + 30 * H - 1000).fresh(parsed)).toBe(true);
    expect(at(BLOCK_START + 30 * H).fresh(parsed)).toBe(false);
  });

  it('refuses an expiry more than 31 hours ahead', () => {
    const links = at(issued);
    const far = { ...links.parse(q)!, e: Math.floor((issued + 31 * H + 60_000) / 1000).toString(36) };
    expect(links.fresh(far)).toBe(false);
    const near = { ...links.parse(q)!, e: Math.floor((issued + 31 * H - 60_000) / 1000).toString(36) };
    expect(links.fresh(near)).toBe(true);
  });

  it('refuses a changed key, person, expiry or signature, and an older or newer session version', () => {
    const links = at(issued);
    const parsed = links.parse(q)!;
    expect(links.verify('other.jpg', parsed, viewer.ver)).toBe(false);
    expect(links.verify(KEY, { ...parsed, u: 'cmuser0002bbbb' }, viewer.ver)).toBe(false);
    expect(links.verify(KEY, { ...parsed, e: (parseInt(parsed.e, 36) + 1).toString(36) }, viewer.ver)).toBe(false);
    expect(links.verify(KEY, { ...parsed, s: parsed.s.replace(/^./, (c) => (c === 'A' ? 'B' : 'A')) }, viewer.ver)).toBe(false);
    expect(links.verify(KEY, parsed, viewer.ver + 1)).toBe(false);
    expect(links.verify(KEY, parsed, viewer.ver - 1)).toBe(false);
  });

  it('refuses a link made with another secret, or with a key made for another purpose', () => {
    const other = createFileLinks({ secret: 'another-secret', now: () => issued });
    expect(other.verify(KEY, other.parse(q)!, viewer.ver)).toBe(false);
    // The backup links' key from the same secret (one-time-tokens.ts) never signs a file link.
    const backupKey = Buffer.from(hkdfSync('sha256', SECRET, 'mico360-one-time-tokens', 'mico360/backups/backup-download', 32));
    const forged = createHmac('sha256', backupKey).update(`f1|${KEY}|${viewer.id}|${q.e}|${viewer.ver}`).digest('base64url');
    expect(at(issued).verify(KEY, { u: viewer.id, e: q.e!, s: forged }, viewer.ver)).toBe(false);
  });

  it('parse refuses a missing, repeated or malformed part', () => {
    const links = at(issued);
    expect(links.parse({})).toBeNull();
    expect(links.parse({ u: q.u, e: q.e })).toBeNull();
    expect(links.parse({ u: q.u, s: q.s })).toBeNull();
    expect(links.parse({ e: q.e, s: q.s })).toBeNull();
    expect(links.parse({ ...q, u: [q.u, q.u] })).toBeNull();
    expect(links.parse({ ...q, s: [q.s, 'x'] })).toBeNull();
    expect(links.parse({ ...q, e: 'not-base36!' })).toBeNull();
    expect(links.parse({ ...q, e: `0${q.e}` })).toBeNull(); // one spelling per expiry
    expect(links.parse({ ...q, u: 'a.b' })).toBeNull();
    expect(links.parse({ ...q, u: 'x'.repeat(65) })).toBeNull();
    expect(links.parse({ ...q, s: 'short' })).toBeNull();
    expect(links.parse({ ...q, s: `${q.s}=` })).toBeNull();
  });

  it('a shorter test life (minutes) keeps the same shape: a block is a fifth of the life', () => {
    const t0 = BLOCK_START;
    const short = createFileLinks({ secret: SECRET, minutes: 10, now: () => t0 + 30_000 });
    const p = parts(short.sign(KEY, viewer));
    expect(parseInt(p.e, 36) * 1000).toBe(t0 + 10 * 60_000);
    expect(createFileLinks({ secret: SECRET, minutes: 10, now: () => t0 + 10 * 60_000 }).fresh(short.parse(p.query)!)).toBe(false);
  });
});
