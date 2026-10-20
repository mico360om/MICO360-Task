import { describe, it, expect, vi } from 'vitest';
import { createNoteTaskService } from './note-task-service';

// Minimal fakes for the collaborating services the note→task flow composes.
function fakes(meeting: { id: string; title: string; projectId: string | null }) {
  const note = { id: 'n1', meetingId: meeting.id, body: 'Draft the Q4 OKRs and circulate them widely', type: 'ACTION', taskId: null as string | null };
  const noteService = {
    getNote: vi.fn(async (mid: string, nid: string) => {
      if (mid !== meeting.id || nid !== note.id) throw new Error('not found');
      return { ...note } as never;
    }),
    // Mirrors the repository's conditional update: only a note without a task can be claimed.
    claimForTask: vi.fn(async () => {
      if (note.taskId) throw Object.assign(new Error('A task has already been created from this note.'), { status: 409 });
      note.taskId = 'pending:x';
      return 'pending:x';
    }),
    releaseTaskClaim: vi.fn(async (_nid: string, claim: string) => {
      if (note.taskId === claim) note.taskId = null;
    }),
    linkTask: vi.fn(async (_mid: string, nid: string, taskId: string) => {
      note.taskId = taskId;
      return { ...note } as never;
    }),
  };
  const meetingService = { getMeeting: vi.fn(async () => meeting as never) };
  const created: Record<string, unknown>[] = [];
  const taskService = {
    createTask: vi.fn(async (input: Record<string, unknown>) => {
      const t = { id: `t${created.length + 1}`, key: 'MICO-9', ...input };
      created.push(t);
      return t as never;
    }),
  };
  const columnService = {
    listColumns: vi.fn(async (projectId: string) => [
      { id: 'c-done', projectId, name: 'Done', category: 'DONE', position: 2, enabled: true },
      { id: 'c-todo', projectId, name: 'To Do', category: 'TODO', position: 0, enabled: true },
      { id: 'c-doing', projectId, name: 'Doing', category: 'IN_PROGRESS', position: 1, enabled: false },
    ] as never),
  };
  return { note, noteService, meetingService, taskService, columnService };
}

describe('createTaskFromNote — formatted notes', () => {
  it('names the task and describes it with the note’s words, not its markup', async () => {
    const f = fakes({ id: 'm1', title: 'Q4 Planning', projectId: 'p1' });
    Object.assign(f.note, { body: '<p><strong>Book</strong> the scaffolding inspection</p><ul><li><p>East side first</p></li></ul>', bodyFormat: 'RICH' });
    const svc = createNoteTaskService(f as never);
    const { task } = await svc.createTaskFromNote('m1', 'n1', 'u1', {});
    expect((task as { title: string }).title).toBe('Book the scaffolding inspection');
    expect((task as { description: string }).description).toMatch(/^Book the scaffolding inspection\n- East side first\n\n— From the/);
  });
});

