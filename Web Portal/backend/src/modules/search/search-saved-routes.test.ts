import { describe, it, expect } from 'vitest';
import { buildApp } from '../../app';
import { createSearchService } from './search-service';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';
import { ConflictError, NotFoundError } from '../../lib/http-errors';
import type { SearchAllInput } from './search-engine';
import type { SearchScopeAll } from './search-scope';
import type { SavedSearches, SavedSearchView } from './saved-searches';
import type { ReaderContext } from './search-reader';

// 1.23.6 Saved searches on the routes: what is accepted, and a saved search's count — the same search
// as the page's, for whoever asks (the service's own rules have DB tests: tests/integration/saved-searches).
const tokenService = createTokenService({
  accessSecret: 'ss-access',
  refreshSecret: 'ss-refresh',
  accessTtl: 900,
  refreshTtl: 1000,
  refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
});
const auth = async (id = 'u1') => ({ authorization: `Bearer ${(await tokenService.issueTokens({ id, roles: ['EMPLOYEE'] })).accessToken}` });

const saved = (over: Partial<SavedSearchView> = {}): SavedSearchView => ({
  id: 's1',
  name: 'My overdue MICO',
  q: 'overdue MICO tasks assigned to me',
  filters: {},
  owner: { id: 'u0', name: 'Ana' },
  mine: false,
  shared: { projectId: 'p-mico', code: 'MICO', name: 'MICO360' },
  pinned: true,
  updatedAt: '2026-11-07T08:00:00.000Z',
  ...over,
});

async function makeApp() {
  const authService = createAuthService({
    users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
    maxAttempts: 5,
  });
  const counted: SearchAllInput[] = [];
  const created: unknown[] = [];
  const scope: SearchScopeAll = { projectIds: ['p-mico'], meetings: { full: [], invitee: [], editable: [] } };
  const context: ReaderContext = { today: '2026-11-07', weekStart: 0, projects: [{ id: 'p-mico', code: 'MICO', name: 'MICO360' }], people: [] };
  const service = {
    async list() { return { mine: [], shared: [saved(), saved({ id: 's2', q: '', filters: { type: 'meeting', person: 'me' } })], pinned: ['s1'] }; },
    async usable(_v: unknown, id: string) {
      if (id === 's1') return saved();
      if (id === 's2') return saved({ id: 's2', q: '', filters: { type: 'meeting', person: 'me' } });
      throw new NotFoundError('That saved search no longer exists.');
    },
    async create(_v: unknown, body: unknown) { created.push(body); return saved({ mine: true }); },
    async update() { return saved({ mine: true }); },
    async remove() {},
    async share() { return saved({ mine: true }); },
    async pin() { throw new ConflictError('You can pin up to 5 searches. Unpin one first.', 'PIN_LIMIT'); },
    async shareOptions() { return [{ id: 'p-mico', code: 'MICO', name: 'MICO360' }]; },
  } as unknown as SavedSearches;
  const app = await buildApp({
    authService,
    tokenService,
    searchService: createSearchService({ data: { async getSearchData() { return { tasks: [], projects: [], users: [] }; } } }),
    savedSearches: service,
    searchEverything: {
      engine: {
        async search() { return { hits: [], next: null, corrected: [] }; },
        async count(input) { counted.push(input); return { total: 12, capped: false }; },
      },
      scope: { async forViewer() { return scope; } },
      reader: async () => context,
      timeZone: 'Asia/Muscat',
    },
  });
  return { app, counted, created };
}

