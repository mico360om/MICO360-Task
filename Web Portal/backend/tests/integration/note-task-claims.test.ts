import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { createNoteService, TASK_CLAIM_PREFIX, type NoteService } from '../../src/modules/meetings/note-service';
import { createPrismaNoteRepository } from '../../src/modules/meetings/prisma-note-repository';
import { createNoteTaskService } from '../../src/modules/meetings/note-task-service';
import { NotFoundError } from '../../src/lib/http-errors';
import { newRowId } from '../../src/lib/row-id';
import { createPrismaTaskRepository } from '../../src/modules/tasks/prisma-task-repository';

// Requires a running MySQL or MariaDB (TEST_DATABASE_URL) with migrations applied.
// Review fix #19 + N12 (batch 4b), from verify35/repro/E/note-task-repro.ts: turning a note into a task left
// "pending:<uuid>" in meeting_notes.taskId when the link write failed after the task was saved, and every retry
// got 409 — the note was stuck for good (and the website showed the pending value as a task link).
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const tag = randomBytes(3).toString('hex');
let userId = '';
let meetingId = '';

beforeAll(async () => {
  await prisma.$connect();
  userId = (await prisma.user.create({ data: { email: `n19-${tag}@sb4b.test`, username: `n19${tag}`, passwordHash: 'x', firstName: 'Nadia', lastName: 'Test' } })).id;
  meetingId = (await prisma.meeting.create({ data: { title: 'Site plan', organizerId: userId, createdById: userId, startAt: new Date(), projectId: null } })).id;
});

