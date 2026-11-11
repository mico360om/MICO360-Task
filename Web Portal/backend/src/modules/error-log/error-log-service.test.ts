import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { addressKey, createErrorLogService, type ErrorLogService } from './error-log-service';
import { createMemoryErrorLogRepository } from './error-log-repository';
import { createMapStore } from './stack';
import { Prisma } from '@prisma/client';
import { fingerprintOf } from './error-log-rules';
import { normalizeMessage } from './error-redact';

const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const err = (over: Record<string, unknown> = {}) => ({ kind: 'ERROR', detail: 'error', message: 'TypeError: x is undefined', stack: 'TypeError: x is undefined\n    at q (https://task.mico360.com/assets/BoardPage-B3x9kQ2a.js:1:120)', page: '/board', version: '1.22.4', screen: '1440x900', ...over });
const batch = (...reports: unknown[]) => JSON.stringify({ reports });

let repo: ReturnType<typeof createMemoryErrorLogRepository>;
let clock: Date;
let collecting: boolean;
let warned: string[];
let service: ErrorLogService;
let serverVersion: string | null;
/** 1.23.14: whether the server is stopping or just started (an update restart), and which. */
let inUpdateWindow: boolean;
let updatePhase: 'stopping' | 'starting';

function make(opts: { webRoot?: string | null; perAddress?: number; serverPerMinute?: number; reportsPerAddress?: number; reportsPerMinute?: number; newRowsPerHour?: number } = {}) {
  service = createErrorLogService({
    repo,
    maps: createMapStore({ webRoot: opts.webRoot ?? null, now: () => clock.getTime() }),
    now: () => clock,
    timeZone: 'Asia/Muscat',
    serverVersion: () => serverVersion,
    collecting: async () => collecting,
    warn: (msg) => warned.push(msg),
    limits: {
      perAddressPerMinute: opts.perAddress ?? 60,
      serverPerMinute: opts.serverPerMinute ?? 120,
      reportsPerAddressPerMinute: opts.reportsPerAddress ?? 120,
      reportsPerMinute: opts.reportsPerMinute ?? 1000,
      newRowsPerHour: opts.newRowsPerHour ?? 300,
    },
    userNames: async (ids) => new Map(ids.filter((id) => id !== 'gone').map((id) => [id, `Name of ${id}`])),
    updateWindow: () => (inUpdateWindow ? updatePhase : null),
  });
}

beforeEach(() => {
  repo = createMemoryErrorLogRepository();
  clock = new Date('2026-11-05T08:00:00Z');
  collecting = true;
  warned = [];
  serverVersion = '1.22.4';
  inUpdateWindow = false;
  updatePhase = 'starting';
  make();
});