describe('saved searches — the routes', () => {
  it('a client page session (no staff sign-in) is refused', async () => {
    const { app } = await makeApp();
    for (const [method, url] of [['GET', '/api/v1/search/saved'], ['POST', '/api/v1/search/saved'], ['GET', '/api/v1/search/saved/counts?ids=s1'], ['PUT', '/api/v1/search/saved/s1/pin']] as const) {
      expect((await app.inject({ method, url, headers: { cookie: 'mico_client_session=x' } })).statusCode, url).toBe(401);
    }
  });

  it('review M13: a client account (a CLIENT bearer token) is refused every saved-search route (403)', async () => {
    const { app } = await makeApp();
    const client = { authorization: `Bearer ${(await tokenService.issueTokens({ id: 'c1', roles: ['CLIENT'] })).accessToken}` };
    for (const [method, url] of [['GET', '/api/v1/search/saved'], ['POST', '/api/v1/search/saved'], ['PATCH', '/api/v1/search/saved/s1'], ['DELETE', '/api/v1/search/saved/s1'], ['PUT', '/api/v1/search/saved/s1/pin'], ['PUT', '/api/v1/search/saved/s1/share'], ['GET', '/api/v1/search/saved/counts?ids=s1'], ['GET', '/api/v1/search/saved/share-options']] as const) {
      const res = await app.inject({ method, url, headers: client, ...(method === 'GET' || method === 'DELETE' ? {} : { payload: {} }) });
      expect(res.statusCode, url).toBe(403);
      expect(res.json().error.code, url).toBe('CLIENT_NOT_ALLOWED');
    }
  });

  it('lists, saves (name, words and the page’s filters checked), and says why a pin is refused', async () => {
    const { app, created } = await makeApp();
    const h = await auth();
    expect((await app.inject({ method: 'GET', url: '/api/v1/search/saved', headers: h })).json().data.pinned).toEqual(['s1']);
    const ok = await app.inject({ method: 'POST', url: '/api/v1/search/saved', headers: h, payload: { name: ' Overdue ', q: 'overdue tasks', filters: { type: 'task', off: ['due'], plain: false, from: '2026-11-01' } } });
    expect(ok.statusCode).toBe(201);
    expect(created[0]).toEqual({ name: 'Overdue', q: 'overdue tasks', filters: { type: 'task', off: ['due'], plain: false, from: '2026-11-01' } });
    for (const payload of [{ name: '' }, { name: 'x'.repeat(81) }, { name: 'a', q: 'x'.repeat(201) }, { name: 'a', filters: { type: 'chat' } }, { name: 'a', filters: { from: '1 Nov' } }, { name: 'a', filters: { off: ['everything'] } }, { name: 'a', filters: { secret: 1 } }]) {
      expect((await app.inject({ method: 'POST', url: '/api/v1/search/saved', headers: h, payload })).statusCode, JSON.stringify(payload)).toBe(400);
    }
    const pin = await app.inject({ method: 'PUT', url: '/api/v1/search/saved/s1/pin', headers: h, payload: { pinned: true } });
    expect(pin.statusCode).toBe(409);
    expect(pin.json().error.message).toBe('You can pin up to 5 searches. Unpin one first.');
    expect((await app.inject({ method: 'PUT', url: '/api/v1/search/saved/s1/share', headers: h, payload: { projectId: 5 } })).statusCode).toBe(400);
  });

  it('a count is the saved search run for whoever asks (“me” is them), and kept for a minute', async () => {
    const { app, counted } = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/search/saved/counts?ids=s1,s2,gone', headers: await auth('u7') });
    expect(res.statusCode).toBe(200);
    // A saved search the person may not use (or that is gone) is simply not counted.
    expect(res.json().data).toEqual({ s1: { total: 12, capped: false }, s2: { total: 12, capped: false } });
    expect(counted[0]).toMatchObject({ q: '', browse: true, kinds: ['task'], projectId: 'p-mico', due: { before: new Date('2026-11-07T00:00:00Z'), open: true }, assigneeIds: ['u7'], viewerId: 'u7' });
    expect(counted[1]).toMatchObject({ q: '', browse: true, kinds: ['meeting'], personId: 'u7' });
    await app.inject({ method: 'GET', url: '/api/v1/search/saved/counts?ids=s1', headers: await auth('u7') });
    expect(counted).toHaveLength(2);
    await app.inject({ method: 'GET', url: '/api/v1/search/saved/counts?ids=s1', headers: await auth('u8') });
    expect(counted).toHaveLength(3);
    expect((await app.inject({ method: 'GET', url: `/api/v1/search/saved/counts?ids=${Array.from({ length: 11 }, (_, i) => `s${i}`).join(',')}`, headers: await auth() })).statusCode).toBe(400);
  });
});
