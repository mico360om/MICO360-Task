import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createErrorLogService, type ErrorLogService } from './error-log-service';
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
let serverVersion: string;

function make(opts: { webRoot?: string | null; perAddress?: number; serverPerMinute?: number } = {}) {
  service = createErrorLogService({
    repo,
    maps: createMapStore({ webRoot: opts.webRoot ?? null }),
    now: () => clock,
    timeZone: 'Asia/Muscat',
    serverVersion: () => serverVersion,
    collecting: async () => collecting,
    warn: (msg) => warned.push(msg),
    limits: { perAddressPerMinute: opts.perAddress ?? 60, serverPerMinute: opts.serverPerMinute ?? 120 },
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
    // The same error from a later build (a new hash, the same map content) is the same row.
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
    // 1.22.5: back.
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