describe('browser reports', () => {
  it('a report becomes a row with its count, person, browser and screen', async () => {
    expect(service.acceptClientBatch({ body: batch(err({ count: 3 })), ip: '1.1.1.1', userAgent: CHROME, userId: 'u1' })).toBe(true);
    await service.settled();
    expect(repo.groups).toHaveLength(1);
    expect(repo.groups[0]).toMatchObject({ kind: 'ERROR', title: 'TypeError: x is undefined', count: 3, peopleCount: 1, lastVersion: '1.22.4', status: 'OPEN' });
    expect(repo.eventRows[0]).toMatchObject({ page: '/board', browser: 'Chrome 130', system: 'Windows', screen: '1440x900', userId: 'u1', signedIn: true, count: 3 });
  });

  it('the same error from two people is one row: count and people affected add up', async () => {
    service.acceptClientBatch({ body: batch(err()), ip: '1.1.1.1', userAgent: CHROME, userId: 'u1' });
    service.acceptClientBatch({ body: batch(err({ message: 'TypeError: x is undefined' })), ip: '2.2.2.2', userAgent: CHROME, userId: 'u2' });
    service.acceptClientBatch({ body: batch(err()), ip: '2.2.2.2', userAgent: CHROME, userId: null });
    await service.settled();
    expect(repo.groups).toHaveLength(1);
    expect(repo.groups[0]).toMatchObject({ count: 3, peopleCount: 2 });
    expect(repo.eventRows.filter((e) => !e.signedIn)).toHaveLength(1);
  });

  it('keeps the 20 newest occurrences of a row', async () => {
    for (let i = 0; i < 25; i++) {
      clock = new Date(clock.getTime() + 1000);
      service.acceptClientBatch({ body: batch(err()), ip: `9.9.9.${i}`, userAgent: CHROME, userId: null });
      await service.settled();
    }
    expect(repo.eventRows).toHaveLength(20);
    expect(repo.groups[0]!.count).toBe(25);
  });

  it('“Collect browser errors” off: nothing is kept', async () => {
    collecting = false;
    service.acceptClientBatch({ body: batch(err()), ip: '1.1.1.1', userAgent: CHROME, userId: 'u1' });
    service.acceptCspReports({ body: { 'csp-report': { 'document-uri': 'https://t/', 'blocked-uri': 'inline', 'effective-directive': 'script-src-elem' } }, ip: '1.1.1.1', userAgent: CHROME });
    await service.settled();
    expect(repo.groups).toEqual([]);
    expect(await service.collectingNow()).toBe(false);
  });

  it('60 batches a minute from one address; more are dropped quietly; the next minute counts again', async () => {
    make({ perAddress: 3 });
    const sent = [1, 2, 3, 4, 5].map(() => service.acceptClientBatch({ body: batch(err()), ip: '3.3.3.3', userAgent: CHROME, userId: null }));
    expect(sent).toEqual([true, true, true, false, false]);
    expect(service.acceptClientBatch({ body: batch(err()), ip: '4.4.4.4', userAgent: CHROME, userId: null })).toBe(true);
    clock = new Date(clock.getTime() + 61_000);
    expect(service.acceptClientBatch({ body: batch(err()), ip: '3.3.3.3', userAgent: CHROME, userId: null })).toBe(true);
    await service.settled();
    expect(repo.groups[0]!.count).toBe(5);
  });

  it('a stack is put back to the site’s own file:line through the hidden map, and grouped by it', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mico-el-svc-'));
    mkdirSync(join(root, 'assets'));
    // Column 0 of line 1 → src/pages/BoardPage.tsx line 42 (names[0] at the call).
    writeFileSync(join(root, 'assets', 'BoardPage-B3x9kQ2a.js.map'), JSON.stringify({ version: 3, sources: ['../../src/pages/BoardPage.tsx'], names: ['loadBoard'], mappings: 'AAyCAA' }));
    make({ webRoot: root });
    service.acceptClientBatch({ body: batch(err({ stack: 'TypeError: x\n    at q (https://task.mico360.com/assets/BoardPage-B3x9kQ2a.js:1:120)\n    at r (https://task.mico360.com/assets/BoardPage-B3x9kQ2a.js:1:5)' })), ip: '1.1.1.1', userAgent: CHROME, userId: 'u1' });
    await service.settled();
    expect(repo.groups[0]).toMatchObject({ topFile: 'src/pages/BoardPage.tsx', topLine: 42, topFunction: 'loadBoard' });
    expect(repo.eventRows[0]!.stack).toContain('at q (src/pages/BoardPage.tsx:42:1)');
    // The same error from a later build (a new hash, the same map content) is the same row — once the
    // folder is listed again (at most every 30 seconds when a name isn't there yet).
    clock = new Date(clock.getTime() + 31_000);
    serverVersion = '1.22.5'; // the later build is deployed
    writeFileSync(join(root, 'assets', 'BoardPage-Zz88Yy77.js.map'), JSON.stringify({ version: 3, sources: ['../../src/pages/BoardPage.tsx'], names: ['loadBoard'], mappings: 'AA2CAA' }));
    service.acceptClientBatch({ body: batch(err({ version: '1.22.5', stack: 'TypeError: x\n    at q (https://task.mico360.com/assets/BoardPage-Zz88Yy77.js:1:120)\n    at r (https://task.mico360.com/assets/BoardPage-Zz88Yy77.js:1:5)' })), ip: '1.1.1.1', userAgent: CHROME, userId: 'u1' });
    await service.settled();
    expect(repo.groups).toHaveLength(1);
    expect(repo.groups[0]).toMatchObject({ count: 2, topLine: 44, lastVersion: '1.22.5' });
  });

  it('a security-policy block the page saw and the browser reported counts once', async () => {
    service.acceptClientBatch({ body: batch({ kind: 'BLOCKED', detail: 'csp', directive: 'script-src-elem', resource: 'https://evil.example/x.js', page: '/board' }), ip: '5.5.5.5', userAgent: CHROME, userId: 'u1' });
    await service.settled();
    service.acceptCspReports({ body: { 'csp-report': { 'document-uri': 'https://task.mico360.com/board', 'blocked-uri': 'https://evil.example/x.js', 'effective-directive': 'script-src-elem' } }, ip: '5.5.5.5', userAgent: CHROME });
    await service.settled();
    expect(repo.groups).toHaveLength(1);
    expect(repo.groups[0]!.count).toBe(1);
    // Another visit later: counted again.
    clock = new Date(clock.getTime() + 10 * 60_000);
    service.acceptCspReports({ body: { 'csp-report': { 'document-uri': 'https://task.mico360.com/board', 'blocked-uri': 'https://evil.example/x.js', 'effective-directive': 'script-src-elem' } }, ip: '5.5.5.5', userAgent: CHROME });
    await service.settled();
    expect(repo.groups[0]!.count).toBe(2);
  });

  it('a store that fails is written as a warning, never thrown at the page', async () => {
    repo.record = async () => {
      throw new Error('database down');
    };
    expect(service.acceptClientBatch({ body: batch(err()), ip: '1.1.1.1', userAgent: CHROME, userId: null })).toBe(true);
    await service.settled();
    expect(warned.some((w) => w.includes('error log'))).toBe(true);
  });
});

describe('server errors', () => {
  it('a request failure: the route pattern, the person, the server’s file — and never the raw address', async () => {
    const e = new Error('Cannot read properties of undefined');
    service.recordServer('request failed', { method: 'GET', url: '/api/v1/backups/download?token=SECRET', route: '/api/v1/backups/download', status: 500, err: e, userId: 'u1' });
    await service.settled();
    expect(repo.groups[0]).toMatchObject({ kind: 'SERVER', title: 'Cannot read properties of undefined', lastVersion: '1.22.4' });
    expect(repo.eventRows[0]).toMatchObject({ page: 'GET /api/v1/backups/download', userId: 'u1', job: null });
    expect(JSON.stringify(repo.eventRows)).not.toContain('SECRET');
  });

  it('a background job’s failure carries the job’s name instead of a page, browser or person', async () => {
    service.recordServer('nightly backup sweep failed', { err: new Error('ENOSPC: no space left on device'), job: 'nightly-backup' });
    service.recordServer('task search: the index sweep failed', { err: new Error('Deadlock found'), sweep: 'search-index-heal-recent' });
    service.recordServer('chat participant cleanup failed', { err: 'plain text reason' });
    await service.settled();
    expect(repo.groups.map((g) => g.title).sort()).toEqual(['chat participant cleanup failed: plain text reason', 'nightly backup sweep failed: ENOSPC: no space left on device', 'task search: the index sweep failed: Deadlock found']);
    const byJob = Object.fromEntries(repo.eventRows.map((e) => [e.job ?? 'none', e]));
    expect(byJob['nightly-backup']).toMatchObject({ page: null, browser: null, userId: null });
    expect(byJob['search-index-heal-recent']).toBeDefined();
  });

  it('“Collect browser errors” off: server errors are still recorded', async () => {
    collecting = false;
    service.recordServer('meeting reminder sweep failed', { err: new Error('x'), job: 'meeting-reminders' });
    await service.settled();
    expect(repo.groups).toHaveLength(1);
  });

  it('never throws and never fails twice: a broken store is a warning; at most N a minute', async () => {
    make({ serverPerMinute: 2 });
    for (let i = 0; i < 5; i++) service.recordServer('x failed', { err: new Error(`boom ${i}`), job: 'j' });
    await service.settled();
    expect(repo.groups[0]!.count).toBe(2);
    repo.record = async () => {
      throw new Error('database down');
    };
    clock = new Date(clock.getTime() + 61_000);
    expect(() => service.recordServer('y failed', { err: new Error('z') })).not.toThrow();
    await service.settled();
    expect(warned.length).toBeGreaterThan(0);
    // A context that can't even be read doesn't throw either.
    const hostile = { get err() { throw new Error('getter'); } };
    expect(() => service.recordServer('z failed', hostile as never)).not.toThrow();
  });
});

