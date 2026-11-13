import { describe, it, expect, vi } from 'vitest';
import { createNoteTaskService } from './note-task-service';
import { NotFoundError } from '../../lib/http-errors';

// Minimal fakes for the collaborating services the note→task flow composes.
function fakes(meeting: { id: string; title: string; projectId: string | null }) {
  const note = { id: 'n1', meetingId: meeting.id, body: 'Draft the Q4 OKRs and circulate them widely', type: 'ACTION', taskId: null as string | null };
  let claims = 0;
  const noteService = {
    getNote: vi.fn(async (mid: string, nid: string) => {
      if (mid !== meeting.id || nid !== note.id) throw new Error('not found');
      // As the note service: a claim is never shown as the note's task.
      return { ...note, taskId: note.taskId?.startsWith('pending:') ? null : note.taskId } as never;
    }),
    // Mirrors the repository's conditional update: only a note without a task can be claimed.
    claimForTask: vi.fn(async (_mid: string, _nid: string, _opts?: { taskExists?: (id: string) => Promise<boolean> }) => {
      if (note.taskId) throw Object.assign(new Error('A task has already been created from this note.'), { status: 409 });
      claims += 1;
      note.taskId = `pending:1:claimed${claims}`;
      return { marker: note.taskId, taskId: `claimed${claims}`, made: false };
    }),
    releaseTaskClaim: vi.fn(async (_nid: string, claim: string) => {
      if (note.taskId === claim) note.taskId = null;
    }),
    linkTask: vi.fn(async (_mid: string, nid: string, taskId: string, _actionItemId?: string, _claim?: string) => {
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
    expect(f.noteService.linkTask).toHaveBeenCalledWith('m1', 'n1', (task as { id: string }).id, undefined, 'pending:1:claimed1');
    // The task gets the id its claim named (review fix #19: a retry can find it).
    expect((task as { id: string }).id).toBe('claimed1');
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
    expect((note as { taskId: string }).taskId).toBe('claimed2');
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
      expect(f.noteService.linkTask).toHaveBeenCalledWith('m1', 'n1', taskId, 'ai1', 'pending:1:claimed1');
      expect(res.actionItem).toMatchObject({ id: 'ai1', taskId });
    });

    it('takes the task’s due date when the note had none (a project whose new tasks are due today)', async () => {
      const f = fakes({ id: 'm1', title: 'Q4 Planning', projectId: 'p1' });
      // The task service gives an undated task today's date in such a project.
      f.taskService.createTask.mockImplementationOnce(async (input: Record<string, unknown>) => ({ id: 't1', key: 'MICO-9', ...input, dueDate: new Date('2026-10-23T00:00:00.000Z') }) as never);
      const { addItem, svc } = withActionItems(f);
      await svc.createTaskFromNote('m1', 'n1', 'u1', {});
      expect(f.taskService.createTask.mock.calls[0]![0]).not.toHaveProperty('dueDate');
      expect((addItem.mock.calls[0]![2] as { dueDate: Date | null }).dueDate?.toISOString()).toBe('2026-10-23T00:00:00.000Z');
    });

    it('1.23.0: takes the note’s topic (none when the note has none)', async () => {
      const f = fakes({ id: 'm1', title: 'Q4 Planning', projectId: 'p1' });
      (f.note as Record<string, unknown>).agendaItemId = 'a1';
      const { addItem, svc } = withActionItems(f);
      await svc.createTaskFromNote('m1', 'n1', 'u1', {});
      expect(addItem.mock.calls[0]![2]).toMatchObject({ agendaItemId: 'a1' });
      const g = fakes({ id: 'm1', title: 'Q4 Planning', projectId: 'p1' });
      const second = withActionItems(g);
      await second.svc.createTaskFromNote('m1', 'n1', 'u1', {});
      expect(second.addItem.mock.calls[0]![2]).toMatchObject({ agendaItemId: null });
    });

    it('1.23.0: a note whose topic was refused (not this meeting’s) still gets its action item, with no topic', async () => {
      const f = fakes({ id: 'm1', title: 'Q4 Planning', projectId: 'p1' });
      (f.note as Record<string, unknown>).agendaItemId = 'elsewhere';
      const { ValidationError } = await import('../../lib/http-errors');
      const addItem = vi.fn(async (_m: string | null, _b: string, input: Record<string, unknown>) => {
        if (input.agendaItemId) throw new ValidationError('That topic is not on this meeting’s agenda.');
        return { id: 'ai1', ...input } as never;
      });
      const svc = createNoteTaskService({ ...f, actionItems: { addItem } } as never);
      const res = await svc.createTaskFromNote('m1', 'n1', 'u1', {});
      expect(res.actionItem).toMatchObject({ id: 'ai1', agendaItemId: null });
      expect(res.actionItemError).toBeUndefined();
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

describe('review fix #19 / N12: an interrupted conversion is finished, never repeated', () => {
  function resumable(f: ReturnType<typeof fakes>) {
    const tasks = new Map<string, Record<string, unknown>>();
    f.taskService.createTask.mockImplementation(async (input: Record<string, unknown>) => {
      const t = { key: 'MICO-9', ...input };
      tasks.set(input.id as string, t);
      return t as never;
    });
    const getTask = vi.fn(async (id: string) => {
      const t = tasks.get(id);
      if (!t) throw new NotFoundError('Task not found.');
      return t as never;
    });
    // As the real note service: a claim whose task exists comes back `made`.
    f.noteService.claimForTask.mockImplementation(async (_m: string, _n: string, opts?: { taskExists?: (id: string) => Promise<boolean> }) => {
      const claimed = f.note.taskId?.startsWith('pending:') ? f.note.taskId.split(':')[2]! : null;
      if (claimed && opts?.taskExists && (await opts.taskExists(claimed))) return { marker: f.note.taskId!, taskId: claimed, made: true } as never;
      if (f.note.taskId) throw Object.assign(new Error('A task has already been created from this note.'), { status: 409 });
      f.note.taskId = 'pending:1:fixed';
      return { marker: 'pending:1:fixed', taskId: 'fixed', made: false } as never;
    });
    const items: Record<string, unknown>[] = [];
    const addItem = vi.fn(async (_m: string | null, _by: string, input: Record<string, unknown>) => {
      const item = { id: `ai${items.length + 1}`, ...input };
      items.push(item);
      return item as never;
    });
    const listByMeeting = vi.fn(async () => items as never);
    return { tasks, items, addItem, svc: createNoteTaskService({ ...f, taskService: { ...f.taskService, getTask }, actionItems: { addItem, listByMeeting } } as never) };
  }

  it('the link failed after the task and its action item were saved: the retry links that task and that item', async () => {
    const f = fakes({ id: 'm1', title: 'Q4 Planning', projectId: 'p1' });
    const r = resumable(f);
    f.noteService.linkTask.mockRejectedValueOnce(new Error("Can't reach database server"));
    await expect(r.svc.createTaskFromNote('m1', 'n1', 'u1', {})).rejects.toThrow(/reach database/);
    const res = await r.svc.createTaskFromNote('m1', 'n1', 'u1', {});
    expect(f.taskService.createTask).toHaveBeenCalledTimes(1);
    expect(r.addItem).toHaveBeenCalledTimes(1);
    expect((res.task as { id: string }).id).toBe('fixed');
    expect(res.actionItem).toMatchObject({ id: 'ai1', taskId: 'fixed' });
    expect(f.noteService.linkTask).toHaveBeenLastCalledWith('m1', 'n1', 'fixed', 'ai1', 'pending:1:fixed');
    expect(f.note.taskId).toBe('fixed');
  });

  it('N12: the task was saved but its create failed after: that task is used — one task, linked', async () => {
    const f = fakes({ id: 'm1', title: 'Q4 Planning', projectId: 'p1' });
    const r = resumable(f);
    const saveThenFail = f.taskService.createTask.getMockImplementation()!;
    f.taskService.createTask.mockImplementationOnce(async (input: Record<string, unknown>) => {
      await saveThenFail(input);
      throw new Error('a step after saving failed');
    });
    const res = await r.svc.createTaskFromNote('m1', 'n1', 'u1', {});
    expect(r.tasks.size).toBe(1);
    expect((res.task as { id: string }).id).toBe('fixed');
    expect(f.note.taskId).toBe('fixed');
    expect(f.noteService.releaseTaskClaim).not.toHaveBeenCalled();
  });

  it('review M3: a retry by someone who may not use the earlier task’s project links the note but never shows them that task', async () => {
    const f = fakes({ id: 'm1', title: 'Q4 Planning', projectId: null });
    const r = resumable(f);
    f.noteService.linkTask.mockRejectedValueOnce(new Error("Can't reach database server"));
    await expect(r.svc.createTaskFromNote('m1', 'n1', 'u1', { projectId: 'p-secret' })).rejects.toThrow(/reach database/);
    const assignUsers = vi.fn();
    const other = createNoteTaskService({ ...f, taskService: { ...f.taskService, getTask: async (id: string) => r.tasks.get(id) as never }, assignees: { assignUsers } } as never);
    const canUseProject = vi.fn(async (projectId: string) => projectId !== 'p-secret');
    await expect(other.createTaskFromNote('m1', 'n1', 'u2', { projectId: 'p-mine', assigneeId: 'u2' }, { canUseProject })).rejects.toMatchObject({ code: 'NOTE_HAS_TASK', status: 409 });
    expect(canUseProject).toHaveBeenCalledWith('p-secret');
    expect(f.note.taskId).toBe('fixed'); // the note points at its task all the same
    expect(assignUsers).not.toHaveBeenCalled();
    expect(f.taskService.createTask).toHaveBeenCalledTimes(1);
  });

  it('review M4: a resumed action note whose item was never made says so (no second item is guessed at)', async () => {
    const f = fakes({ id: 'm1', title: 'Q4 Planning', projectId: 'p1' });
    const r = resumable(f);
    r.addItem.mockRejectedValueOnce(new Error('db down'));
    f.noteService.linkTask.mockRejectedValueOnce(new Error("Can't reach database server"));
    await expect(r.svc.createTaskFromNote('m1', 'n1', 'u1', {})).rejects.toThrow(/reach database/);
    const res = await r.svc.createTaskFromNote('m1', 'n1', 'u1', {});
    expect((res.task as { id: string }).id).toBe('fixed');
    expect(res.actionItem).toBeUndefined();
    expect(res.actionItemError).toMatch(/action items/i);
    expect(r.addItem).toHaveBeenCalledTimes(1);
  });

  it('a create that failed with nothing saved gives the claim back (the note can be tried again)', async () => {
    const f = fakes({ id: 'm1', title: 'Q4 Planning', projectId: 'p1' });
    const r = resumable(f);
    f.taskService.createTask.mockRejectedValueOnce(new Error('db down'));
    await expect(r.svc.createTaskFromNote('m1', 'n1', 'u1', {})).rejects.toThrow('db down');
    expect(f.noteService.releaseTaskClaim).toHaveBeenCalledWith('n1', 'pending:1:fixed');
    expect(f.note.taskId).toBeNull();
  });
});
