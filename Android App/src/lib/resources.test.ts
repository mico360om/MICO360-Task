import { describe, it, expect } from 'vitest';
import { resourcesApi, AI_DESCRIPTION_MAX, AI_MINUTES_TIMEOUT_MS, AI_TIMEOUT_MS, SEND_TIMEOUT_MS } from './resources';
import type { ApiClient } from './api-client';

/** A fake client that records every call and returns a benign envelope. */
function fakeClient() {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const client = {
    get: (path: string) => { calls.push({ method: 'GET', path }); return Promise.resolve({ data: [] }); },
    post: (path: string, body?: unknown) => { calls.push({ method: 'POST', path, body }); return Promise.resolve({ data: {} }); },
    put: (path: string, body?: unknown) => { calls.push({ method: 'PUT', path, body }); return Promise.resolve({ data: [] }); },
    patch: (path: string, body?: unknown) => { calls.push({ method: 'PATCH', path, body }); return Promise.resolve({ data: {} }); },
    del: (path: string) => { calls.push({ method: 'DELETE', path }); return Promise.resolve(undefined); },
    upload: (path: string, form: FormData) => { calls.push({ method: 'UPLOAD', path, body: form }); return Promise.resolve({ data: { id: 'a1' } }); },
  } as unknown as ApiClient;
  return { client, calls };
}