describe('the page: list, details, mark as fixed, visits, retention', () => {
  async function seed() {
    service.acceptClientBatch({ body: batch(err()), ip: '1', userAgent: CHROME, userId: 'u1' });
    service.acceptClientBatch({ body: batch({ kind: 'SLOW', detail: 'load', value: 9000, page: '/board' }), ip: '2', userAgent: CHROME, userId: 'u2' });
    service.acceptClientBatch({ body: batch({ kind: 'NETWORK', detail: 'socket', page: '/chat' }), ip: '3', userAgent: CHROME, userId: 'gone' });
    service.recordServer('nightly backup sweep failed', { err: new Error('ENOSPC'), job: 'nightly-backup' });
    await service.settled();
  }

  it('lists by kind (Errors include Network), with chip counts and the most common page', async () => {
    await seed();
    const all = await service.list({ kind: 'all', range: '30d', q: null, status: 'open', before: null });
    expect(all.groups).toHaveLength(4);
    expect(all.counts).toEqual({ all: 4, errors: 2, blocked: 0, slow: 1, server: 1 });
    const errors = await service.list({ kind: 'errors', range: '30d', q: null, status: 'open', before: null });
    expect(errors.groups.map((g) => g.kind).sort()).toEqual(['ERROR', 'NETWORK']);
    const slow = (await service.list({ kind: 'slow', range: '30d', q: null, status: 'open', before: null })).groups[0]!;
    expect(slow).toMatchObject({ title: 'Slow page load', page: '/board', count: 1, people: 1 });
    const server = (await service.list({ kind: 'server', range: '30d', q: null, status: 'open', before: null })).groups[0]!;
    expect(server.page).toBe('nightly-backup');
  });

  it('search and dates', async () => {
    await seed();
    expect((await service.list({ kind: 'all', range: '30d', q: 'backup', status: 'open', before: null })).groups).toHaveLength(1);
    clock = new Date('2026-11-07T08:00:00Z');
    expect((await service.list({ kind: 'all', range: 'today', q: null, status: 'open', before: null })).groups).toHaveLength(0);
    expect((await service.list({ kind: 'all', range: '7d', q: null, status: 'open', before: null })).groups).toHaveLength(4);
  });

  it('details: the latest occurrences with each person’s name', async () => {
    await seed();
    const net = (await service.list({ kind: 'errors', range: '30d', q: null, status: 'open', before: null })).groups.find((g) => g.kind === 'NETWORK')!;
    const d = await service.detail(net.id);
    expect(d!.events[0]).toMatchObject({ page: '/chat', browser: 'Chrome 130', person: { id: 'gone', name: null } });
    const e = (await service.list({ kind: 'errors', range: '30d', q: null, status: 'open', before: null })).groups.find((g) => g.kind === 'ERROR')!;
    expect((await service.detail(e.id))!.events[0]!.person).toEqual({ id: 'u1', name: 'Name of u1' });
    expect(await service.detail('nope')).toBeNull();
  });

  it('mark as fixed hides the row until it happens again in a newer version', async () => {
    await seed();
    const e = (await service.list({ kind: 'errors', range: '30d', q: null, status: 'open', before: null })).groups.find((g) => g.kind === 'ERROR')!;
    const fixed = await service.markFixed(e.id, 'admin1');
    expect(fixed).toMatchObject({ status: 'FIXED', fixedInVersion: '1.22.4' });
    const open = async () => (await service.list({ kind: 'errors', range: '30d', q: null, status: 'open', before: null })).groups.map((g) => g.id);
    expect(await open()).not.toContain(e.id);
    expect((await service.list({ kind: 'errors', range: '30d', q: null, status: 'fixed', before: null })).groups.map((g) => g.id)).toContain(e.id);
    // A tab still on 1.22.4: still hidden.
    service.acceptClientBatch({ body: batch(err()), ip: '7', userAgent: CHROME, userId: 'u1' });
    await service.settled();
    expect(await open()).not.toContain(e.id);
    // 1.22.5 deployed: back.
    serverVersion = '1.22.5';
    clock = new Date(clock.getTime() + 60_000);
    service.acceptClientBatch({ body: batch(err({ version: '1.22.5' })), ip: '7', userAgent: CHROME, userId: 'u1' });
    await service.settled();
    expect(await open()).toContain(e.id);
    expect((await service.detail(e.id))!.group.reopenedAt).toEqual(clock);
    // Not fixed (undo).
    await service.markFixed(e.id, 'admin1');
    expect(await service.reopen(e.id)).toMatchObject({ status: 'OPEN', fixedAt: null });
    expect(await service.markFixed('nope', 'admin1')).toBeNull();
  });

  it('visit: the previous visit is returned, and now is kept', async () => {
    expect(await service.visit('admin1')).toBeNull();
    clock = new Date('2026-11-06T00:00:00Z');
    expect(await service.visit('admin1')).toEqual(new Date('2026-11-05T08:00:00Z'));
  });

  it('the daily sweep keeps 30 days', async () => {
    await seed();
    clock = new Date('2026-12-06T08:00:01Z');
    expect(await service.sweep()).toEqual({ groups: 4, events: 4 });
    expect(repo.groups).toEqual([]);
  });

  it('pages through rows with a cursor', async () => {
    await seed();
    const first = await service.list({ kind: 'all', range: '30d', q: null, status: 'open', before: null, limit: 2 });
    expect(first.groups).toHaveLength(2);
    expect(first.next).not.toBeNull();
    const second = await service.list({ kind: 'all', range: '30d', q: null, status: 'open', before: first.next, limit: 2 });
    expect(second.groups).toHaveLength(2);
    expect(new Set([...first.groups, ...second.groups].map((g) => g.id)).size).toBe(4);
  });
});

