import { describe, it, expect } from 'vitest';
import { buildApp } from '../../app';
import { createSearchService } from './search-service';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';
import type { SearchAllInput, SearchAllResult } from './search-engine';
import type { SearchScopeAll } from './search-scope';
import type { SearchHit } from './search-types';
import type { ReaderContext } from './search-reader';

// 1.23.6 The built-in reader on the routes: the words as typed are read on the server, for the person
// searching (their projects and people), and the engine gets the leftover words and the filters.
const tokenService = createTokenService({
  accessSecret: 'sr-access',
  refreshSecret: 'sr-refresh',
  accessTtl: 900,
  refreshTtl: 1000,
  refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
});
const auth = async (id = 'u1', roles = ['EMPLOYEE']) => ({ authorization: `Bearer ${(await tokenService.issueTokens({ id, roles })).accessToken}` });
const hit = (kind: SearchHit['kind'], id: string): SearchHit => ({ kind, id, title: `${kind} ${id}`, titleRanges: [], project: null, status: null, date: null, people: null, matches: [], target: { type: 'task', taskId: id } });
const zero = { task: 0, project: 0, meeting: 0, note: 0, minutes: 0, file: 0, inspection: 0, checklist: 0, contact: 0 };

async function makeApp() {
  const authService = createAuthService({
    users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
    maxAttempts: 5,
  });
  const calls: SearchAllInput[] = [];
  const counted: SearchAllInput[] = [];
  const asked: { filters: Record<string, unknown> }[] = [];
  const readFor: { viewer: string; pick: string | null }[] = [];
  const scope: SearchScopeAll = { projectIds: ['p-mico'], meetings: { full: [], invitee: [], editable: [] } };
  const context: ReaderContext = {
    today: '2026-11-07',
    weekStart: 0,
    projects: [{ id: 'p-mico', code: 'MICO', name: 'MICO360 Implementation' }],
    people: [{ id: 'u-sara', firstName: 'Sara', lastName: 'Ali', username: 'sara' }],
  };
  const app = await buildApp({
    authService,
    tokenService,
    searchService: createSearchService({ data: { async getSearchData() { return { tasks: [], projects: [], users: [] }; } } }),
    searchEverything: {
      engine: {
        async search(input): Promise<SearchAllResult> {
          calls.push(input);
          return { hits: [hit('task', 't1')], next: null, corrected: [], ...(input.withCounts ? { counts: { ...zero, task: 1 }, total: 1, totalCapped: false } : {}) };
        },
        async count(input) {
          counted.push(input);
          return { total: 7, capped: false };
        },
      },
      scope: { async forViewer() { return scope; } },
      reader: async (viewer, pick) => {
        readFor.push({ viewer: viewer.id, pick });
        return context;
      },
      ai: {
        async status() { return { ready: true, semantic: false }; },
        async ask(input) { asked.push(input as unknown as { filters: Record<string, unknown> }); return { state: 'off', message: 'AI search is off.' }; },
      },
      timeZone: 'Asia/Muscat',
    },
  });
  return { app, calls, counted, asked, readFor };
}
const OWNER = 'Show overdue MICO tasks assigned to me';

