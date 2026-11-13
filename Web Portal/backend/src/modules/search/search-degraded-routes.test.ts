import { describe, it, expect } from 'vitest';
import { buildApp } from '../../app';
import { createSearchService } from './search-service';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';
import type { SearchAllResult } from './search-engine';
import type { SearchScopeAll } from './search-scope';
import type { SearchHit } from './search-types';
import type { Logger } from '../../lib/logger';

// 1.23.1 — on the live site the task search failed (a database error) and every top-bar search failed
// with it (a 500, recorded on each of the website's retries). Now the other results still come back
// with `tasksUnavailable`, which the website shows as one quiet line, and the error is recorded once.
const tokenService = createTokenService({
  accessSecret: 'sd-access',
  refreshSecret: 'sd-refresh',
  accessTtl: 900,
  refreshTtl: 1000,
  refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
});
const tokenFor = async (id: string, roles: string[]) => (await tokenService.issueTokens({ id, roles })).accessToken;
const hit = (kind: SearchHit['kind'], id: string): SearchHit => ({ kind, id, title: `${kind} ${id}`, titleRanges: [], project: null, status: null, date: null, people: null, matches: [], target: { type: 'task', taskId: id } });

function capturing() {
  const errors: { message: string; ctx: Record<string, unknown> | undefined }[] = [];
  const logger: Logger = { debug() {}, info() {}, warn() {}, error: (message, ctx) => void errors.push({ message, ctx }) };
  return { errors, logger };
}

async function makeApp({ tasksFail = false, moreFails = false, allTasksFail = false, meetingsFail = false, scopeFails = false } = {}) {
  const authService = createAuthService({
    users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
    maxAttempts: 5,
  });
  const { errors, logger } = capturing();
  const scope: SearchScopeAll = { projectIds: null, meetings: { full: null, invitee: [], editable: null } };
  const taskError = Object.assign(new Error('\nInvalid `prisma.$queryRaw()` invocation:\n\n\nRaw query failed.'), { name: 'PrismaClientKnownRequestError', code: 'P2010' });
  const app = await buildApp({
    authService,
    tokenService,
    logger,
    searchService: createSearchService({
      data: { async getSearchData() { return { tasks: [], projects: [{ id: 'p1', code: 'MICO', name: 'Pump repair yard' }], users: [] }; } },
      tasks: {
        async search() {
          if (tasksFail) throw taskError;
          return { hits: [{ id: 't1', key: 'MICO-1', title: 'Pump repair', projectId: 'p1' }], nextOffset: null };
        },
      },
    }),
    searchEverything: {
      engine: {
        async search(input): Promise<SearchAllResult> {
          if (input.kinds?.includes('note') && !input.kinds.includes('task') && moreFails) throw new Error('notes down');
          // Each failing pass of the task half is told (the exact one, the spelling one…): recorded once.
          if (allTasksFail) {
            input.onTasksFailed?.(taskError);
            input.onTasksFailed?.(taskError);
          }
          return { hits: [hit('note', 'n1')], next: null, corrected: [], ...(allTasksFail ? { tasksUnavailable: true as const } : {}), ...(input.withCounts ? { counts: { task: 0, project: 0, meeting: 0, note: 1, minutes: 0, file: 0, inspection: 0, checklist: 0, contact: 0 }, total: 1, totalCapped: false } : {}) };
        },
      },
      scope: {
        async forViewer() {
          if (scopeFails) throw new Error('scope down');
          return scope;
        },
      },
      // Review #22: the top bar's meetings (from the index).
      meetings: {
        async search() {
          if (meetingsFail) throw new Error('meetings down');
          return [{ id: 'm1', title: 'Pump repair review', projectId: null, snippet: 'pump' }];
        },
      },
      timeZone: 'Asia/Muscat',
    },
  });
  return { app, errors };
}