describe('resourcesApi.tasks', () => {
  it('POSTs /tasks with the create body including tags', async () => {
    const { client, calls } = fakeClient();
    await resourcesApi(client).tasks.create({ title: 'X', projectId: 'p1', columnId: 'c1', priority: 'HIGH', estimatedHours: 3, tags: ['urgent'] });
    expect(calls[0]).toEqual({ method: 'POST', path: '/tasks', body: { title: 'X', projectId: 'p1', columnId: 'c1', priority: 'HIGH', estimatedHours: 3, tags: ['urgent'] } });
  });

  it('PUTs /tasks/:id with an estimatedHours patch', async () => {
    const { client, calls } = fakeClient();
    await resourcesApi(client).tasks.update('t1', { estimatedHours: 5, dueDate: '2026-09-10' });
    expect(calls[0]).toEqual({ method: 'PUT', path: '/tasks/t1', body: { estimatedHours: 5, dueDate: '2026-09-10' } });
  });

  it('PUTs /tasks/:id with an "entire series" edit scope for a recurring task', async () => {
    const { client, calls } = fakeClient();
    await resourcesApi(client).tasks.update('t1', { priority: 'URGENT', scope: 'series' });
    expect(calls[0]).toEqual({ method: 'PUT', path: '/tasks/t1', body: { priority: 'URGENT', scope: 'series' } });
  });

  it('PATCHes /tasks/:id/move with column + position', async () => {
    const { client, calls } = fakeClient();
    await resourcesApi(client).tasks.move('t1', 'c2', 3);
    expect(calls[0]).toEqual({ method: 'PATCH', path: '/tasks/t1/move', body: { columnId: 'c2', position: 3 } });
  });

  it('reads, replaces and detaches task tags', async () => {
    const { client, calls } = fakeClient();
    const api = resourcesApi(client).tasks;
    await api.tags('t1');
    await api.setTags('t1', ['a', 'b']);
    await api.removeTag('t1', 'tag9');
    expect(calls[0]).toMatchObject({ method: 'GET', path: '/tasks/t1/tags' });
    expect(calls[1]).toEqual({ method: 'PUT', path: '/tasks/t1/tags', body: { tags: ['a', 'b'] } });
    expect(calls[2]).toMatchObject({ method: 'DELETE', path: '/tasks/t1/tags/tag9' });
  });

  it('reads the shared tag catalog', async () => {
    const { client, calls } = fakeClient();
    await resourcesApi(client).tagCatalog();
    expect(calls[0]).toMatchObject({ method: 'GET', path: '/tags' });
  });

  it('POSTs /tasks with assigneeIds when creating and assigning at once', async () => {
    const { client, calls } = fakeClient();
    await resourcesApi(client).tasks.create({ title: 'X', projectId: 'p1', columnId: 'c1', assigneeIds: ['u1', 'u2'] });
    expect(calls[0]).toEqual({ method: 'POST', path: '/tasks', body: { title: 'X', projectId: 'p1', columnId: 'c1', assigneeIds: ['u1', 'u2'] } });
  });

  it('lists, assigns and unassigns task assignees', async () => {
    const { client, calls } = fakeClient();
    const api = resourcesApi(client).tasks;
    await api.assignees('t1');
    await api.assign('t1', ['u1', 'u2']);
    await api.unassign('t1', 'u2');
    expect(calls[0]).toMatchObject({ method: 'GET', path: '/tasks/t1/assignees' });
    expect(calls[1]).toEqual({ method: 'POST', path: '/tasks/t1/assignees', body: { userIds: ['u1', 'u2'] } });
    expect(calls[2]).toMatchObject({ method: 'DELETE', path: '/tasks/t1/assignees/u2' });
  });

  it('reads project members (the assignable pool)', async () => {
    const { client, calls } = fakeClient();
    await resourcesApi(client).projects.members('p1');
    expect(calls[0]).toMatchObject({ method: 'GET', path: '/projects/p1/members' });
  });

  it('lists tasks with combined filter + sort query params', async () => {
    const { client, calls } = fakeClient();
    await resourcesApi(client).tasks.list({ projectId: 'p1', q: 'fix', priority: 'HIGH,URGENT', sort: 'priority', order: 'desc', overdue: true });
    expect(calls[0]!.method).toBe('GET');
    const path = calls[0]!.path;
    expect(path).toContain('projectId=p1');
    expect(path).toContain('q=fix');
    expect(path).toContain('priority=HIGH%2CURGENT');
    expect(path).toContain('sort=priority');
    expect(path).toContain('order=desc');
    expect(path).toContain('overdue=true');
  });

  it('asks for one page of tasks (a search) with limit and offset', async () => {
    const { client, calls } = fakeClient();
    await resourcesApi(client).tasks.list({ projectId: 'p1', q: 'fix', limit: 30, offset: 0 });
    expect(calls[0]!.path).toBe('/tasks?projectId=p1&q=fix&limit=30&offset=0');
  });

  it('reads per-project progress', async () => {
    const { client, calls } = fakeClient();
    await resourcesApi(client).projects.progress('p1');
    expect(calls[0]).toMatchObject({ method: 'GET', path: '/projects/p1/progress' });
  });

  it('manages a checklist: list, add, toggle/edit, reorder, remove', async () => {
    const { client, calls } = fakeClient();
    const api = resourcesApi(client).tasks;
    await api.checklist('t1');
    await api.addChecklistItem('t1', 'Do X');
    await api.updateChecklistItem('i1', { done: true });
    await api.updateChecklistItem('i1', { text: 'Do Y' });
    await api.reorderChecklist('t1', ['i2', 'i1']);
    await api.removeChecklistItem('i1');
    expect(calls[0]).toMatchObject({ method: 'GET', path: '/tasks/t1/checklist' });
    expect(calls[1]).toEqual({ method: 'POST', path: '/tasks/t1/checklist', body: { text: 'Do X' } });
    expect(calls[2]).toEqual({ method: 'PUT', path: '/checklist/i1', body: { done: true } });
    expect(calls[3]).toEqual({ method: 'PUT', path: '/checklist/i1', body: { text: 'Do Y' } });
    expect(calls[4]).toEqual({ method: 'PUT', path: '/tasks/t1/checklist/reorder', body: { orderedIds: ['i2', 'i1'] } });
    expect(calls[5]).toMatchObject({ method: 'DELETE', path: '/checklist/i1' });
  });

  it('manages comments: list, add, edit, remove', async () => {
    const { client, calls } = fakeClient();
    const api = resourcesApi(client).tasks;
    await api.comments('t1');
    await api.addComment('t1', 'hello @ada');
    await api.editComment('c1', 'edited');
    await api.removeComment('c1');
    expect(calls[0]).toMatchObject({ method: 'GET', path: '/tasks/t1/comments' });
    expect(calls[1]).toEqual({ method: 'POST', path: '/tasks/t1/comments', body: { body: 'hello @ada' } });
    expect(calls[2]).toEqual({ method: 'PUT', path: '/comments/c1', body: { body: 'edited' } });
    expect(calls[3]).toMatchObject({ method: 'DELETE', path: '/comments/c1' });
  });
});

