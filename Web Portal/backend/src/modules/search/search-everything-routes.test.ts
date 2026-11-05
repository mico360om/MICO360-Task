import { describe, it, expect } from 'vitest';
import { buildApp } from '../../app';
import { createSearchService } from './search-service';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';
import type { SearchAllInput, SearchAllResult } from './search-engine';
import type { SearchScopeAll } from './search-scope';
import type { SearchHit } from './search-types';

const tokenService = createTokenService({
  accessSecret: 'se-access',
  refreshSecret: 'se-refresh',
  accessTtl: 900,
  refreshTtl: 1000,
  refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
});
const tokenFor = async (id: string, roles: string[]) => (await tokenService.issueTokens({ id, roles })).accessToken;

const hit = (kind: SearchHit['kind'], id: string): SearchHit => ({ kind, id, title: `${kind} ${id}`, titleRanges: [], project: null, status: null, date: null, people: null, matches: [], target: { type: 'task', taskId: id } });

async function makeApp(opts: { searchPerMinute?: number } = {}) {
  const authService = createAuthService({
    users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
    maxAttempts: 5,
  });
  const calls: SearchAllInput[] = [];
  const scopes: { viewer: string; pick: string | null }[] = [];
  const asked: unknown[] = [];
  const scope: SearchScopeAll = { projectIds: ['p1'], meetings: { full: ['m1'], invitee: [], editable: [] } };
  const app = await buildApp({
    authService,
    tokenService,
    ...(opts.searchPerMinute ? { searchPerMinute: opts.searchPerMinute } : {}),
    searchService: createSearchService({ data: { async getSearchData() { return { tasks: [], projects: [], users: [] }; } } }),
    searchEverything: {
      engine: {
        async search(input): Promise<SearchAllResult> {
          calls.push(input);
          return { hits: [hit('task', 't1'), hit('note', 'n1')], next: input.offset ? null : { offset: 2, extra: false }, corrected: [], ...(input.withCounts ? { counts: { task: 1, project: 0, meeting: 0, note: 1, minutes: 0, file: 0, inspection: 0 }, total: 2, totalCapped: false } : {}) };
        },
      },
      scope: { async forViewer(viewer, pick) { scopes.push({ viewer: viewer.id, pick }); return scope; } },
      ai: {
        async status() { return { ready: true, semantic: false }; },
        async ask(input) { asked.push(input); return { state: 'off', message: 'AI search is off.' }; },
      },
      timeZone: 'Asia/Muscat',
    },
  });
  return { app, calls, scopes, asked };
}

