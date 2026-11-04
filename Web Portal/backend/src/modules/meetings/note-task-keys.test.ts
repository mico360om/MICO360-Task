import { describe, it, expect } from 'vitest';
import { registerNoteRoutes } from './note-routes';
import Fastify, { type FastifyRequest } from 'fastify';
import type { NoteService } from './note-service';
import type { NoteRecord } from './note-repository';
import type { AuthGuard } from '../auth/auth-guard';

// 1.22.3: a meeting's notes list names the task each note became by its number (`taskKey`), resolved
// from the task itself, so the page shows "MICO-142" instead of the word "Task" — also for a note whose
// task has no action item. An additive field: `taskId` and the rest stay as they were. (An invitee from
// another company is refused the notes altogether — fullViewOrInviteeRefusal — so sees no numbers.)
const note = (id: string, taskId: string | null): NoteRecord => ({
  id, meetingId: 'm1', agendaItemId: null, authorId: 'u1', type: 'ACTION', body: id, bodyFormat: 'PLAIN', highlighted: false,
  taskId, actionItemId: null, decisionId: null, createdAt: new Date('2026-11-04T06:00:00Z'), editedAt: null,
});
const notes = [note('n1', 't1'), note('n2', null), note('n3', 'gone')];
const noteService = { listNotes: async () => notes, canEditMeeting: async () => true } as unknown as NoteService;
const guard: AuthGuard = {
  authenticate: async (req: FastifyRequest) => { (req as unknown as { user: { id: string; roles: string[] } }).user = { id: 'u1', roles: ['EMPLOYEE'] }; },
} as unknown as AuthGuard;

async function app(extra: Partial<Parameters<typeof registerNoteRoutes>[1]> = {}) {
  const a = Fastify();
  await registerNoteRoutes(a, { noteService, guard, ...extra });
  return a;
}

describe('GET /meetings/:id/notes — the task number of each note’s task', () => {
  it('adds taskKey from the task (null without a task, or when the task is gone)', async () => {
    const a = await app({ resolveTaskKeys: async (ids) => (expect(ids).toEqual(['t1', 'gone']), { t1: 'MICO-142' }) });
    const rows = (await a.inject({ method: 'GET', url: '/meetings/m1/notes' })).json().data;
    expect(rows.map((n: { id: string; taskId: string | null; taskKey: string | null }) => [n.id, n.taskId, n.taskKey])).toEqual([
      ['n1', 't1', 'MICO-142'],
      ['n2', null, null],
      ['n3', 'gone', null],
    ]);
  });

  it('without a resolver (older wiring) every taskKey is null, the list unchanged otherwise', async () => {
    const a = await app();
    const rows = (await a.inject({ method: 'GET', url: '/meetings/m1/notes' })).json().data;
    expect(rows.map((n: { taskKey: string | null }) => n.taskKey)).toEqual([null, null, null]);
    expect(rows[0]).toMatchObject({ id: 'n1', taskId: 't1', body: 'n1' });
  });
});