describe('resourcesApi — attachments and notification preferences', () => {
  it('deletes a task, or a whole repeating series', async () => {
    const { client, calls } = fakeClient();
    await resourcesApi(client).tasks.remove('t1');
    await resourcesApi(client).tasks.remove('t1', 'series');
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(['DELETE /tasks/t1', 'DELETE /tasks/t1?scope=series']);
  });

  it('reads a task’s activity timeline', async () => {
    const { client, calls } = fakeClient();
    await resourcesApi(client).tasks.activity('t1');
    expect(calls[0]).toEqual({ method: 'GET', path: '/tasks/t1/activity' });
  });

  it('reads, adds and removes blockers (dependencies)', async () => {
    const { client, calls } = fakeClient();
    const api = resourcesApi(client).tasks;
    await api.dependencies('t1');
    await api.addDependency('t1', 't2');
    await api.removeDependency('t1', 't2');
    expect(calls).toEqual([
      { method: 'GET', path: '/tasks/t1/dependencies' },
      { method: 'POST', path: '/tasks/t1/dependencies', body: { dependsOnTaskId: 't2' } },
      { method: 'DELETE', path: '/tasks/t1/dependencies/t2' },
    ]);
  });

  it('watches and stops watching a task, and lists its watchers', async () => {
    const { client, calls } = fakeClient();
    const api = resourcesApi(client).tasks;
    await api.watchStatus('t1');
    await api.watch('t1');
    await api.unwatch('t1');
    await api.watchers('t1');
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(['GET /tasks/t1/watch', 'POST /tasks/t1/watch', 'DELETE /tasks/t1/watch', 'GET /tasks/t1/watchers']);
  });

  it('uploads with a progress listener', async () => {
    const seen: unknown[] = [];
    const client = { upload: (path: string, _form: FormData, opts?: { onProgress?: (f: number) => void }) => { seen.push({ path, hasProgress: typeof opts?.onProgress === 'function' }); return Promise.resolve({ data: { id: 'a1' } }); } } as unknown as ApiClient;
    await resourcesApi(client).tasks.uploadAttachment('t1', { uri: 'file:///x.txt', name: 'x.txt', type: 'text/plain' }, () => {});
    expect(seen).toEqual([{ path: '/tasks/t1/attachments', hasProgress: true }]);
  });

  it('lists, uploads (multipart "file" part) and removes task attachments', async () => {
    const { client, calls } = fakeClient();
    const api = resourcesApi(client);
    await api.tasks.attachments('t1');
    const part = { uri: 'file:///cache/scan.pdf', name: 'scan.pdf', type: 'application/pdf' };
    expect(await api.tasks.uploadAttachment('t1', part)).toEqual({ id: 'a1' });
    await api.tasks.removeAttachment('a9');
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(['GET /tasks/t1/attachments', 'UPLOAD /tasks/t1/attachments', 'DELETE /attachments/a9']);
    expect(calls[1]!.body).toBeInstanceOf(FormData);
  });

  it('reads notification preferences, and saves only what changed', async () => {
    const { client, calls } = fakeClient();
    const api = resourcesApi(client);
    await api.notifications.preferences();
    await api.preferences.save({ muted: ['MENTION'], reminderLeadMinutes: 60 });
    expect(calls).toEqual([
      { method: 'GET', path: '/notifications/preferences' },
      { method: 'PUT', path: '/notifications/preferences', body: { muted: ['MENTION'], reminderLeadMinutes: 60 } },
    ]);
  });
});

describe('resourcesApi.reports', () => {
  it('reads each report with the project / team-member filters (and the trend with its period)', async () => {
    const { client, calls } = fakeClient();
    const r = resourcesApi(client).reports;
    await r.projects({ projectId: 'p1' });
    await r.status({ userId: 'u1' });
    await r.workload({});
    await r.completion({ projectId: 'p1', userId: 'u1' });
    await r.timeseries({ projectId: 'p1', from: '2026-09-01', to: '2026-09-30' });
    expect(calls.map((c) => c.path)).toEqual([
      '/reports/projects?projectId=p1',
      '/reports/status?userId=u1',
      '/reports/workload',
      '/reports/completion?projectId=p1&userId=u1',
      '/reports/timeseries?projectId=p1&from=2026-09-01&to=2026-09-30',
    ]);
  });
});

describe('resourcesApi.ai', () => {
  it('asks for checklist steps and a priority', async () => {
    const { client, calls } = fakeClient();
    const ai = resourcesApi(client).ai;
    await ai.breakdown('Prepare report', 'Monthly');
    await ai.suggestPriority('Prepare report', 'Monthly', '2026-10-12');
    expect(calls).toEqual([
      { method: 'POST', path: '/ai/breakdown', body: { title: 'Prepare report', description: 'Monthly' } },
      { method: 'POST', path: '/ai/suggest-priority', body: { title: 'Prepare report', description: 'Monthly', dueDate: '2026-10-12' } },
    ]);
  });

  it('gives the AI longer than an ordinary request, and trims a long description to the server’s limit', async () => {
    const sent: { path: string; body: { description?: string }; opts?: { timeoutMs?: number } }[] = [];
    const client = {
      post: (path: string, body: { description?: string }, opts?: { timeoutMs?: number }) => {
        sent.push({ path, body, opts });
        return Promise.resolve({ data: { items: [], priority: 'LOW', reason: '' } });
      },
    } as unknown as ApiClient;
    const ai = resourcesApi(client).ai;
    const long = 'a'.repeat(AI_DESCRIPTION_MAX + 500);
    await ai.breakdown('Prepare report', long);
    await ai.suggestPriority('Prepare report', long, null);
    expect(AI_TIMEOUT_MS).toBe(130_000);
    expect(AI_DESCRIPTION_MAX).toBe(4000);
    expect(sent).toHaveLength(2);
    for (const call of sent) {
      expect(call.opts?.timeoutMs).toBe(AI_TIMEOUT_MS);
      expect(call.body.description).toHaveLength(AI_DESCRIPTION_MAX);
    }
  });

  it('never cuts a description in the middle of an emoji', async () => {
    let description: string | undefined;
    const client = {
      post: (_path: string, body: { description?: string }) => {
        description = body.description;
        return Promise.resolve({ data: { items: [] } });
      },
    } as unknown as ApiClient;
    await resourcesApi(client).ai.breakdown('x', `${'a'.repeat(AI_DESCRIPTION_MAX - 1)}😀 and more`);
    expect(description).toBe('a'.repeat(AI_DESCRIPTION_MAX - 1));
  });
});