describe('GET /search/all — search everything', () => {
  it('refuses a request without a signed-in staff session (a client page session is not one)', async () => {
    const { app } = await makeApp();
    expect((await app.inject({ method: 'GET', url: '/api/v1/search/all?q=pump' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/v1/search/all?q=pump', headers: { cookie: 'mico_client=abc', authorization: 'Bearer not-a-token' } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/v1/search/ai', payload: { q: 'pump' } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/v1/search/ai/status' })).statusCode).toBe(401);
  });

  it('reads the filters, scopes the search to the person and counts on the first page', async () => {
    const { app, calls, scopes } = await makeApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/search/all?q=pump&type=task,note&projectId=p1&status=TODO,DONE&done=false&person=me&from=2026-11-01&to=2026-11-07&archived=true&limit=10',
      headers: { authorization: `Bearer ${await tokenFor('u1', ['EMPLOYEE'])}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.map((h: SearchHit) => h.id)).toEqual(['t1', 'n1']);
    expect(body.counts).toMatchObject({ task: 1, note: 1 });
    expect(body.total).toBe(2);
    expect(typeof body.nextCursor).toBe('string');
    expect(scopes).toEqual([{ viewer: 'u1', pick: null }]);
    expect(calls[0]).toMatchObject({
      q: 'pump', viewerId: 'u1', kinds: ['task', 'note'], projectId: 'p1', taskStatuses: ['TODO', 'DONE'], done: false, personId: 'u1', includeArchived: true, limit: 10, offset: 0, withCounts: true,
      // Company days (Muscat): from the start of 1 Nov to the end of 7 Nov.
      from: new Date('2026-10-31T20:00:00Z'), to: new Date('2026-11-07T20:00:00Z'),
      // A task's due date by its calendar day (stored as UTC midnight) — review M4.
      dueFrom: new Date('2026-11-01T00:00:00Z'), dueTo: new Date('2026-11-08T00:00:00Z'),
    });
    // The next page: no counts again.
    const next = await app.inject({ method: 'GET', url: `/api/v1/search/all?q=pump&cursor=${body.nextCursor}`, headers: { authorization: `Bearer ${await tokenFor('u1', ['EMPLOYEE'])}` } });
    expect(next.statusCode).toBe(200);
    expect(calls[1]).toMatchObject({ offset: 2, extra: false, withCounts: false });
  });

  it('refuses bad filters and cursors (400)', async () => {
    const { app } = await makeApp();
    const auth = { authorization: `Bearer ${await tokenFor('u1', ['EMPLOYEE'])}` };
    const tooDeep = Buffer.from('o:5000', 'utf8').toString('base64url'); // review M11: pages stop 1000 deep
    for (const url of ['/api/v1/search/all?q=x&type=chat', '/api/v1/search/all?q=x&from=3-11-2026', '/api/v1/search/all?q=x&cursor=bad', '/api/v1/search/all?q=x&status=LATE', `/api/v1/search/all?q=x&cursor=${tooDeep}`]) {
      expect((await app.inject({ method: 'GET', url, headers: auth })).statusCode, url).toBe(400);
    }
  });

  it('the AI panel: its status, and a question asked with the page’s filters', async () => {
    const { app, asked } = await makeApp();
    const auth = { authorization: `Bearer ${await tokenFor('u1', ['EMPLOYEE'])}` };
    expect((await app.inject({ method: 'GET', url: '/api/v1/search/ai/status', headers: auth })).json()).toEqual({ data: { ready: true, semantic: false } });
    const res = await app.inject({ method: 'POST', url: '/api/v1/search/ai', headers: auth, payload: { q: 'overdue electrical tasks', type: 'task', person: 'me' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: { state: 'off', message: 'AI search is off.' } });
    expect(asked[0]).toMatchObject({ q: 'overdue electrical tasks', viewer: { id: 'u1' }, filters: { kinds: ['task'], personId: 'u1' } });
    expect((await app.inject({ method: 'POST', url: '/api/v1/search/ai', headers: auth, payload: { q: '' } })).statusCode).toBe(400);
  });
});

// Security review (1.23): the spelling pass is costly. The top bar asks for whole matches only (it drops
// the close and partial ones anyway), and each person's searches are limited per minute.
describe('search costs', () => {
  it('the top bar’s other kinds ask for whole matches only: no spelling or some-words passes', async () => {
    const { app, calls } = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/search?q=pump', headers: { authorization: `Bearer ${await tokenFor('u1', ['EMPLOYEE'])}` } });
    expect(res.statusCode).toBe(200);
    expect(calls[0]).toMatchObject({ kinds: ['note', 'minutes', 'file', 'inspection'], exactOnly: true });
  });

  it('each person’s searches are limited per minute (the top bar, the results page, tasks, the AI panel)', async () => {
    const { app } = await makeApp({ searchPerMinute: 3 });
    const as = async (id: string) => ({ authorization: `Bearer ${await tokenFor(id, ['EMPLOYEE'])}` });
    for (const url of ['/api/v1/search?q=pump', '/api/v1/search/all?q=pump']) {
      const mine = await as(`u-${url.length}`);
      for (let i = 0; i < 3; i++) expect((await app.inject({ method: 'GET', url, headers: mine })).statusCode, `${url} ${i}`).toBe(200);
      const over = await app.inject({ method: 'GET', url, headers: mine });
      expect(over.statusCode, url).toBe(429);
      expect(over.json().error.code).toBe('RATE_LIMITED');
      // Someone else still searches.
      expect((await app.inject({ method: 'GET', url, headers: await as(`other-${url.length}`) })).statusCode).toBe(200);
    }
    const ai = await as('u-ai');
    for (let i = 0; i < 3; i++) await app.inject({ method: 'POST', url: '/api/v1/search/ai', headers: ai, payload: { q: 'pump' } });
    expect((await app.inject({ method: 'POST', url: '/api/v1/search/ai', headers: ai, payload: { q: 'pump' } })).statusCode).toBe(429);
  });
});