// Review (1.22.4): what anyone may send is counted by the report, a whole IPv6 /64 is one address,
// and the log can't be buried in new rows.
describe('limits on what anyone may send', () => {
  it('reports, not requests, are counted per address; a server-wide cap too', async () => {
    make({ reportsPerAddress: 25 });
    const twenty = Array.from({ length: 20 }, (_, i) => err({ message: `E${'abcdefghijklmnopqrst'[i]}` }));
    service.acceptClientBatch({ body: batch(...twenty), ip: '1.1.1.1', userAgent: CHROME, userId: null });
    service.acceptClientBatch({ body: batch(...twenty), ip: '1.1.1.1', userAgent: CHROME, userId: null });
    await service.settled();
    expect(repo.eventRows).toHaveLength(25);
    make({ reportsPerMinute: 30 });
    repo.eventRows.length = 0;
    repo.groups.length = 0;
    for (const ip of ['2.2.2.1', '2.2.2.2']) service.acceptClientBatch({ body: batch(...twenty), ip, userAgent: CHROME, userId: null });
    await service.settled();
    expect(repo.eventRows).toHaveLength(30);
  });

  it('an IPv6 /64 is one address; IPv4 (also mapped) as it is', () => {
    expect(addressKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd')).toBe(addressKey('2001:db8:1:2::1'));
    expect(addressKey('2001:db8:1:2::1')).not.toBe(addressKey('2001:db8:1:3::1'));
    expect(addressKey('::ffff:10.0.0.7')).toBe('10.0.0.7');
    expect(addressKey('10.0.0.7')).toBe('10.0.0.7');
    expect(addressKey('')).toBe('unknown');
  });

  it('after 300 new rows in an hour, only rows already there are added to', async () => {
    make({ newRowsPerHour: 3 });
    const fresh = (i: number) => err({ message: `New error ${'abcdefghij'[i]}` });
    for (let i = 0; i < 6; i++) service.acceptClientBatch({ body: batch(fresh(i)), ip: `3.3.3.${i}`, userAgent: CHROME, userId: null });
    await service.settled();
    expect(repo.groups).toHaveLength(3);
    service.acceptClientBatch({ body: batch(fresh(0)), ip: '3.3.3.9', userAgent: CHROME, userId: null });
    await service.settled();
    expect(repo.groups[0]!.count).toBe(2);
    clock = new Date(clock.getTime() + 61 * 60_000);
    service.acceptClientBatch({ body: batch(fresh(7)), ip: '3.3.3.10', userAgent: CHROME, userId: null });
    await service.settled();
    expect(repo.groups).toHaveLength(4);
  });
});

describe('versions', () => {
  it('a report without a version (the browser’s own) takes the server’s; one newer than the server’s is not believed', async () => {
    service.acceptCspReports({ body: { 'csp-report': { 'document-uri': 'https://t/', 'blocked-uri': 'eval', 'effective-directive': 'script-src' } }, ip: '1', userAgent: CHROME });
    service.acceptClientBatch({ body: batch(err({ version: '99.0.0' })), ip: '2', userAgent: CHROME, userId: null });
    service.acceptClientBatch({ body: batch(err({ message: 'older tab', version: '1.22.3' })), ip: '3', userAgent: CHROME, userId: null });
    await service.settled();
    expect(repo.eventRows.map((e) => e.version)).toEqual(['1.22.4', '1.22.4', '1.22.3']);
  });

  it('a server that doesn’t know its version yet keeps none (never a word such as “unknown”); fixed without one comes back', async () => {
    serverVersion = 'unknown';
    service.recordServer('x failed', { err: new Error('boom'), job: 'j' });
    await service.settled();
    expect(repo.groups[0]!.lastVersion).toBeNull();
    const fixed = await service.markFixed(repo.groups[0]!.id, 'admin1');
    expect(fixed!.fixedInVersion).toBeNull();
    serverVersion = '1.22.4';
    clock = new Date(clock.getTime() + 60_000);
    service.recordServer('x failed', { err: new Error('boom'), job: 'j' });
    await service.settled();
    expect(repo.groups[0]).toMatchObject({ lastVersion: '1.22.4', status: 'OPEN' });
  });
});

describe('a security-policy block: the page’s copy is the useful one', () => {
  it('the browser’s report first, the page’s later: the row still gets the person and version, counted once', async () => {
    service.acceptCspReports({ body: { 'csp-report': { 'document-uri': 'https://task.mico360.com/board', 'blocked-uri': 'https://evil.example/x.js', 'effective-directive': 'script-src-elem' } }, ip: '5.5.5.5', userAgent: CHROME });
    await service.settled();
    service.acceptClientBatch({ body: batch({ kind: 'BLOCKED', detail: 'csp', directive: 'script-src-elem', resource: 'https://evil.example/x.js', page: '/board', version: '1.22.3' }), ip: '5.5.5.5', userAgent: CHROME, userId: 'u1' });
    await service.settled();
    expect(repo.groups).toHaveLength(1);
    expect(repo.groups[0]).toMatchObject({ count: 1, peopleCount: 1 });
    expect(repo.eventRows.find((e) => e.detail === 'csp')).toMatchObject({ userId: 'u1', count: 0, version: '1.22.3' });
  });
});

describe('server errors keep no typed text', () => {
  it('only the first line of the message, and only the frames of the stack', async () => {
    const e = new Error('\nInvalid `prisma.task.create()` invocation:\n\n{\n  data: {\n    title: "Pay Ahmed 500 OMR for the villa"\n  }\n}\n\nUnknown argument `titl`.');
    e.stack = `Error: ${e.message}\n    at Object.create (/srv/app/dist/src/modules/tasks/task-repository.js:10:5)`;
    service.recordServer('request failed', { method: 'POST', route: '/api/v1/tasks', err: e });
    await service.settled();
    expect(repo.groups[0]!.title).toBe('Invalid `prisma.task.create()` invocation:');
    expect(JSON.stringify(repo.eventRows)).not.toContain('Ahmed');
    expect(repo.eventRows[0]!.stack).toBe('    at Object.create (src/modules/tasks/task-repository.js:10:5)');
  });

  it('a request failure without a route (no route matched) is still a request, never its address', async () => {
    service.recordServer('request failed', { method: 'GET', url: '/api/v1/nope?token=SECRET', err: new Error('boom') });
    await service.settled();
    expect(repo.eventRows[0]).toMatchObject({ detail: 'request', page: 'GET (no route)' });
    expect(repo.groups[0]!.title).toBe('boom');
    expect(JSON.stringify(repo.eventRows)).not.toContain('SECRET');
  });
});

describe('long values fit their columns', () => {
  it('page, resource, top file and function are cut to their column sizes', async () => {
    service.acceptClientBatch({ body: batch({ kind: 'SLOW', detail: 'api', value: 12000, page: `/${'p'.repeat(900)}`, resource: `GET /api/v1/${'r'.repeat(900)}` }), ip: '1', userAgent: CHROME, userId: null });
    await service.settled();
    expect(repo.eventRows[0]!.page!.length).toBeLessThanOrEqual(300);
    expect(repo.eventRows[0]!.resource!.length).toBeLessThanOrEqual(300);
    expect(repo.groups[0]!.title.length).toBeLessThanOrEqual(500);
  });
});

// 1.22.5: a database error names its cause — Prisma's code, the database's code and its message with
// the values masked — and two different database errors at one line are two rows.
describe('server errors from the database keep their diagnosis', () => {
  const rawFailed = (code: string, message: string) =>
    new Prisma.PrismaClientKnownRequestError(`\nInvalid \`prisma.$queryRaw()\` invocation:\n\n\nRaw query failed. Code: \`${code}\`. Message: \`${message}\``, { code: 'P2010', clientVersion: '5.22.0', meta: { code, message } });
  const at = (e: Error) => {
    e.stack = `PrismaClientKnownRequestError: ${e.message}\n    at Object.search (/srv/app/dist/src/modules/search/task-search-engine.js:85:29)`;
    return e;
  };

  it('a P2010 keeps its code and the database’s masked message, never the typed value', async () => {
    const e = at(rawFailed('1366', "Incorrect string value: '\xF0\x9F Pay Ahmed 500 OMR' for column 'doc' at row 1"));
    service.recordServer('request failed', { method: 'GET', route: '/api/v1/search', status: 500, err: e, userId: 'u1' });
    await service.settled();
    expect(repo.groups[0]!.title).toBe('Invalid `prisma.$queryRaw()` invocation:');
    expect(repo.eventRows[0]!.resource).toBe("P2010 · code 1366 · Incorrect string value: '?' for column 'doc' at row 1");
    expect(JSON.stringify(repo.eventRows)).not.toContain('Ahmed');
    expect(JSON.stringify(repo.groups)).not.toContain('Ahmed');
    const shown = await service.detail(repo.groups[0]!.id);
    expect(shown!.events[0]).toMatchObject({ database: "P2010 · code 1366 · Incorrect string value: '?' for column 'doc' at row 1", resource: null });
  });

  it('different database errors at the same line are different rows; the same one again adds up', async () => {
    for (const [code, message] of [['1038', 'Out of sort memory, consider increasing server sort buffer size'], ['1210', 'Incorrect arguments to ESCAPE'], ['1038', 'Out of sort memory, consider increasing server sort buffer size']] as const) {
      service.recordServer('request failed', { method: 'GET', route: '/api/v1/search', status: 500, err: at(rawFailed(code, message)), userId: 'u1' });
    }
    await service.settled();
    expect(repo.groups).toHaveLength(2);
    expect(repo.groups.map((g) => g.count).sort()).toEqual([1, 2]);
  });

  it('an error that isn’t Prisma’s is kept exactly as before (no diagnosis, the same row)', async () => {
    const e = new Error('Raw query failed. Code: `1064`. Message: `near Pay Ahmed`');
    e.stack = `Error: ${e.message}\n    at Object.search (/srv/app/dist/src/modules/search/task-search-engine.js:85:29)`;
    service.recordServer('request failed', { method: 'GET', route: '/api/v1/search', status: 500, err: e, userId: 'u1' });
    await service.settled();
    expect(repo.eventRows[0]!.resource).toBeNull();
    expect(repo.groups[0]!.fingerprint).toBe(fingerprintOf(['SERVER', 'GET /api/v1/search', normalizeMessage(e.message), '', '']));
    expect((await service.detail(repo.groups[0]!.id))!.events[0]).toMatchObject({ database: null });
  });

  it('a background job’s database error keeps its diagnosis too', async () => {
    service.recordServer('task search: the index sweep failed', { err: rawFailed('1205', 'Lock wait timeout exceeded; try restarting transaction'), sweep: 'search-index-heal-recent' });
    await service.settled();
    expect(repo.eventRows[0]).toMatchObject({ job: 'search-index-heal-recent', resource: 'P2010 · code 1205 · Lock wait timeout exceeded; try restarting transaction' });
  });
});

describe('server stacks keep the paths of their frames', () => {
  it('Prisma’s own frames keep their path (its folder named “client” is no secret)', async () => {
    const e = new Prisma.PrismaClientKnownRequestError('\nInvalid `prisma.$queryRaw()` invocation:\n\n\nRaw query failed. Code: `1038`. Message: `Out of sort memory`', { code: 'P2010', clientVersion: '5.22.0', meta: { code: '1038', message: 'Out of sort memory' } });
    e.stack = [
      'PrismaClientKnownRequestError: ',
      'Invalid `prisma.$queryRaw()` invocation:',
      '',
      'Raw query failed. Code: `1038`. Message: `Out of sort memory`',
      '    at $n.handleRequestError (/home/u1/domains/task.mico360.com/nodejs/node_modules/@prisma/client/runtime/library.js:121:7315)',
      '    at async Object.search (/home/u1/domains/task.mico360.com/nodejs/Web Portal/backend/dist/src/modules/search/task-search-engine.js:85:29)',
    ].join('\n');
    service.recordServer('request failed', { method: 'GET', route: '/api/v1/search', status: 500, err: e, userId: 'u1' });
    await service.settled();
    expect(repo.eventRows[0]!.stack).toContain('at $n.handleRequestError (node_modules/@prisma/client/runtime/library.js:121:7315)');
    expect(repo.eventRows[0]!.stack).not.toContain(':token');
  });
});

// 1.23.1 — a database blip fails many requests on many pages at once (the live site's two at 14:24):
// one row per kind of blip, with its code, each occurrence keeping its own page.
describe('requests that met a database blip: one row per kind', () => {
  const blip = (code: string, route: string) => {
    const e = new Prisma.PrismaClientKnownRequestError(`\nInvalid \`prisma.project.findMany()\` invocation:\n\n\nCan't reach database server at \`srv123.hstgr.io\`:\`3306\``, { code, clientVersion: '5.22.0' });
    e.stack = `PrismaClientKnownRequestError: x\n    at Object.list (/srv/app/dist/src/modules/projects/${route.split('/')[3]}.js:12:5)`;
    return e;
  };

  it('P1001 on two pages is one row; P2024 is another; each says what happened and its code', async () => {
    service.recordServer('request failed', { method: 'GET', route: '/api/v1/projects/:id/members', status: 503, err: blip('P1001', '/api/v1/projects'), userId: 'u1' });
    service.recordServer('request failed', { method: 'GET', route: '/api/v1/projects/:id/meetings-overview', status: 503, err: blip('P1001', '/api/v1/meetings'), userId: 'u2' });
    service.recordServer('request failed', { method: 'GET', route: '/api/v1/tasks', status: 503, err: blip('P2024', '/api/v1/tasks'), userId: 'u1' });
    await service.settled();
    expect(repo.groups).toHaveLength(2);
    const p1001 = repo.groups.find((g) => g.title.includes('P1001'))!;
    expect(p1001).toMatchObject({ kind: 'SERVER', title: 'The database couldn’t be reached (P1001)', count: 2, peopleCount: 2 });
    expect(repo.groups.find((g) => g.title.includes('P2024'))!.title).toBe('No free database connection in time (P2024)');
    const shown = await service.detail(p1001.id);
    expect(shown!.events.map((e) => e.page).sort()).toEqual(['GET /api/v1/projects/:id/meetings-overview', 'GET /api/v1/projects/:id/members']);
    expect(shown!.events[0]!.database).toMatch(/^P1001 · Can't reach database server at/);
    expect(JSON.stringify(repo.eventRows)).not.toContain('hstgr');
  });

  it('a background job’s blip stays the job’s own row', async () => {
    service.recordServer('weekly management summary sweep failed', { err: blip('P1001', '/api/v1/management'), job: 'weekly-management-summary' });
    await service.settled();
    expect(repo.groups[0]!.title).not.toBe('The database couldn’t be reached (P1001)');
    expect(repo.eventRows[0]).toMatchObject({ job: 'weekly-management-summary' });
  });
});

// 1.23.3 — a slow request says where its time went: the server's own time and its time in the database
// (the answer's Server-Timing, sent by the page), beside the whole time the page waited.
describe('a slow request: where the time went', () => {
  const slow = (over: Record<string, unknown> = {}) => ({ kind: 'SLOW', detail: 'api', value: 10_200, page: '/board', resource: 'GET /api/v1/tasks', ...over });
  const slowRows = async () => (await service.list({ kind: 'slow', range: '30d', q: null, status: 'open', before: null })).groups;

  it('each occurrence keeps it; the details and the row show the latest', async () => {
    service.acceptClientBatch({ body: batch(slow({ serverMs: 9912.3, dbMs: 9700.1 })), ip: '1', userAgent: CHROME, userId: 'u1' });
    await service.settled();
    clock = new Date('2026-11-05T08:05:00Z');
    service.acceptClientBatch({ body: batch(slow({ value: 12_000, serverMs: 80, dbMs: 30 })), ip: '2', userAgent: CHROME, userId: 'u2' });
    await service.settled();
    expect(repo.groups).toHaveLength(1); // still one row: the times aren't part of what it is
    const [row] = await slowRows();
    expect(row!.timing).toEqual({ totalMs: 12_000, serverMs: 80, dbMs: 30 });
    const d = await service.detail(row!.id);
    expect(d!.events.map((e) => e.timing)).toEqual([
      { totalMs: 12_000, serverMs: 80, dbMs: 30 },
      { totalMs: 10_200, serverMs: 9912.3, dbMs: 9700.1 },
    ]);
    expect(d!.events.every((e) => e.stack === null)).toBe(true); // kept in its own words, never shown as a stack
    expect(d!.events[0]!.message).toBe('Slow request: GET /api/v1/tasks took 12.0 s');
  });

  it('without them (an older page, or an answer that didn’t say) the row and details are as before', async () => {
    service.acceptClientBatch({ body: batch(slow({ serverMs: 9000, dbMs: 100 })), ip: '1', userAgent: CHROME, userId: 'u1' });
    await service.settled();
    clock = new Date('2026-11-05T08:05:00Z');
    service.acceptClientBatch({ body: batch(slow()), ip: '2', userAgent: CHROME, userId: 'u2' });
    await service.settled();
    const [row] = await slowRows();
    expect(row!.timing).toBeNull(); // the latest didn't say: an older one's times aren't the latest
    const d = await service.detail(row!.id);
    expect(d!.events.map((e) => e.timing)).toEqual([null, { totalMs: 10_200, serverMs: 9000, dbMs: 100 }]);
  });

  it('only the server’s time when the database’s wasn’t said; other rows have none', async () => {
    service.acceptClientBatch({ body: batch(slow({ serverMs: 150 }), { kind: 'SLOW', detail: 'load', value: 9000, page: '/board' }, err()), ip: '1', userAgent: CHROME, userId: 'u1' });
    await service.settled();
    const all = (await service.list({ kind: 'all', range: '30d', q: null, status: 'open', before: null })).groups;
    expect(all.find((g) => g.title.startsWith('Slow request'))!.timing).toEqual({ totalMs: 10_200, serverMs: 150, dbMs: null });
    expect(all.filter((g) => !g.title.startsWith('Slow request')).map((g) => g.timing)).toEqual([null, null]);
    const e = all.find((g) => g.kind === 'ERROR')!;
    expect((await service.detail(e.id))!.events[0]).toMatchObject({ timing: null, stack: expect.stringContaining('TypeError') });
  });
});

// MICO360 AI (b) bundles, b10: an AI failure keeps the request's correlation id and the platform's job id
// (to quote to MICO360 Connect's support, or to look up under AI Platform → Jobs). They are the
// occurrence's details — never part of the row's key, so one failure each time is still one row.
describe('server errors from MICO360 AI keep their ids', () => {
  const aiError = (correlationId: string | null, jobId: string | null) => Object.assign(new Error('The AI service has no model available right now (HTTP 503).'), { correlationId, jobId });

  it('the correlation and job ids are the occurrence’s MICO360 AI line; the same failure again adds up', async () => {
    service.recordServer('MICO360 AI: suggest priority failed', { err: aiError('REQ-6F2A91C0B4D3', 'JOB-GW1-20261111-7'), feature: 'suggest priority' });
    service.recordServer('MICO360 AI: suggest priority failed', { err: aiError('REQ-AAAA', null), feature: 'suggest priority' });
    await service.settled();
    expect(repo.groups).toHaveLength(1);
    expect(repo.groups[0]!.count).toBe(2);
    expect(repo.eventRows.map((e) => e.resource)).toEqual(['MICO360 AI · correlation id REQ-6F2A91C0B4D3 · job JOB-GW1-20261111-7', 'MICO360 AI · correlation id REQ-AAAA']);
    const shown = await service.detail(repo.groups[0]!.id);
    expect(shown!.events.map((e) => e.ai).sort()).toEqual(['MICO360 AI · correlation id REQ-6F2A91C0B4D3 · job JOB-GW1-20261111-7', 'MICO360 AI · correlation id REQ-AAAA']);
    for (const e of shown!.events) expect(e).toMatchObject({ database: null, resource: null });
  });

  it('only well-formed ids are kept', async () => {
    service.recordServer('MICO360 AI: x failed', { err: aiError('REQ <script>', 'mico_' + 'ab'.repeat(24)) });
    await service.settled();
    // A key-like value is not an id the platform writes (letters, digits, - _ : .) of its length, nor kept.
    expect(repo.eventRows[0]!.resource ?? '').not.toContain('script');
    expect(JSON.stringify(repo.eventRows)).not.toContain('abababab');
  });
});

// 1.23.14 — where a slow request's time went, from the browser's own Resource Timing: waiting for a free
// connection, connecting, waiting for the first byte, downloading — beside the server's own time.
describe('a slow request: where the time went, from the browser (1.23.14)', () => {
  const slow = (over: Record<string, unknown> = {}) => ({ kind: 'SLOW', detail: 'api', value: 10_550, page: '/board', resource: 'GET /api/v1/tasks', ...over });
  const parts = { queueMs: 0, connectMs: 30, waitMs: 10_400, downloadMs: 120 };

  it('each occurrence keeps its four parts with the server’s time; the row shows the latest', async () => {
    service.acceptClientBatch({ body: batch(slow({ serverMs: 48.2, dbMs: 12.5, ...parts })), ip: '1', userAgent: CHROME, userId: 'u1' });
    await service.settled();
    const [row] = (await service.list({ kind: 'slow', range: '30d', q: null, status: 'open', before: null })).groups;
    expect(row!.timing).toEqual({ totalMs: 10_550, serverMs: 48.2, dbMs: 12.5, ...parts });
    const d = await service.detail(row!.id);
    expect(d!.events[0]).toMatchObject({ stack: null, timing: { totalMs: 10_550, serverMs: 48.2, dbMs: 12.5, ...parts } });
  });

  it('the parts without the server’s time (an answer from the hosting’s front door): the server’s time unknown', async () => {
    service.acceptClientBatch({ body: batch(slow(parts)), ip: '1', userAgent: CHROME, userId: 'u1' });
    await service.settled();
    const [row] = (await service.list({ kind: 'slow', range: '30d', q: null, status: 'open', before: null })).groups;
    expect(row!.timing).toEqual({ totalMs: 10_550, serverMs: null, dbMs: null, ...parts });
  });
});

// 1.23.14 — an update restart is not an error. The live log's "The database couldn't be reached (P1001)"
// came at deploy restarts (several that evening), answered 503 and tried again as 1.23.1 designed: while the
// server is stopping or in its first minute, a database blip is the update's calm row, never a red Server
// error, and never brings back a row marked fixed.
describe('update restarts (1.23.14)', () => {
  const blip = (code = 'P1001') => {
    const e = new Prisma.PrismaClientKnownRequestError("Can't reach database server at `srv123.hstgr.io`:`3306`", { code, clientVersion: '5.22.0' });
    e.stack = 'PrismaClientKnownRequestError: x\n    at Object.list (/srv/app/dist/src/modules/chat/chat-service.js:12:5)';
    return e;
  };
  const all = async (status: 'open' | 'fixed' = 'open', kind: 'all' | 'server' = 'all') => service.list({ kind, range: '30d', q: null, status, before: null });

  it('a database blip while the server stops or starts: one calm Update row (its page, person and code kept)', async () => {
    inUpdateWindow = true;
    updatePhase = 'stopping';
    service.recordServer('request failed', { method: 'GET', route: '/api/v1/conversations', status: 503, err: blip('P1001'), userId: 'u1' });
    updatePhase = 'starting';
    service.recordServer('request failed', { method: 'GET', route: '/api/v1/tasks', status: 503, err: blip('P1017'), userId: 'u2' });
    service.recordServer('daily task emails failed', { err: blip('P1001'), job: 'daily-task-emails' });
    await service.settled();
    expect(repo.groups).toHaveLength(1);
    expect(repo.groups[0]).toMatchObject({ kind: 'UPDATE', title: 'During an update: the database was briefly unreachable — handled', count: 3, peopleCount: 2 });
    const d = await service.detail(repo.groups[0]!.id);
    // Each occurrence says which side of the restart it was: the old server stopping, or a new one starting.
    expect(d!.events.map((e) => [e.detail, e.page ?? e.job]).sort()).toEqual([
      ['starting', 'GET /api/v1/tasks'],
      ['starting', 'daily-task-emails'],
      ['stopping', 'GET /api/v1/conversations'],
    ]);
    expect(d!.events.find((e) => e.page === 'GET /api/v1/tasks')!.database).toMatch(/^P1017 · /);
    // With the Server chip, and counted there; an older page (that doesn't ask for them) sees a Server row.
    const server = await service.list({ kind: 'server', range: '30d', q: null, status: 'open', before: null, updateKind: true });
    expect(server.groups.map((g) => g.kind)).toEqual(['UPDATE']);
    expect((await all('open', 'server')).groups.map((g) => g.kind)).toEqual(['SERVER']);
    expect(server.counts).toMatchObject({ server: 1, all: 1 });
  });

  it('outside that window it stays a real Server error; an error that isn’t a blip is a Server error in the window too', async () => {
    service.recordServer('request failed', { method: 'GET', route: '/api/v1/conversations', status: 503, err: blip('P1001'), userId: 'u1' });
    inUpdateWindow = true;
    service.recordServer('request failed', { method: 'GET', route: '/api/v1/tasks', status: 500, err: new TypeError('x is undefined'), userId: 'u1' });
    await service.settled();
    expect(repo.groups.map((g) => [g.kind, g.title]).sort()).toEqual([
      ['SERVER', 'The database couldn’t be reached (P1001)'],
      ['SERVER', 'x is undefined'],
    ]);
  });

  it('never brings back a row marked fixed: neither the old Server row nor the Update row itself', async () => {
    service.recordServer('request failed', { method: 'GET', route: '/api/v1/conversations', status: 503, err: blip('P1001'), userId: 'u1' });
    await service.settled();
    const p1001 = repo.groups[0]!;
    await service.markFixed(p1001.id, 'admin1');
    serverVersion = '1.23.14';
    inUpdateWindow = true;
    clock = new Date('2026-11-12T08:00:00Z');
    service.recordServer('request failed', { method: 'GET', route: '/api/v1/conversations', status: 503, err: blip('P1001'), userId: 'u1' });
    await service.settled();
    expect(repo.groups.find((g) => g.id === p1001.id)).toMatchObject({ status: 'FIXED', count: 1 });
    const update = repo.groups.find((g) => g.kind === 'UPDATE')!;
    await service.markFixed(update.id, 'admin1');
    serverVersion = '1.23.15';
    clock = new Date('2026-11-13T08:00:00Z');
    service.recordServer('request failed', { method: 'GET', route: '/api/v1/tasks', status: 503, err: blip('P1001'), userId: 'u2' });
    await service.settled();
    expect(repo.groups.find((g) => g.id === update.id)).toMatchObject({ status: 'FIXED', count: 2 }); // counted, not back
    expect((await all()).groups).toEqual([]);
  });

  it('as the page saw it: a request cut, or held up while the server started — Update rows too, with the Server chip', async () => {
    service.acceptClientBatch({
      body: batch(
        { kind: 'UPDATE', detail: 'api', page: '/dashboard', resource: 'GET /api/v1/dashboard/priorities' },
        { kind: 'UPDATE', detail: 'slow', value: 29_750, page: '/board', resource: 'GET /api/v1/projects/clx0p8k2a0000qz8y6j1v3n4r/columns', serverMs: 35, dbMs: 20, queueMs: 0, connectMs: 0, waitMs: 29_750, downloadMs: 0 },
      ),
      ip: '1',
      userAgent: CHROME,
      userId: 'u1',
    });
    await service.settled();
    const server = await service.list({ kind: 'server', range: '30d', q: null, status: 'open', before: null, updateKind: true });
    expect(server.groups.map((g) => [g.kind, g.title]).sort()).toEqual([
      ['UPDATE', 'During an update: a request was cut off while the server restarted'],
      ['UPDATE', 'During an update: requests waited for the server to start'],
    ]);
    const held = server.groups.find((g) => g.title.includes('waited'))!;
    expect(held.timing).toEqual({ totalMs: 29_750, serverMs: 35, dbMs: 20, queueMs: 0, connectMs: 0, waitMs: 29_750, downloadMs: 0 });
    const d = await service.detail(held.id);
    expect(d!.events[0]).toMatchObject({ message: 'During an update: GET /api/v1/projects/:id/columns waited 29.8 s for the server to start', resource: 'GET /api/v1/projects/:id/columns' });
  });
});