describe('resourcesApi.meetings', () => {
  it('GETs the meetings starting in a range (the calendar)', async () => {
    const { client, calls } = fakeClient();
    await resourcesApi(client).meetings.range('2026-10-09T12:00:00.000Z', '2026-12-15T12:00:00.000Z');
    expect(calls[0]).toEqual({ method: 'GET', path: '/meetings?from=2026-10-09T12%3A00%3A00.000Z&to=2026-12-15T12%3A00%3A00.000Z' });
  });

  it('GETs a project dashboard’s meetings overview', async () => {
    const { client, calls } = fakeClient();
    await resourcesApi(client).meetings.projectOverview('p1');
    expect(calls[0]).toEqual({ method: 'GET', path: '/projects/p1/meetings-overview' });
  });

  it('PUTs a milestone flag on a task', async () => {
    const { client, calls } = fakeClient();
    await resourcesApi(client).tasks.update('t1', { isMilestone: true });
    expect(calls[0]).toEqual({ method: 'PUT', path: '/tasks/t1', body: { isMilestone: true } });
  });

  it('GETs every meeting I can see, or only the ones I organize (the Meetings list)', async () => {
    const { client, calls } = fakeClient();
    const api = resourcesApi(client).meetings;
    await api.list();
    await api.list({ mine: true });
    expect(calls[0]).toEqual({ method: 'GET', path: '/meetings' });
    expect(calls[1]).toEqual({ method: 'GET', path: '/meetings?mine=true' });
  });

  it('GETs one meeting and each of its parts (details, read-only)', async () => {
    const { client, calls } = fakeClient();
    const api = resourcesApi(client).meetings;
    await api.get('m 1');
    await api.attendees('m1');
    await api.agenda('m1');
    await api.notes('m1');
    await api.actionItems('m1');
    await api.finalMinutes('m1');
    expect(calls.map((c) => c.path)).toEqual([
      '/meetings/m%201',
      '/meetings/m1/attendees',
      '/meetings/m1/agenda',
      '/meetings/m1/notes',
      '/meetings/m1/action-items',
      '/meetings/m1/final-minutes',
    ]);
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
  });

  it('PATCHes my own attendee row with my answer to the invitation (and nothing else)', async () => {
    const { client, calls } = fakeClient();
    await resourcesApi(client).meetings.respond('m1', 'a1', 'TENTATIVE');
    expect(calls[0]).toEqual({ method: 'PATCH', path: '/meetings/m1/attendees/a1', body: { response: 'TENTATIVE' } });
  });

  it('GETs my action items: the open ones, or all of them', async () => {
    const { client, calls } = fakeClient();
    const api = resourcesApi(client).meetings;
    await api.myActionItems({ openOnly: true });
    await api.myActionItems();
    expect(calls[0]).toEqual({ method: 'GET', path: '/me/action-items?openOnly=true' });
    expect(calls[1]).toEqual({ method: 'GET', path: '/me/action-items' });
  });
});

