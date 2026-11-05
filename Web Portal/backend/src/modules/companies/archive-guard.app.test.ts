import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp, type AppDeps } from '../../app';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';
import { ARCHIVE_REFUSED, PROJECT_ARCHIVED_MESSAGE, type ArchiveLookup } from './archive-guard';

// 1.22: the archive check is on every refused route as the real route modules register them
// (buildApp): each is asked about something of an archived project and must answer 409 before its
// own work starts — every service here throws if it is ever called.

const tokenService = createTokenService({
  accessSecret: 'archive-access',
  refreshSecret: 'archive-refresh',
  accessTtl: 900,
  refreshTtl: 1000,
  refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
});
const authService = createAuthService({
  users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
  maxAttempts: 5,
});

/** A service whose every method fails the test: the route's handler must never run. */
const untouched = (name: string) =>
  new Proxy({} as Record<string, unknown>, {
    get: (_t, prop) =>
      prop === 'then' || typeof prop === 'symbol'
        ? undefined
        : () => {
            throw new Error(`${name}.${String(prop)} was called: the archive check did not stop the request`);
          },
  });

/** Everything belongs to an archived project. */
const lookup: ArchiveLookup = {
  async subjectOf(kind, id) {
    return { projectId: 'PX', ...(kind === 'meeting' ? { meetingId: id } : {}) };
  },
  async isArchived() {
    return true;
  },
};

let app: Awaited<ReturnType<typeof buildApp>>;
beforeAll(async () => {
  const services = [
    'projectService', 'columnService', 'memberService', 'taskService', 'approvalSource', 'taskMoveService', 'assigneeService', 'watcherService',
    'tagService', 'checklistService', 'externalContactService', 'commentService', 'attachmentService', 'dependencyService', 'meetingService',
    'attendeeService', 'agendaService', 'actionItemService', 'noteService', 'clientView',
    'namedSeriesService', // 1.23 Meeting series
  ] as const;
  const deps = Object.fromEntries(services.map((s) => [s, untouched(s)])) as Partial<AppDeps>;
  app = await buildApp({
    ...deps,
    // The parts that switch on a group of routes (client sharing of tasks and minutes, the final minutes, a note's task).
    clientView: { tasks: untouched('clientView.tasks'), minutes: untouched('clientView.minutes') },
    finalMinutesRepository: untouched('finalMinutesRepository'),
    finalMinutesAi: untouched('finalMinutesAi'), // 1.22 Lane AI: the AI's offered draft (Use it)
    noteTaskService: untouched('noteTaskService'),
    // 1.23: Make Teams link (the Teams routes).
    microsoft: { connections: null, teams: untouched('microsoft.teams'), appUrl: 'http://x', canEditMeeting: untouched('microsoft').canEdit, getMeeting: untouched('microsoft').getMeeting },
    authService,
    tokenService,
    archiveLookup: lookup,
    resolveUserNames: async () => new Map(),
  } as unknown as AppDeps);
});
afterAll(() => app.close());

describe.each(Object.keys(ARCHIVE_REFUSED))('%s, as the server registers it', (key) => {
  it('answers 409 PROJECT_ARCHIVED for an archived project, before the route does anything', async () => {
    const [method, path] = key.split(' ') as [string, string];
    const token = (await tokenService.issueTokens({ id: 'u1', roles: ['ADMIN'] })).accessToken;
    const res = await app.inject({
      method: method as 'POST',
      url: `/api/v1${path.replace(/:(\w+)/g, 'x1')}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { projectId: 'PX', columnId: 'c1', taskIds: ['x1'], title: 'A task', meetingId: 'x1' },
    });
    expect(res.json(), res.body).toEqual({ error: { code: 'PROJECT_ARCHIVED', message: PROJECT_ARCHIVED_MESSAGE } });
    expect(res.statusCode).toBe(409);
  });
});

describe('1.22 integration: lane M’s "Add email" on a guest, as the server registers it', () => {
  it('PATCH an attendee with { externalEmail } answers 409 PROJECT_ARCHIVED before the attendee service is asked', async () => {
    const token = (await tokenService.issueTokens({ id: 'u1', roles: ['ADMIN'] })).accessToken;
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/meetings/x1/attendees/a1',
      headers: { authorization: `Bearer ${token}` },
      payload: { externalEmail: 'walkin@visitor.co' },
    });
    expect(res.json(), res.body).toEqual({ error: { code: 'PROJECT_ARCHIVED', message: PROJECT_ARCHIVED_MESSAGE } });
    expect(res.statusCode).toBe(409);
  });
});

describe('the check comes after sign-in', () => {
  it('a request without sign-in still gets 401, not a word about the project', async () => {
    const res = await app.inject({ method: 'PUT', url: '/api/v1/tasks/x1', payload: { title: 'x' } });
    expect(res.statusCode).toBe(401);
  });
});