describe('GET /search/all — the reader', () => {
  it('the owner’s example: no words left, the filters read (as the person searching), and what was understood', async () => {
    const { app, calls, readFor } = await makeApp();
    const res = await app.inject({ method: 'GET', url: `/api/v1/search/all?q=${encodeURIComponent(OWNER)}`, headers: await auth() });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.understood.chips.map((c: { label: string }) => c.label)).toEqual(['Tasks', 'Overdue', 'MICO', 'Assigned to me']);
    expect(body.understood.words).toBe('');
    expect(body.understood.kinds).toEqual(['task']);
    expect(readFor).toEqual([{ viewer: 'u1', pick: null }]);
    expect(calls[0]).toMatchObject({
      q: '',
      browse: true,
      kinds: ['task'],
      projectId: 'p-mico',
      // Overdue: due before today (a task's day is its UTC midnight) and not done.
      due: { before: new Date('2026-11-07T00:00:00Z'), open: true },
      // "me" is whoever searches.
      assigneeIds: ['u1'],
    });
  });

  it('a chip taken off (off=…) drops its filter and says what was taken off', async () => {
    const { app, calls } = await makeApp();
    const body = (await app.inject({ method: 'GET', url: `/api/v1/search/all?q=${encodeURIComponent(OWNER)}&off=due,project`, headers: await auth() })).json();
    expect(body.understood.chips.map((c: { label: string }) => c.label)).toEqual(['Tasks', 'Assigned to me']);
    expect(body.understood.removed).toEqual([{ key: 'due', label: 'Overdue' }, { key: 'project', label: 'MICO' }]);
    expect(calls[0]!.due).toBeUndefined();
    expect(calls[0]!.projectId).toBeUndefined();
  });

  it('"Search the words instead" (plain=true): every word as typed, nothing read', async () => {
    const { app, calls, readFor } = await makeApp();
    const body = (await app.inject({ method: 'GET', url: `/api/v1/search/all?q=${encodeURIComponent(OWNER)}&plain=true`, headers: await auth() })).json();
    expect(body.understood).toBeNull();
    expect(calls[0]).toMatchObject({ q: OWNER });
    expect(calls[0]!.browse).toBeFalsy();
    expect(calls[0]!.due).toBeUndefined();
    expect(readFor).toEqual([]);
  });

  it('the page’s own filters win over what was read (and its chip is not shown)', async () => {
    const { app, calls } = await makeApp();
    const body = (await app.inject({ method: 'GET', url: `/api/v1/search/all?q=${encodeURIComponent('MICO tasks due today')}&type=meeting&projectId=p-other`, headers: await auth() })).json();
    expect(body.understood.chips.map((c: { label: string }) => c.label)).toEqual(['Due today']);
    // Review M5: what the kind chip read stays known (the page's "All" then takes it off).
    expect(body.understood.kinds).toEqual(['task']);
    expect(calls[0]).toMatchObject({ kinds: ['meeting'], projectId: 'p-other', due: { from: new Date('2026-11-07T00:00:00Z'), before: new Date('2026-11-08T00:00:00Z') } });
  });

  it('plain words: nothing read, the search as before', async () => {
    const { app, calls } = await makeApp();
    const body = (await app.inject({ method: 'GET', url: '/api/v1/search/all?q=high%20pressure%20test', headers: await auth() })).json();
    expect(body.understood).toEqual({ chips: [], words: 'high pressure test', removed: [] });
    expect(calls[0]).toMatchObject({ q: 'high pressure test' });
    expect(calls[0]!.browse).toBeFalsy();
  });

  it('no words and no filters: no browsing; filters alone (a page filter) browse', async () => {
    const { app, calls } = await makeApp();
    await app.inject({ method: 'GET', url: '/api/v1/search/all?q=', headers: await auth() });
    expect(calls[0]!.browse).toBeFalsy();
    await app.inject({ method: 'GET', url: '/api/v1/search/all?q=&type=task&person=me', headers: await auth() });
    expect(calls[1]).toMatchObject({ browse: true, kinds: ['task'], personId: 'u1' });
    await app.inject({ method: 'GET', url: '/api/v1/search/all?q=&archived=true', headers: await auth() });
    expect(calls[2]!.browse).toBeFalsy(); // "Include archived" alone is not a filter of what to find
  });

  it('refuses an unknown chip to take off (400)', async () => {
    const { app } = await makeApp();
    expect((await app.inject({ method: 'GET', url: '/api/v1/search/all?q=x&off=everything', headers: await auth() })).statusCode).toBe(400);
  });
});

describe('GET /search — the top bar’s first row', () => {
  it('says what was understood and how many items it finds', async () => {
    const { app, counted } = await makeApp();
    const body = (await app.inject({ method: 'GET', url: `/api/v1/search?q=${encodeURIComponent(OWNER)}`, headers: await auth() })).json();
    expect(body.data.understood).toMatchObject({ words: '', total: 7, capped: false });
    expect(body.data.understood.chips.map((c: { label: string }) => c.label)).toEqual(['Tasks', 'Overdue', 'MICO', 'Assigned to me']);
    expect(counted[0]).toMatchObject({ q: '', browse: true, kinds: ['task'], assigneeIds: ['u1'] });
  });

  it('plain words: no such row', async () => {
    const { app, counted } = await makeApp();
    const body = (await app.inject({ method: 'GET', url: '/api/v1/search?q=pump%20repair', headers: await auth() })).json();
    expect(body.data.understood).toBeUndefined();
    expect(counted).toEqual([]);
  });
});

describe('POST /search/ai — given the reader’s filters', () => {
  it('the question’s chips hold for the AI’s candidates (the page’s own filters still win)', async () => {
    const { app, asked } = await makeApp();
    const res = await app.inject({ method: 'POST', url: '/api/v1/search/ai', headers: await auth(), payload: { q: OWNER } });
    expect(res.statusCode).toBe(200);
    expect(asked[0]!.filters).toMatchObject({ kinds: ['task'], projectId: 'p-mico', due: { before: new Date('2026-11-07T00:00:00Z'), open: true }, assigneeIds: ['u1'] });
    await app.inject({ method: 'POST', url: '/api/v1/search/ai', headers: await auth(), payload: { q: OWNER, off: ['due'], type: 'meeting' } });
    expect(asked[1]!.filters).toMatchObject({ kinds: ['meeting'] });
    expect(asked[1]!.filters.due).toBeUndefined();
    await app.inject({ method: 'POST', url: '/api/v1/search/ai', headers: await auth(), payload: { q: OWNER, plain: true } });
    expect(asked[2]!.filters.assigneeIds).toBeUndefined();
  });
});