describe('resourcesApi.meetings: running a meeting (2b)', () => {
  /** Records each call with its options (the idempotency key, a longer wait). */
  function recordingClient() {
    const calls: { method: string; path: string; body?: unknown; opts?: { headers?: Record<string, string>; timeoutMs?: number } }[] = [];
    const rec = (method: string) => (path: string, a?: unknown, b?: unknown) => {
      const [body, opts] = method === 'GET' || method === 'DELETE' ? [undefined, a] : [a, b];
      calls.push({ method, path, ...(body !== undefined ? { body } : {}), ...(opts ? { opts: opts as never } : {}) });
      return Promise.resolve(method === 'DELETE' ? undefined : { data: {} });
    };
    const client = { get: rec('GET'), post: rec('POST'), put: rec('PUT'), patch: rec('PATCH'), del: rec('DELETE') } as unknown as ApiClient;
    return { client, calls };
  }

  it('schedules, edits (one meeting or its series), cancels, duplicates and deletes a meeting', async () => {
    const { client, calls } = recordingClient();
    const api = resourcesApi(client).meetings;
    await api.create({ title: 'Sync', startAt: '2026-10-22T06:00:00.000Z', timeZone: 'Asia/Muscat' }, { idempotencyKey: 'k1' });
    await api.update('m 1', { title: 'Weekly sync' });
    await api.update('m1', { title: 'Weekly sync' }, 'series');
    await api.cancel('m1');
    await api.cancel('m1', 'series');
    await api.duplicate('m1', { idempotencyKey: 'k2' });
    await api.remove('m1');
    await api.remove('m1', 'series');
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'POST /meetings',
      'PUT /meetings/m%201',
      'PUT /meetings/m1?scope=series',
      'POST /meetings/m1/cancel',
      'POST /meetings/m1/cancel?scope=series',
      'POST /meetings/m1/duplicate',
      'DELETE /meetings/m1',
      'DELETE /meetings/m1?scope=series',
    ]);
    expect(calls[0]).toMatchObject({ body: { title: 'Sync', startAt: '2026-10-22T06:00:00.000Z', timeZone: 'Asia/Muscat' }, opts: { headers: { 'Idempotency-Key': 'k1' } } });
    expect(calls[1]!.body).toEqual({ title: 'Weekly sync' });
    expect(calls[5]!.opts?.headers).toEqual({ 'Idempotency-Key': 'k2' });
  });

  it('adds, changes and removes people; previews and sends the invitations', async () => {
    const { client, calls } = recordingClient();
    const api = resourcesApi(client).meetings;
    await api.addAttendee('m1', { userId: 'u2', role: 'OPTIONAL' }, { idempotencyKey: 'k' });
    await api.addAttendee('m1', { externalName: 'Sara', externalEmail: 'sara@client.com', role: 'REQUIRED' });
    await api.updateAttendee('m1', 'a1', { attendance: 'PRESENT' });
    await api.removeAttendee('m1', 'a1');
    await api.previewInvites('m1');
    await api.sendInvites('m1');
    await api.sendInvites('m1', { onlyNew: true });
    await api.sendInvites('m1', { resend: true }, { idempotencyKey: 'inv-1' });
    expect(calls.map((c) => [c.method, c.path, c.body])).toEqual([
      ['POST', '/meetings/m1/attendees', { userId: 'u2', role: 'OPTIONAL' }],
      ['POST', '/meetings/m1/attendees', { externalName: 'Sara', externalEmail: 'sara@client.com', role: 'REQUIRED' }],
      ['PATCH', '/meetings/m1/attendees/a1', { attendance: 'PRESENT' }],
      ['DELETE', '/meetings/m1/attendees/a1', undefined],
      ['GET', '/meetings/m1/invites/preview', undefined],
      ['POST', '/meetings/m1/invites', {}],
      ['POST', '/meetings/m1/invites', { onlyNew: true }],
      ['POST', '/meetings/m1/invites', { resend: true }],
    ]);
    // Sending emails one by one can take a while: a longer wait, and a key so a retry isn't a second send.
    expect(SEND_TIMEOUT_MS).toBe(120_000);
    expect(calls[5]!.opts?.timeoutMs).toBe(SEND_TIMEOUT_MS);
    expect(calls[7]!.opts).toEqual({ timeoutMs: SEND_TIMEOUT_MS, headers: { 'Idempotency-Key': 'inv-1' } });
  });

  it('adds, edits, reorders, ticks off and removes agenda items', async () => {
    const { client, calls } = recordingClient();
    const api = resourcesApi(client).meetings;
    await api.addAgendaItem('m1', { title: 'Budget', ownerId: 'u2', expectedMinutes: 15 });
    await api.updateAgendaItem('m1', 'g1', { completed: true });
    await api.reorderAgenda('m1', ['g2', 'g1']);
    await api.removeAgendaItem('m1', 'g1');
    expect(calls.map((c) => [c.method, c.path, c.body])).toEqual([
      ['POST', '/meetings/m1/agenda', { title: 'Budget', ownerId: 'u2', expectedMinutes: 15 }],
      ['PATCH', '/meetings/m1/agenda/g1', { completed: true }],
      ['PUT', '/meetings/m1/agenda/reorder', { orderedIds: ['g2', 'g1'] }],
      ['DELETE', '/meetings/m1/agenda/g1', undefined],
    ]);
  });

  it('adds, edits, removes and restores notes, and makes a task from one', async () => {
    const { client, calls } = recordingClient();
    const api = resourcesApi(client).meetings;
    await api.addNote('m1', { body: 'Go live in May', format: 'PLAIN', type: 'DECISION', highlighted: true }, { idempotencyKey: 'n1' });
    await api.updateNote('m1', 'n1', { highlighted: false });
    await api.removeNote('m1', 'n1');
    await api.restoreNote('m1', 'n1');
    await api.noteToTask('m1', 'n1', { title: 'Book the hall', projectId: 'p1', priority: 'HIGH' }, { idempotencyKey: 't1' });
    expect(calls.map((c) => [c.method, c.path, c.body])).toEqual([
      ['POST', '/meetings/m1/notes', { body: 'Go live in May', format: 'PLAIN', type: 'DECISION', highlighted: true }],
      ['PATCH', '/meetings/m1/notes/n1', { highlighted: false }],
      ['DELETE', '/meetings/m1/notes/n1', undefined],
      ['POST', '/meetings/m1/notes/n1/restore', {}],
      ['POST', '/meetings/m1/notes/n1/task', { title: 'Book the hall', projectId: 'p1', priority: 'HIGH' }],
    ]);
    expect(calls[0]!.opts?.headers).toEqual({ 'Idempotency-Key': 'n1' });
    expect(calls[4]!.opts?.headers).toEqual({ 'Idempotency-Key': 't1' });
  });

  it('adds, changes and removes action items', async () => {
    const { client, calls } = recordingClient();
    const api = resourcesApi(client).meetings;
    await api.addActionItem('m1', { description: 'Send the plan', assigneeId: 'u2', dueDate: '2026-10-30T00:00:00.000Z', priority: 'NORMAL' }, { idempotencyKey: 'a' });
    await api.updateActionItem('ai 1', { status: 'COMPLETED' });
    await api.removeActionItem('ai1');
    expect(calls.map((c) => [c.method, c.path, c.body])).toEqual([
      ['POST', '/meetings/m1/action-items', { description: 'Send the plan', assigneeId: 'u2', dueDate: '2026-10-30T00:00:00.000Z', priority: 'NORMAL' }],
      ['PATCH', '/action-items/ai%201', { status: 'COMPLETED' }],
      ['DELETE', '/action-items/ai1', undefined],
    ]);
  });

  it('drafts the final minutes (the AI may take three minutes), saves, approves and reopens them', async () => {
    const { client, calls } = recordingClient();
    const api = resourcesApi(client).meetings;
    const content = { summary: 'S', discussion: [], decisions: ['D'], risks: [], nextSteps: [] };
    await api.draftFinalMinutes('m1', 'ai');
    await api.draftFinalMinutes('m1', 'notes');
    await api.saveFinalMinutes('m1', content);
    await api.approveFinalMinutes('m1', content);
    await api.approveFinalMinutes('m1');
    await api.reopenFinalMinutes('m1');
    expect(calls.map((c) => [c.method, c.path, c.body])).toEqual([
      ['POST', '/meetings/m1/final-minutes/draft', { source: 'ai' }],
      ['POST', '/meetings/m1/final-minutes/draft', { source: 'notes' }],
      ['PUT', '/meetings/m1/final-minutes', { content }],
      ['POST', '/meetings/m1/final-minutes/approve', { content }],
      ['POST', '/meetings/m1/final-minutes/approve', {}],
      ['POST', '/meetings/m1/final-minutes/reopen', {}],
    ]);
    expect(AI_MINUTES_TIMEOUT_MS).toBe(190_000);
    expect(calls[0]!.opts?.timeoutMs).toBe(AI_MINUTES_TIMEOUT_MS);
    expect(calls[1]!.opts?.timeoutMs).toBe(AI_MINUTES_TIMEOUT_MS);
  });

  it('previews and emails the minutes (to everyone, or to the people chosen), and names the PDF’s address', async () => {
    const { client, calls } = recordingClient();
    const api = resourcesApi(client).meetings;
    await api.previewMinutes('m1');
    await api.sendMinutes('m1');
    await api.sendMinutes('m1', ['a@b.co'], { idempotencyKey: 'min-1' });
    expect(calls.map((c) => [c.method, c.path, c.body])).toEqual([
      ['GET', '/meetings/m1/minutes/preview', undefined],
      ['POST', '/meetings/m1/minutes/send', {}],
      ['POST', '/meetings/m1/minutes/send', { recipients: ['a@b.co'] }],
    ]);
    expect(calls[1]!.opts?.timeoutMs).toBe(SEND_TIMEOUT_MS);
    expect(calls[2]!.opts).toEqual({ timeoutMs: SEND_TIMEOUT_MS, headers: { 'Idempotency-Key': 'min-1' } });
    expect(api.minutesPdfPath('m 1')).toBe('/meetings/m%201/minutes.pdf');
  });
});