describe('GET /search — the top bar when the task search fails', () => {
  it('answers 200 with the projects (and notes) found, tasksUnavailable, and records the error once', async () => {
    const { app, errors } = await makeApp({ tasksFail: true });
    const res = await app.inject({ method: 'GET', url: '/api/v1/search?q=pump%20repair', headers: { authorization: `Bearer ${await tokenFor('u1', ['ADMIN'])}` } });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.tasks).toEqual([]);
    expect(data.tasksUnavailable).toBe(true);
    expect(data.projects.map((p: { code: string }) => p.code)).toEqual(['MICO']);
    expect(data.more.map((h: SearchHit) => h.id)).toEqual(['n1']);
    expect(errors).toHaveLength(1);
    // As a failed request is recorded: its route pattern and the person (never the address and its words).
    expect(errors[0]!.ctx).toMatchObject({ method: 'GET', route: '/api/v1/search', userId: 'u1' });
    expect(errors[0]!.ctx!.err).toBeInstanceOf(Error);
    expect(JSON.stringify(errors[0]!.ctx)).not.toContain('repair');
  });

  it('a search that worked records nothing and has no flag', async () => {
    const { app, errors } = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/search?q=pump', headers: { authorization: `Bearer ${await tokenFor('u1', ['ADMIN'])}` } });
    expect(res.json().data.tasks.map((t: { key: string }) => t.key)).toEqual(['MICO-1']);
    expect(res.json().data).not.toHaveProperty('tasksUnavailable');
    expect(errors).toHaveLength(0);
  });

  it('the notes, minutes and files part failing still shows the rest — and is recorded too', async () => {
    const { app, errors } = await makeApp({ moreFails: true });
    const res = await app.inject({ method: 'GET', url: '/api/v1/search?q=pump', headers: { authorization: `Bearer ${await tokenFor('u1', ['ADMIN'])}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.tasks).toHaveLength(1);
    expect(res.json().data.more).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.ctx).toMatchObject({ route: '/api/v1/search' });
  });
});

describe('GET /search — the top bar when its meetings (review #22) or the scope fail', () => {
  const asAdmin = async (app: Awaited<ReturnType<typeof makeApp>>['app']) =>
    app.inject({ method: 'GET', url: '/api/v1/search?q=pump', headers: { authorization: `Bearer ${await tokenFor('u1', ['ADMIN'])}` } });

  it('the meetings come back with the rest', async () => {
    const { app, errors } = await makeApp();
    expect((await asAdmin(app)).json().data.meetings).toEqual([{ id: 'm1', title: 'Pump repair review', projectId: null, snippet: 'pump' }]);
    expect(errors).toHaveLength(0);
  });

  it('the meetings part failing still shows the rest — no meetings, recorded once', async () => {
    const { app, errors } = await makeApp({ meetingsFail: true });
    const res = await asAdmin(app);
    expect(res.statusCode).toBe(200);
    expect(res.json().data.meetings).toEqual([]);
    expect(res.json().data.tasks).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.ctx).toMatchObject({ part: 'meetings' });
  });

  it('the scope failing (both the meetings and the other kinds need it) is recorded once', async () => {
    const { app, errors } = await makeApp({ scopeFails: true });
    const res = await asAdmin(app);
    expect(res.statusCode).toBe(200);
    expect(res.json().data.meetings).toEqual([]);
    expect(res.json().data.more).toEqual([]);
    expect(res.json().data.projects).toHaveLength(1);
    expect(errors).toHaveLength(1);
  });
});

describe('GET /search/all — the Search page when the task half fails', () => {
  it('passes the flag on and records the error once, whatever the passes', async () => {
    const { app, errors } = await makeApp({ allTasksFail: true });
    const res = await app.inject({ method: 'GET', url: '/api/v1/search/all?q=pump%20repair', headers: { authorization: `Bearer ${await tokenFor('u1', ['ADMIN'])}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json().tasksUnavailable).toBe(true);
    expect(res.json().data.map((h: SearchHit) => h.id)).toEqual(['n1']);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.ctx).toMatchObject({ method: 'GET', route: '/api/v1/search/all', userId: 'u1' });
  });

  it('no flag when the task half worked', async () => {
    const { app, errors } = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/search/all?q=pump', headers: { authorization: `Bearer ${await tokenFor('u1', ['ADMIN'])}` } });
    expect(res.json()).not.toHaveProperty('tasksUnavailable');
    expect(errors).toHaveLength(0);
  });
});