afterAll(async () => {
  await prisma.meeting.deleteMany({ where: { id: meetingId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

const note = async () => (await prisma.meetingNote.create({ data: { meetingId, authorId: userId, body: `Order the pumps ${randomUUID().slice(0, 6)}`, type: 'DISCUSSION' } })).id;
const rawTaskId = async (id: string) => (await prisma.meetingNote.findUnique({ where: { id }, select: { taskId: true } }))?.taskId ?? null;

/** The real note service on the database; a stand-in task service that keeps the tasks it made (by id). */
function world(opts: { failLinkOnce?: boolean; failAfterSaveOnce?: boolean; now?: () => Date } = {}) {
  const real = createNoteService({ notes: createPrismaNoteRepository(prisma), ...(opts.now ? { now: opts.now } : {}) });
  let failLink = opts.failLinkOnce ?? false;
  let failAfterSave = opts.failAfterSaveOnce ?? false;
  const noteService: NoteService = {
    ...real,
    linkTask: async (...a: Parameters<NoteService['linkTask']>) => {
      if (failLink) {
        failLink = false;
        throw new Error("Simulated: Can't reach database server");
      }
      return real.linkTask(...a);
    },
  };
  const tasks = new Map<string, { id: string; title: string; dueDate: null }>();
  const svc = createNoteTaskService({
    noteService,
    meetingService: { getMeeting: async () => ({ id: meetingId, title: 'Site plan', projectId: null }) },
    taskService: {
      createTask: async (input: { id?: string; title: string }) => {
        const t = { id: input.id ?? `task-${randomUUID()}`, title: input.title, dueDate: null };
        tasks.set(t.id, t);
        if (failAfterSave) {
          // N12: the task is saved, then a step after it fails (the request answers an error).
          failAfterSave = false;
          throw new Error('Simulated: a step after saving the task failed');
        }
        return t as never;
      },
      getTask: async (id: string) => {
        const t = tasks.get(id);
        if (!t) throw new NotFoundError('Task not found.');
        return t as never;
      },
    },
    columnService: { listColumns: async () => [{ id: 'c1', position: 0, enabled: true }] },
  });
  return { svc, tasks, noteService };
}
const convert = (svc: ReturnType<typeof world>['svc'], noteId: string) => svc.createTaskFromNote(meetingId, noteId, userId, { projectId: 'p1' });

describe('#19 turning a note into a task can no longer get stuck', () => {
  it('the repro: the link write fails after the task was saved — the retry links THAT task (no 409, no second task)', async () => {
    const id = await note();
    const w = world({ failLinkOnce: true });
    await expect(convert(w.svc, id)).rejects.toThrow(/Can't reach database server/);
    expect(w.tasks.size).toBe(1);
    // Never shown as a task link while it is unfinished.
    expect((await w.noteService.getNote(meetingId, id)).taskId).toBeNull();
    expect((await w.noteService.listNotes(meetingId)).find((n) => n.id === id)?.taskId).toBeNull();
    const retry = await convert(w.svc, id);
    expect(w.tasks.size).toBe(1);
    expect(retry.task.id).toBe([...w.tasks.keys()][0]);
    expect(retry.note.taskId).toBe(retry.task.id);
    expect(await rawTaskId(id)).toBe(retry.task.id);
    // Done: a further try is the usual "already has a task".
    await expect(convert(w.svc, id)).rejects.toMatchObject({ code: 'NOTE_HAS_TASK' });
  });

  it('N12: a step after saving the task fails — no duplicate: the same task is linked', async () => {
    const id = await note();
    const w = world({ failAfterSaveOnce: true });
    const result = await convert(w.svc, id).catch(() => convert(w.svc, id));
    expect(w.tasks.size).toBe(1);
    expect(result.task.id).toBe([...w.tasks.keys()][0]);
    expect(await rawTaskId(id)).toBe(result.task.id);
  });

  it('a claim from before this version ("pending:<uuid>", its task never made) is taken over: the note converts', async () => {
    const id = await note();
    await prisma.meetingNote.update({ where: { id }, data: { taskId: `${TASK_CLAIM_PREFIX}${randomUUID()}` } });
    const w = world();
    expect((await w.noteService.getNote(meetingId, id)).taskId).toBeNull();
    const done = await convert(w.svc, id);
    expect(w.tasks.size).toBe(1);
    expect(await rawTaskId(id)).toBe(done.task.id);
  });

  it('a conversion still under way (a fresh claim, its task not made yet) is refused; after 10 minutes the claim times out', async () => {
    const id = await note();
    let clock = Date.parse('2026-11-13T09:00:00.000Z');
    const now = () => new Date(clock);
    const first = world({ now });
    await first.noteService.claimForTask(meetingId, id); // a request that stopped before making its task
    const w = world({ now });
    clock += 60_000;
    await expect(convert(w.svc, id)).rejects.toMatchObject({ code: 'NOTE_HAS_TASK', status: 409 });
    expect(w.tasks.size).toBe(0);
    clock += 10 * 60_000;
    const done = await convert(w.svc, id);
    expect(w.tasks.size).toBe(1);
    expect(await rawTaskId(id)).toBe(done.task.id);
  });

  it('two people converting the same note at once make one task', async () => {
    const id = await note();
    const w = world();
    const results = await Promise.allSettled([convert(w.svc, id), convert(w.svc, id), convert(w.svc, id)]);
    expect(w.tasks.size).toBe(1);
    const ok = results.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof convert>>>[];
    expect(ok.length).toBeGreaterThanOrEqual(1);
    for (const r of ok) expect(r.value.task.id).toBe([...w.tasks.keys()][0]);
    for (const r of results) if (r.status === 'rejected') expect(r.reason).toMatchObject({ code: 'NOTE_HAS_TASK' });
    expect(await rawTaskId(id)).toBe([...w.tasks.keys()][0]);
  });

  it('the real task store keeps the id the claim named (so a retry finds the task)', async () => {
    const owner = await prisma.user.create({ data: { email: `n19o-${tag}@sb4b.test`, username: `n19o${tag}`, passwordHash: 'x', firstName: 'Omar', lastName: 'Test' } });
    const code = `N${tag}`.slice(0, 7).toUpperCase();
    const project = await prisma.project.create({ data: { code, name: 'Northwind pumps', createdById: owner.id, ownerId: owner.id } });
    const col = await prisma.kanbanColumn.create({ data: { projectId: project.id, name: 'To do', category: 'TODO', position: 0 } });
    try {
      const id = newRowId();
      const t = await createPrismaTaskRepository(prisma).create({ id, key: `${code}-1`, title: 'Order the pumps', projectId: project.id, columnId: col.id, createdById: owner.id });
      expect(t.id).toBe(id);
      expect((await prisma.task.findUnique({ where: { id } }))?.title).toBe('Order the pumps');
    } finally {
      await prisma.task.deleteMany({ where: { projectId: project.id } });
      await prisma.kanbanColumn.deleteMany({ where: { projectId: project.id } });
      await prisma.project.deleteMany({ where: { id: project.id } });
      await prisma.user.deleteMany({ where: { id: owner.id } });
    }
  });

  it('the read-only phpMyAdmin check for stuck notes finds exactly the unfinished ones', async () => {
    const stuck = await note();
    await prisma.meetingNote.update({ where: { id: stuck }, data: { taskId: `${TASK_CLAIM_PREFIX}${randomUUID()}` } });
    const rows = await prisma.$queryRawUnsafe<{ id: string }[]>("SELECT id, meetingId, taskId FROM meeting_notes WHERE taskId LIKE 'pending:%' AND deletedAt IS NULL");
    expect(rows.map((r) => r.id)).toContain(stuck);
    for (const r of rows) expect(await rawTaskId(r.id)).toMatch(/^pending:/);
  });
});