describe('resourcesApi: meeting AI and free times (2c)', () => {
  /** Records each POST with its options, answering as the server would. */
  function recorder(answer: unknown) {
    const sent: { path: string; body: Record<string, unknown>; opts?: { timeoutMs?: number; headers?: Record<string, string> } }[] = [];
    const client = {
      post: (path: string, body: Record<string, unknown>, opts?: { timeoutMs?: number }) => {
        sent.push({ path, body, opts });
        return Promise.resolve({ data: answer });
      },
    } as unknown as ApiClient;
    return { sent, api: resourcesApi(client) };
  }

  it('reads a sentence with today’s company day, giving the AI its longer wait and the server’s 1000-character limit', async () => {
    const { sent, api } = recorder({ title: 'Site review' });
    const draft = await api.ai.parseMeeting(`  ${'x'.repeat(1200)}  `, '2026-10-21');
    expect(draft).toEqual({ title: 'Site review' });
    expect(sent[0]!.path).toBe('/ai/parse-meeting');
    expect(sent[0]!.body).toEqual({ text: 'x'.repeat(1000), today: '2026-10-21' });
    expect(sent[0]!.opts?.timeoutMs).toBe(AI_TIMEOUT_MS);
  });

  it('drafts an agenda and writes a description, with the AI’s wait', async () => {
    const agenda = recorder({ items: [{ title: 'Budget', ownerId: 'u1', minutes: 20 }] });
    const input = { title: 'Weekly sync', startAt: '2026-10-22T06:00:00.000Z', minutes: 60, peopleIds: ['u1'], projectId: 'p1', meetingId: 'm1' };
    expect(await agenda.api.ai.draftAgenda(input)).toEqual([{ title: 'Budget', ownerId: 'u1', minutes: 20 }]);
    expect(agenda.sent[0]).toMatchObject({ path: '/ai/draft-agenda', body: input, opts: { timeoutMs: AI_TIMEOUT_MS } });
    // An answer without items (an older server) is no agenda, not a crash.
    expect(await recorder({}).api.ai.draftAgenda(input)).toEqual([]);

    const words = recorder({ description: 'Plans for the week.' });
    expect(await words.api.ai.writeMeetingDescription({ title: 'Weekly sync', agenda: ['Budget'], text: 'weekly sync' })).toBe('Plans for the week.');
    expect(words.sent[0]).toMatchObject({ path: '/ai/write-meeting-description', body: { title: 'Weekly sync', agenda: ['Budget'], text: 'weekly sync' }, opts: { timeoutMs: AI_TIMEOUT_MS } });
  });

  it('asks the server for free times (no AI)', async () => {
    const reply = { suggestions: [], clashes: [], day: [], workingHours: { days: [0, 1, 2, 3, 4], start: '08:00', end: '17:00' } };
    const { sent, api } = recorder(reply);
    const body = { userIds: ['u1', 'u2'], startAt: '2026-10-22T06:00:00.000Z', minutes: 60 };
    expect(await api.meetings.freeTimes(body)).toEqual(reply);
    expect(sent[0]).toMatchObject({ path: '/meetings/free-times', body });
  });
});