describe('createTaskFromNote', () => {
  it('creates a task in the meeting project’s first enabled column and back-links the note', async () => {
    const f = fakes({ id: 'm1', title: 'Q4 Planning', projectId: 'p1' });
    const svc = createNoteTaskService(f as never);
    const { task, note } = await svc.createTaskFromNote('m1', 'n1', 'u1', {});
    // default column = lowest-position ENABLED column (To Do @0), not Done@2 and not disabled Doing
    expect(f.taskService.createTask).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'p1', columnId: 'c-todo', createdById: 'u1' }));
    // title derived from the note body
    expect((task as { title: string }).title).toMatch(/Draft the Q4 OKRs/);
    // note now points at the task
    expect(note.taskId).toBe((task as { id: string }).id);
    expect(f.noteService.linkTask).toHaveBeenCalledWith('m1', 'n1', (task as { id: string }).id);
  });

  it('records the meeting on the task, so the task links back to it', async () => {
    const f = fakes({ id: 'm1', title: 'Q4 Planning', projectId: 'p1' });
    const svc = createNoteTaskService(f as never);
    await svc.createTaskFromNote('m1', 'n1', 'u1', {});
    expect(f.taskService.createTask).toHaveBeenCalledWith(expect.objectContaining({ meetingId: 'm1' }));
    // Also when the task goes to a project other than the meeting's.
    const g = fakes({ id: 'm2', title: 'Standalone', projectId: null });
    await createNoteTaskService(g as never).createTaskFromNote('m2', 'n1', 'u1', { projectId: 'p9' });
    expect(g.taskService.createTask).toHaveBeenCalledWith(expect.objectContaining({ meetingId: 'm2', projectId: 'p9' }));
  });

  it('honors explicit overrides (title, project, column, priority, dueDate)', async () => {
    const f = fakes({ id: 'm1', title: 'Q4 Planning', projectId: 'p1' });
    const svc = createNoteTaskService(f as never);
    await svc.createTaskFromNote('m1', 'n1', 'u1', {
      title: 'Custom title', projectId: 'p2', columnId: 'c-doing', priority: 'HIGH', dueDate: '2026-11-01T00:00:00.000Z',
    });
    expect(f.taskService.createTask).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Custom title', projectId: 'p2', columnId: 'c-doing', priority: 'HIGH',
    }));
    const arg = f.taskService.createTask.mock.calls[0]![0] as { dueDate: Date };
    expect(arg.dueDate).toBeInstanceOf(Date);
  });

  it('requires a project when the meeting is standalone and none is given', async () => {
    const f = fakes({ id: 'm1', title: 'Standalone Sync', projectId: null });
    const svc = createNoteTaskService(f as never);
    await expect(svc.createTaskFromNote('m1', 'n1', 'u1', {})).rejects.toThrow(/project/i);
    // but succeeds when a project is chosen
    const { task } = await svc.createTaskFromNote('m1', 'n1', 'u1', { projectId: 'p9' });
    expect((task as { projectId: string }).projectId).toBe('p9');
  });

  it('assigns the task when an assignee is given and an assignee service is wired', async () => {
    const f = fakes({ id: 'm1', title: 'Q4 Planning', projectId: 'p1' });
    const assignUsers = vi.fn(async () => []);
    const svc = createNoteTaskService({ ...f, assignees: { assignUsers } } as never);
    const { task } = await svc.createTaskFromNote('m1', 'n1', 'u1', { assigneeId: 'u2' });
    expect(assignUsers).toHaveBeenCalledWith((task as { id: string }).id, ['u2'], 'u1');
  });

  it('rejects a column from another project’s board (400) without creating anything', async () => {
    const f = fakes({ id: 'm1', title: 'Q4 Planning', projectId: 'p1' });
    const svc = createNoteTaskService(f as never);
    await expect(svc.createTaskFromNote('m1', 'n1', 'u1', { columnId: 'someone-elses-column' })).rejects.toThrow(/column/i);
    expect(f.taskService.createTask).not.toHaveBeenCalled();
    expect(f.note.taskId).toBeNull();
  });

  it('refuses to convert the same note twice (409) — no duplicate task', async () => {
    const f = fakes({ id: 'm1', title: 'Q4 Planning', projectId: 'p1' });
    const svc = createNoteTaskService(f as never);
    await svc.createTaskFromNote('m1', 'n1', 'u1', {});
    await expect(svc.createTaskFromNote('m1', 'n1', 'u2', {})).rejects.toMatchObject({ status: 409 });
    expect(f.taskService.createTask).toHaveBeenCalledTimes(1);
  });

  it('checks access to the meeting’s own project, not only an explicitly chosen one', async () => {
    const f = fakes({ id: 'm1', title: 'Board sync', projectId: 'secret' });
    const svc = createNoteTaskService(f as never);
    const canUseProject = vi.fn(async (projectId: string) => projectId !== 'secret');
    await expect(svc.createTaskFromNote('m1', 'n1', 'u1', {}, { canUseProject })).rejects.toMatchObject({ status: 403 });
    expect(canUseProject).toHaveBeenCalledWith('secret');
    expect(f.taskService.createTask).not.toHaveBeenCalled();
  });

  it('releases the claim when the task cannot be created, so the note can be retried', async () => {
    const f = fakes({ id: 'm1', title: 'Q4 Planning', projectId: 'p1' });
    f.taskService.createTask.mockRejectedValueOnce(new Error('db down'));
    const svc = createNoteTaskService(f as never);
    await expect(svc.createTaskFromNote('m1', 'n1', 'u1', {})).rejects.toThrow('db down');
    expect(f.note.taskId).toBeNull();
    const { note } = await svc.createTaskFromNote('m1', 'n1', 'u1', {});
    expect((note as { taskId: string }).taskId).toMatch(/^t/);
  });

  it('keeps the task linked when assignment fails, reporting the assignment error', async () => {
    const f = fakes({ id: 'm1', title: 'Q4 Planning', projectId: 'p1' });
    const assignUsers = vi.fn(async () => { throw new Error('Assignees must be project members.'); });
    const svc = createNoteTaskService({ ...f, assignees: { assignUsers } } as never);
    const res = await svc.createTaskFromNote('m1', 'n1', 'u1', { assigneeId: 'outsider' });
    expect(res.assigneeError).toMatch(/project members/);
    expect(f.note.taskId).toBe((res.task as { id: string }).id);
  });

  describe('an action-item note', () => {
    function withActionItems(f: ReturnType<typeof fakes>) {
      const addItem = vi.fn(async (_meetingId: string | null, _by: string, input: Record<string, unknown>) => ({ id: 'ai1', ...input }) as never);
      return { addItem, svc: createNoteTaskService({ ...f, actionItems: { addItem } } as never) };
    }

    it('is tracked as an action item linked to the new task, with its owner, due date and priority', async () => {
      const f = fakes({ id: 'm1', title: 'Q4 Planning', projectId: 'p1' });
      const { addItem, svc } = withActionItems(f);
      const res = await svc.createTaskFromNote('m1', 'n1', 'u1', { title: 'Draft the OKRs', assigneeId: 'u2', priority: 'HIGH', dueDate: '2026-11-01T00:00:00.000Z' });
      const taskId = (res.task as { id: string }).id;
      expect(addItem).toHaveBeenCalledWith('m1', 'u1', expect.objectContaining({
        description: 'Draft the OKRs', assigneeId: 'u2', priority: 'HIGH', sourceNoteId: 'n1', projectId: 'p1', taskId,
      }));
      const due = (addItem.mock.calls[0]![2] as { dueDate: Date }).dueDate;
      expect(due.toISOString()).toBe('2026-11-01T00:00:00.000Z');
      // The note points at both, so neither can be created twice.
      expect(f.noteService.linkTask).toHaveBeenCalledWith('m1', 'n1', taskId, 'ai1');
      expect(res.actionItem).toMatchObject({ id: 'ai1', taskId });
    });

    it('only for action notes — a decision becomes a task without an action item', async () => {
      const f = fakes({ id: 'm1', title: 'Q4 Planning', projectId: 'p1' });
      f.note.type = 'DECISION';
      const { addItem, svc } = withActionItems(f);
      const res = await svc.createTaskFromNote('m1', 'n1', 'u1', {});
      expect(addItem).not.toHaveBeenCalled();
      expect(res.actionItem).toBeUndefined();
    });

    it('keeps the task when the action item can’t be saved, and says so', async () => {
      const f = fakes({ id: 'm1', title: 'Q4 Planning', projectId: 'p1' });
      const { addItem, svc } = withActionItems(f);
      addItem.mockRejectedValueOnce(new Error('db down'));
      const res = await svc.createTaskFromNote('m1', 'n1', 'u1', {});
      expect(f.note.taskId).toBe((res.task as { id: string }).id);
      expect(res.actionItemError).toMatch(/action item/i);
    });
  });
});
