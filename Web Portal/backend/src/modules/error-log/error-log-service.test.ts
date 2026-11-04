import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { addressKey, createErrorLogService, type ErrorLogService } from './error-log-service';
import { createMemoryErrorLogRepository } from './error-log-repository';
import { createMapStore } from './stack';

const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const err = (over: Record<string, unknown> = {}) => ({ kind: 'ERROR', detail: 'error', message: 'TypeError: x is undefined', stack: 'TypeError: x is undefined\n    at q (https://task.mico360.com/assets/BoardPage-B3x9kQ2a.js:1:120)', page: '/board', version: '1.22.4', screen: '1440x900', ...over });
const batch = (...reports: unknown[]) => JSON.stringify({ reports });

let repo: ReturnType<typeof createMemoryErrorLogRepository>;
let clock: Date;
let collecting: boolean;
let warned: string[];
let service: ErrorLogService;
let serverVersion: string | null;

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
  });
}

beforeEach(() => {
  repo = createMemoryErrorLogRepository();
  clock = new Date('2026-11-05T08:00:00Z');
  collecting = true;
  warned = [];
  serverVersion = '1.22.4';
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