describe('resourcesApi.calendar (5a)', () => {
  it('asks for one range of days, and for the overdue tasks', async () => {
    const { client, calls } = fakeClient();
    const api = resourcesApi(client);
    await api.calendar.range('2026-09-27', '2026-10-31');
    await api.calendar.overdue();
    expect(calls).toEqual([
      { method: 'GET', path: '/calendar?from=2026-09-27&to=2026-10-31' },
      { method: 'GET', path: '/tasks?overdue=true' },
    ]);
  });
});

describe('resourcesApi.account and your settings (6a)', () => {
  it('changes your own password and hands back the fresh session’s tokens', async () => {
    const calls: { path: string; body?: unknown }[] = [];
    const client = {
      post: (path: string, body?: unknown) => {
        calls.push({ path, body });
        return Promise.resolve({ data: { accessToken: 'fake-a', refreshToken: 'fake-r' } });
      },
    } as unknown as ApiClient;
    expect(await resourcesApi(client).account.changePassword('old-pass1', 'abcd1234')).toEqual({ accessToken: 'fake-a', refreshToken: 'fake-r' });
    expect(calls).toEqual([{ path: '/users/me/password', body: { currentPassword: 'old-pass1', newPassword: 'abcd1234' } }]);
  });

  it('a server that gives no session back is no session (not an error)', async () => {
    const client = { post: () => Promise.resolve({}) } as unknown as ApiClient;
    expect(await resourcesApi(client).account.changePassword('old-pass1', 'abcd1234')).toBeNull();
  });

  it('uploads the profile photo as the multipart "file" part, and removes it', async () => {
    const { client, calls } = fakeClient();
    const api = resourcesApi(client).account;
    await api.uploadAvatar({ uri: 'file:///cache/me.jpg', name: 'me.jpg', type: 'image/jpeg' });
    expect(calls[0]).toMatchObject({ method: 'UPLOAD', path: '/users/me/avatar' });
    expect(calls[0]!.body).toBeInstanceOf(FormData);
    const removing = { del: (path: string) => { calls.push({ method: 'DELETE', path }); return Promise.resolve({ data: { id: 'u1', avatarUrl: null } }); } } as unknown as ApiClient;
    expect(await resourcesApi(removing).account.removeAvatar()).toEqual({ id: 'u1', avatarUrl: null });
    expect(calls[1]).toEqual({ method: 'DELETE', path: '/users/me/avatar' });
  });

  it('saves only the date setting that changed', async () => {
    const { client, calls } = fakeClient();
    await resourcesApi(client).settings.setDatePreferences({ weekStart: 6 });
    await resourcesApi(client).settings.setDatePreferences({ timeZone: null });
    expect(calls).toEqual([
      { method: 'PUT', path: '/users/me/preferences', body: { weekStart: 6 } },
      { method: 'PUT', path: '/users/me/preferences', body: { timeZone: null } },
    ]);
  });

  it('saves preferences as given (only the daily email setting that changed), and sends a daily email test', async () => {
    const { client, calls } = fakeClient();
    const api = resourcesApi(client).preferences;
    await api.save({ dailyEmails: { time: '07:00' } });
    await api.sendDailyEmailTest();
    expect(calls).toEqual([
      { method: 'PUT', path: '/notifications/preferences', body: { dailyEmails: { time: '07:00' } } },
      { method: 'POST', path: '/notifications/daily-emails/test', body: undefined },
    ]);
  });
});

describe('resourcesApi.projects: creating, editing and the team (5b)', () => {
  /** Records the request options too (headers, time limits). */
  function recording(reply: unknown = { data: { id: 'p1' } }) {
    const calls: { method: string; path: string; body?: unknown; opts?: { headers?: Record<string, string>; timeoutMs?: number } }[] = [];
    const rec = (method: string) => (path: string, a?: unknown, b?: unknown) => {
      const withBody = method !== 'GET' && method !== 'DELETE';
      calls.push({ method, path, ...(withBody ? { body: a } : {}), opts: (withBody ? b : a) as never });
      return Promise.resolve(reply);
    };
    const client = { get: rec('GET'), post: rec('POST'), put: rec('PUT'), patch: rec('PATCH'), del: rec('DELETE'), upload: rec('UPLOAD') } as unknown as ApiClient;
    return { client, calls };
  }

  it('checks a code, creates with the try’s key, edits, archives', async () => {
    const { client, calls } = recording();
    const api = resourcesApi(client).projects;
    await api.checkCode('mi co');
    await api.create({ code: 'RIG', name: 'Rig' }, 'key-1');
    await api.update('p1', { name: 'Rig 2', ownerId: null });
    await api.archive('p1');
    expect(calls.map((c) => [c.method, c.path, c.body])).toEqual([
      ['GET', '/projects/code-check?code=mi%20co', undefined],
      ['POST', '/projects', { code: 'RIG', name: 'Rig' }],
      ['PUT', '/projects/p1', { name: 'Rig 2', ownerId: null }],
      ['POST', '/projects/p1/archive', {}],
    ]);
    expect(calls[1]!.opts?.headers).toEqual({ 'Idempotency-Key': 'key-1' });
  });

  it('uploads the picture as the multipart "file" part, and removes it', async () => {
    const { client, calls } = recording();
    const api = resourcesApi(client).projects;
    await api.uploadImage('p1', { uri: 'file:///c/logo.png', name: 'logo.png', type: 'image/png' });
    await api.removeImage('p1');
    expect(calls[0]).toMatchObject({ method: 'UPLOAD', path: '/projects/p1/image' });
    expect(calls[0]!.body).toBeInstanceOf(FormData);
    expect(calls[1]).toMatchObject({ method: 'DELETE', path: '/projects/p1/image' });
  });

  it('adds members, changes a role and removes someone', async () => {
    const { client, calls } = recording({ data: [] });
    const api = resourcesApi(client).projects;
    await api.addMembers('p1', ['u2']);
    await api.setMemberRole('p1', 'u2', 'MANAGER');
    await api.removeMember('p1', 'u2');
    expect(calls.map((c) => [c.method, c.path, c.body])).toEqual([
      ['POST', '/projects/p1/members', { userIds: ['u2'] }],
      ['PATCH', '/projects/p1/members/u2', { role: 'MANAGER' }],
      ['DELETE', '/projects/p1/members/u2', undefined],
    ]);
  });

  it('asks the AI for a status summary, giving it the AI’s time', async () => {
    const { client, calls } = recording({ data: { summary: '  On track.  ' } });
    const req = { name: 'Rig', stats: { total: 3, completed: 1, inProgress: 1, overdue: 0 }, sampleTitles: ['A'] };
    expect(await resourcesApi(client).ai.summary(req)).toBe('On track.');
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/ai/summary', body: req });
    expect(calls[0]!.opts?.timeoutMs).toBe(AI_TIMEOUT_MS);
  });
});
