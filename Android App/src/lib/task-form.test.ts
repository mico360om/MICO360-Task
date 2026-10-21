import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  leftWhileSendingText,
  TASK_FILES_MAX_BYTES,
  checkTaskFiles,
  keptTry,
  keptTryProblem,
  assignablePeople,
  assigneeNote,
  checkNewTask,
  createdWithoutFilesText,
  formColumns,
  isDraftDirty,
  lastProjectKey,
  leaveWarning,
  newTaskDraft,
  openProjectsOf,
  pickColumn,
  prunedAssignees,
  scheduleText,
  sendNewTask,
  startProjectId,
  submitLabel,
  untilProblem,
  withPickedFiles,
  NEW_TASK_TEXT,
  type NewTaskFile,
  type TaskDraft,
} from './task-form';
import { ApiError, NetworkError } from './api-client';
import { WaitingBehindError } from './write-order';
import type { ApiColumn, ApiDirectoryUser, ApiMember, ApiTask } from './types';

const project = (id: string, over: Record<string, unknown> = {}) => ({ id, name: `Project ${id}`, code: id.toUpperCase(), status: 'ACTIVE', ...over });
const column = (id: string, over: Partial<ApiColumn> = {}): ApiColumn => ({ id, projectId: 'p1', name: `Col ${id}`, category: 'TODO', position: 0, color: '#888', enabled: true, ...over });
const member = (id: string, first: string, over: Partial<ApiMember> = {}): ApiMember => ({ id, username: first.toLowerCase(), email: `${id}@x.test`, firstName: first, lastName: 'Lee', role: 'MEMBER', ...over });
const draft = (over: Partial<TaskDraft> = {}): TaskDraft => ({ ...newTaskDraft({}), projectId: 'p1', columnId: 'c1', title: 'Write the report', ...over });

describe('where a new task goes (the website’s order)', () => {
  it('offers the projects that aren’t archived', () => {
    expect(openProjectsOf([project('p1'), project('p2', { status: 'ARCHIVED' }), project('p3', { status: 'COMPLETED' })]).map((p) => p.id)).toEqual(['p1', 'p3']);
    expect(openProjectsOf(undefined)).toEqual([]);
  });

  it('starts in the fixed project, else the page’s own, else the one used last time, else the first open one', () => {
    const open = [project('p1'), project('p2'), project('p3')];
    expect(startProjectId({ fixed: 'p9', preferred: 'p2', last: 'p3', open })).toBe('p9');
    expect(startProjectId({ preferred: 'p2', last: 'p3', open })).toBe('p2');
    // The page's project is archived (not among the open ones), or unknown: the one used last time.
    expect(startProjectId({ preferred: 'p8', last: 'p3', open })).toBe('p3');
    expect(startProjectId({ last: 'gone', open })).toBe('p1');
    expect(startProjectId({ open: [] })).toBe('');
  });

  it('remembers the project used last time per person on this phone', () => {
    expect(lastProjectKey('u1')).toBe('mico360.newTask.project.u1');
    expect(lastProjectKey('u2')).not.toBe(lastProjectKey('u1'));
  });

  it('lists a project’s columns in board order, without the turned-off ones', () => {
    const cols = [column('c3', { position: 2 }), column('c1', { position: 0 }), column('c2', { position: 1, enabled: false })];
    expect(formColumns(cols).map((c) => c.id)).toEqual(['c1', 'c3']);
    expect(formColumns(undefined)).toEqual([]);
  });

  it('keeps the chosen column; after a project change, lands in the same kind of column; else the one asked for, else the first', () => {
    const cols = formColumns([column('a', { category: 'TODO' }), column('b', { category: 'IN_PROGRESS', position: 1 }), column('c', { category: 'DONE', position: 2 })]);
    expect(pickColumn(cols, { current: 'c' })).toBe('c');
    expect(pickColumn(cols, { current: 'gone', preferKind: 'IN_PROGRESS' })).toBe('b');
    expect(pickColumn(cols, { current: '', preferKind: 'BLOCKED', defaultColumnId: 'c' })).toBe('c');
    expect(pickColumn(cols, { current: '' })).toBe('a');
    expect(pickColumn([], { current: '' })).toBe('');
  });
});

describe('who can do it', () => {
  it('offers the project’s members who are still active, with their names and pictures', () => {
    const members = [member('u1', 'Sara'), member('u2', 'Omar'), member('u3', 'Layla')];
    const directory: ApiDirectoryUser[] = [
      { id: 'u1', username: 'sara', firstName: 'Sara', lastName: 'Lee', active: true, avatarUrl: '/uploads/sara.png' },
      { id: 'u3', username: 'layla', firstName: 'Layla', lastName: 'Lee', active: false },
    ];
    expect(assignablePeople(members, directory)).toEqual([
      { id: 'u1', name: 'Sara Lee', username: 'sara', avatarUrl: '/uploads/sara.png' },
      { id: 'u2', name: 'Omar Lee', username: 'omar', avatarUrl: null },
    ]);
    expect(assignablePeople(undefined, undefined)).toEqual([]);
  });

  it('takes off people who aren’t on a newly chosen project, and says who', () => {
    const people = [{ id: 'u1', name: 'Sara Lee', username: 'sara', avatarUrl: null }];
    const known = new Map([['u2', 'Omar Lee'], ['u3', 'Layla Lee']]);
    expect(prunedAssignees(['u1'], people, known, 'Ops')).toEqual({ ids: ['u1'], notice: null });
    expect(prunedAssignees(['u1', 'u2'], people, known, 'Ops')).toEqual({ ids: ['u1'], notice: 'Omar Lee isn’t on Ops, so they were taken off this task.' });
    expect(prunedAssignees(['u2', 'u3', 'u9'], people, known, 'Ops')).toEqual({ ids: [], notice: 'Omar Lee, Layla Lee and Someone aren’t on Ops, so they were taken off this task.' });
    expect(prunedAssignees(['u2'], people, known, null).notice).toBe('Omar Lee isn’t on that project, so they were taken off this task.');
  });

  it('says who gets the task when nobody is picked', () => {
    expect(assigneeNote([], 'Sara Lee')).toBe('Nobody picked — the task will go to Sara Lee, the project owner.');
    expect(assigneeNote([], null)).toBe('Nobody picked — the task will be unassigned.');
    expect(assigneeNote(['u1'], 'Sara Lee')).toBeNull();
  });
});

describe('the repeat', () => {
  it('reads as the website says it — a weekly repeat with no days repeats on the due date’s weekday', () => {
    expect(scheduleText({ freq: 'WEEKLY', interval: 1 }, '2026-10-22')).toBe('Repeats every week on Thu');
    expect(scheduleText({ freq: 'WEEKLY', interval: 1, weekdays: [1] }, '2026-10-22')).toBe('Repeats every week on Mon');
    expect(scheduleText({ freq: 'DAILY', interval: 2 }, '')).toBe('Repeats every 2 days');
  });

  it('can’t end before the due date', () => {
    expect(untilProblem({ freq: 'DAILY', interval: 1, until: '2026-10-01' }, '2026-10-22')).toBe('The repeat can’t end before the due date.');
    expect(untilProblem({ freq: 'DAILY', interval: 1, until: '2026-10-22T00:00:00.000Z' }, '2026-10-22')).toBeNull();
    expect(untilProblem({ freq: 'DAILY', interval: 1, until: '2026-10-01' }, '')).toBeNull();
    expect(untilProblem(null, '2026-10-22')).toBeNull();
  });
});

describe('checking and sending a new task', () => {
  it('starts empty, on the day and column it was opened with', () => {
    expect(newTaskDraft({ projectId: 'p1', columnId: 'c2', dueDate: '2026-10-23' })).toEqual({
      projectId: 'p1',
      columnId: 'c2',
      title: '',
      description: '',
      priority: 'NORMAL',
      dueDate: '2026-10-23',
      rule: null,
      assigneeIds: [],
      milestone: false,
    });
  });

  it('needs a title, a repeat that ends after the due date, and a project and column', () => {
    expect(checkNewTask(draft({ title: '   ' }), { noProjects: false })).toEqual({ ok: false, field: 'title', message: 'Give the task a title.' });
    expect(checkNewTask(draft({ dueDate: '2026-10-22', rule: { freq: 'DAILY', interval: 1, until: '2026-10-01' } }), { noProjects: false })).toEqual({
      ok: false,
      field: 'repeat',
      message: 'The repeat can’t end before the due date.',
    });
    expect(checkNewTask(draft({ columnId: '' }), { noProjects: false })).toEqual({ ok: false, field: 'place', message: 'Choose where the task goes: its project and column.' });
    expect(checkNewTask(draft({ projectId: '', columnId: '' }), { noProjects: true })).toEqual({ ok: false, field: 'place', message: 'Create a project first.' });
  });

  it('sends what the website sends: only what was given, people only when picked, and the board day', () => {
    expect(checkNewTask(draft({ title: '  Write the report ' }), { noProjects: false })).toEqual({
      ok: true,
      input: { projectId: 'p1', columnId: 'c1', title: 'Write the report', priority: 'NORMAL' },
    });
    const full = checkNewTask(
      draft({ description: ' Two pages. ', priority: 'HIGH', dueDate: '2026-10-23', rule: { freq: 'WEEKLY', interval: 1 }, milestone: true, assigneeIds: ['u1', 'u2'] }),
      { noProjects: false, boardDate: '2026-10-21' },
    );
    expect(full).toEqual({
      ok: true,
      input: {
        projectId: 'p1',
        columnId: 'c1',
        title: 'Write the report',
        priority: 'HIGH',
        description: 'Two pages.',
        dueDate: '2026-10-23',
        recurrenceRule: { freq: 'WEEKLY', interval: 1 },
        isMilestone: true,
        assigneeIds: ['u1', 'u2'],
        boardDate: '2026-10-21',
      },
    });
  });

  it('counts what you typed or chose as something to keep — not a day or project the form started with', () => {
    const saved = draft({ title: '', dueDate: '2026-10-23' });
    expect(isDraftDirty(saved, saved, { placeChosen: false, files: 0 })).toBe(false);
    // The form settles its own project and column: not yours.
    expect(isDraftDirty({ ...saved, projectId: 'p2', columnId: 'x' }, saved, { placeChosen: false, files: 0 })).toBe(false);
    expect(isDraftDirty({ ...saved, title: 'x' }, saved, { placeChosen: false, files: 0 })).toBe(true);
    expect(isDraftDirty(saved, saved, { placeChosen: true, files: 0 })).toBe(true);
    expect(isDraftDirty(saved, saved, { placeChosen: false, files: 1 })).toBe(true);
  });

  it('what leaving asks', () => {
    expect(leaveWarning({ saving: false, locked: false })).toEqual({ title: 'Discard this task?', message: 'What you entered hasn’t been saved.', stay: 'Keep editing', leave: 'Discard' });
    expect(leaveWarning({ saving: true, locked: false }).message).toBe('The task may still be saving. Check the board before adding it again.');
    expect(leaveWarning({ saving: false, locked: true }).message).toBe('The task may already be created — check the board before adding it again.');
  });

  it('the button says what is happening', () => {
    expect(submitLabel({ created: false, saving: false, uploading: false })).toBe('Create task');
    expect(submitLabel({ created: false, saving: true, uploading: false })).toBe('Creating…');
    expect(submitLabel({ created: false, saving: true, uploading: true })).toBe('Attaching files…');
    expect(submitLabel({ created: true, saving: false, uploading: false })).toBe('Done');
  });
});

describe('files for a new task', () => {
  it('adds the picked files, each with its own key, and keeps what was there', () => {
    const seq = { n: 0 };
    const one = withPickedFiles([], [{ uri: 'file:///a.jpg', name: 'a.jpg', mimeType: 'image/jpeg', size: 2048 }], seq);
    expect(one).toEqual([{ key: 'f1', uri: 'file:///a.jpg', name: 'a.jpg', mimeType: 'image/jpeg', size: 2048 }]);
    const two = withPickedFiles(one, [{ uri: 'file:///b.pdf', name: 'b.pdf' }], seq);
    expect(two.map((f) => f.key)).toEqual(['f1', 'f2']);
    expect(two[1]).toEqual({ key: 'f2', uri: 'file:///b.pdf', name: 'b.pdf', mimeType: null, size: null });
  });

  it('says which files weren’t attached, and why', () => {
    expect(createdWithoutFilesText([{ name: 'a.jpg', reason: 'That file is too large to attach.' }])).toBe('The task was created, but a.jpg wasn’t attached: That file is too large to attach.');
    expect(createdWithoutFilesText([{ name: 'a.jpg', reason: 'Too big.' }, { name: 'b.pdf', reason: 'Damaged.' }])).toBe(
      'The task was created, but these files weren’t attached: a.jpg (Too big.); b.pdf (Damaged.). Add them from the task.',
    );
  });
});

describe('sendNewTask', () => {
  const task = { id: 't1', key: 'MICO-7', projectId: 'p1' } as ApiTask;
  const input = { projectId: 'p1', columnId: 'c1', title: 'Write the report', priority: 'NORMAL' as const };
  const file = (key: string): NewTaskFile => ({ key, uri: `file:///${key}.jpg`, name: `${key}.jpg`, mimeType: 'image/jpeg', size: 10 });
  /** Pretends sendInOrder: a write that gets no answer is kept on this phone (marked as kept). */
  const kept = (e: Error) => Object.assign(e, { [Symbol.for('mico360.keptOnPhone')]: true });

  function deps(over: Partial<Parameters<typeof sendNewTask>[0]> = {}) {
    const calls: string[] = [];
    const filePatches: [string, Partial<NewTaskFile>][] = [];
    return {
      calls,
      filePatches,
      d: {
        createKept: async (_i: unknown, key: string) => (calls.push(`kept:${key}`), task),
        createLive: async (_i: unknown, key: string) => (calls.push(`live:${key}`), task),
        upload: async (taskId: string, f: { name: string }, onProgress: (n: number) => void) => {
          calls.push(`upload:${taskId}:${f.name}`);
          onProgress(0.5);
          return {};
        },
        onFile: (key: string, patch: Partial<NewTaskFile>) => filePatches.push([key, patch]),
        ...over,
      },
    };
  }

  it('without files: created under its key, through the offline queue', async () => {
    const { d, calls } = deps();
    expect(await sendNewTask(d, { input, key: 'k1', files: [] })).toEqual({ kind: 'created', task });
    expect(calls).toEqual(['kept:k1']);
  });

  it('without files, no answer: kept on this phone and sent later — said the app’s way', async () => {
    const { d } = deps({ createKept: async () => Promise.reject(kept(new NetworkError('Network request failed.'))) });
    expect(await sendNewTask(d, { input, key: 'k1', files: [] })).toEqual({ kind: 'kept', message: 'Saved on this phone — will sync when you’re online.' });
    const late = deps({ createKept: async () => Promise.reject(kept(new NetworkError('slow', { timedOut: true }))) });
    expect(await sendNewTask(late.d, { input, key: 'k1', files: [] })).toEqual({ kind: 'kept', message: 'The server didn’t answer in time — saved on this phone and sent again shortly.' });
    const behind = deps({ createKept: async () => Promise.reject(new WaitingBehindError()) });
    expect((await sendNewTask(behind.d, { input, key: 'k1', files: [] })).kind).toBe('kept');
  });

  it('a no-answer that couldn’t be kept (signed out meanwhile) keeps its key and locks the form', async () => {
    const { d } = deps({ createKept: async () => Promise.reject(new NetworkError('Network request failed.')) });
    const out = await sendNewTask(d, { input, key: 'k1', files: [] });
    expect(out.kind).toBe('no-answer');
  });

  it('with files: created live (files can’t wait offline), then each file goes up in turn with its progress', async () => {
    const { d, calls, filePatches } = deps();
    expect(await sendNewTask(d, { input, key: 'k1', files: [file('a'), file('b')] })).toEqual({ kind: 'created', task });
    expect(calls).toEqual(['live:k1', 'upload:t1:a.jpg', 'upload:t1:b.jpg']);
    expect(filePatches).toEqual([
      ['a', { fraction: 0, error: undefined }],
      ['a', { fraction: 0.5 }],
      ['a', { fraction: 1 }],
      ['b', { fraction: 0, error: undefined }],
      ['b', { fraction: 0.5 }],
      ['b', { fraction: 1 }],
    ]);
  });

  it('with files, a file that won’t go up: the task is created, the others still go, and each failure says why', async () => {
    const { d, calls, filePatches } = deps({
      upload: async (_t: string, f: { name: string }) => {
        calls.push(`upload:${f.name}`);
        if (f.name === 'a.jpg') throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Request failed (413)');
        return {};
      },
    });
    expect(await sendNewTask(d, { input, key: 'k1', files: [file('a'), file('b')] })).toEqual({
      kind: 'files-failed',
      task,
      failed: [{ key: 'a', name: 'a.jpg', reason: 'That file is too large to attach.' }],
    });
    expect(calls).toEqual(['live:k1', 'upload:a.jpg', 'upload:b.jpg']);
    expect(filePatches).toContainEqual(['a', { fraction: undefined, error: 'That file is too large to attach.' }]);
  });

  it('with files and no answer: nothing kept offline; the key is kept and the form locked (the task may be on the server)', async () => {
    // Offline, the request never left: the form isn't locked (4a review #5).
    const { d } = deps({ createLive: async () => Promise.reject(new NetworkError('Network request failed.')) });
    expect(await sendNewTask(d, { input, key: 'k1', files: [file('a')] })).toEqual({ kind: 'not-sent', message: NEW_TASK_TEXT.offlineWithFiles });
    const late = deps({ createLive: async () => Promise.reject(new NetworkError('slow', { timedOut: true })) });
    expect(await sendNewTask(late.d, { input, key: 'k1', files: [file('a')] })).toEqual({ kind: 'no-answer', message: NEW_TASK_TEXT.noAnswer });
    // The first try is still being saved on the server: the same key, wait, and tap again.
    const busy = deps({ createLive: async () => Promise.reject(new ApiError(409, 'IDEMPOTENCY_IN_PROGRESS', 'busy')) });
    expect(await sendNewTask(busy.d, { input, key: 'k1', files: [file('a')] })).toEqual({ kind: 'no-answer', message: NEW_TASK_TEXT.stillSaving });
  });

  it('a refusal says the server’s reason (a fresh key next time, the form stays as it is)', async () => {
    const refuse = (e: Error) => deps({ createKept: async () => Promise.reject(e), createLive: async () => Promise.reject(e) }).d;
    expect(await sendNewTask(refuse(new ApiError(400, 'VALIDATION', 'Only active members of this project can be assigned.')), { input, key: 'k1', files: [] })).toEqual({
      kind: 'refused',
      message: 'Couldn’t create the task. Only active members of this project can be assigned.',
    });
    expect(await sendNewTask(refuse(new ApiError(403, 'FORBIDDEN', 'Forbidden')), { input, key: 'k1', files: [file('a')] })).toEqual({
      kind: 'refused',
      message: 'Couldn’t create the task. You don’t have permission to do that.',
    });
    // A refusal without words of its own: the plain fallback (a 5xx isn't a refusal — 4a review #10).
    expect(await sendNewTask(refuse(new ApiError(400, 'HTTP_400', 'Request failed (400)')), { input, key: 'k1', files: [] })).toEqual({
      kind: 'refused',
      message: 'Couldn’t create the task. Please try again.',
    });
  });
});

/** The words come from the website's task form (Web Portal/frontend/src/components/task-form). */
const webForm = resolve(__dirname, '../../../Web Portal/frontend/src/components/task-form/TaskFormDialog.tsx');
describe.skipIf(!existsSync(webForm))('the same words as the website’s New task form', () => {
  it('says each thing in the website’s words', () => {
    const web = readFileSync(webForm, 'utf8');
    for (const words of [
      'Give the task a title.',
      'The repeat can’t end before the due date.',
      'Choose where the task goes: its project and column.',
      'Create a project first.',
      'Create a project first, then you can add tasks to it.',
      'Nobody picked — the task will be unassigned.',
      'the project owner.',
      'so ${names.length === 1 ? \'they were\' : \'they were\'} taken off this task.',
      'You’re offline, and files can’t be attached offline. Try again when you’re connected, or remove the files to save the task now.',
      'The task was created, but ',
      'Add them from the task.',
      'Couldn’t create the task. ',
      'You don’t have permission to do that.',
      'Discard this task?',
      'What you entered hasn’t been saved.',
      'Keep editing',
      'Attaching files…',
      'Creating…',
      'Create task',
      'A key date or deliverable of the project — listed on its dashboard.',
      'Set a due date to see the next dates.',
      'Details, links, acceptance notes…',
      'What needs to be done?',
    ]) {
      expect(web, words).toContain(words);
    }
    for (const words of [NEW_TASK_TEXT.offlineWithFiles, NEW_TASK_TEXT.noProjects, NEW_TASK_TEXT.milestoneHint, NEW_TASK_TEXT.noDueForRepeat]) expect(web).toContain(words);
  });
});

describe('a New task try whose answer was lost (5b review #4, checked on the 4a form)', () => {
  const input = { projectId: 'p1', columnId: 'c1', title: 'Fix pump', priority: 'MEDIUM', assigneeIds: [] } as never;
  it('the kept key goes again only with exactly what it carried', () => {
    const kept = keptTry(input);
    expect(keptTryProblem(kept, input)).toBeNull();
    expect(keptTryProblem(null, { ...(input as object), title: 'Other' } as never)).toBeNull();
    expect(keptTryProblem(kept, { ...(input as object), columnId: 'c2' } as never)).toBe(NEW_TASK_TEXT.changedSinceTry);
  });

  it('nothing moves a locked form: the column the board picks for it waits until the try is settled', () => {
    const screen = readFileSync(resolve(__dirname, '../screens/NewTaskScreen.tsx'), 'utf8');
    expect(screen).toMatch(/if \(frozen \|\| !columnsQ\.data \|\| columns\.length === 0\) return;/);
    expect(screen).toMatch(/keptTryProblem\(keptBody\.current, check\.input\)/);
  });
});

describe('files for a task are checked against the server’s rules before anything is sent (4a review #2)', () => {
  const MB = 1024 * 1024;
  const f = (name: string, size: number | null, mimeType: string | null = null) => ({ uri: `file:///c/DocumentPicker/${name}`, name, size, mimeType });
  it('a file too big, of a kind the server refuses, or empty is turned away with the reason; the rest are added', () => {
    const r = checkTaskFiles(0, [f('photo.jpg', 12 * MB, 'image/jpeg'), f('clip.mp4', 3 * MB, 'video/mp4'), f('IMG_1.heic', 2 * MB, 'image/heic'), f('empty.txt', 0, 'text/plain'), f('plan.pdf', 2 * MB, 'application/pdf')]);
    expect(r.ok.map((x) => x.name)).toEqual(['plan.pdf']);
    expect(r.problems).toEqual([
      '“photo.jpg” is 12 MB — files can be up to 10 MB.',
      '“clip.mp4” can’t be sent: only pictures, PDFs, text, CSV, ZIP and Word / Excel / PowerPoint files are allowed.',
      '“IMG_1.heic” can’t be sent: only pictures, PDFs, text, CSV, ZIP and Word / Excel / PowerPoint files are allowed.',
      '“empty.txt” is empty.',
    ]);
  });

  it('a task holds up to 50 MB of files in all: a file that would go past it isn’t added', () => {
    const r = checkTaskFiles(45 * MB, [f('a.pdf', 4 * MB, 'application/pdf'), f('b.pdf', 2 * MB, 'application/pdf')]);
    expect(r.ok.map((x) => x.name)).toEqual(['a.pdf']);
    expect(r.problems).toEqual(['“b.pdf” would take this task past 50 MB of files.']);
    expect(TASK_FILES_MAX_BYTES).toBe(50 * MB);
  });

  it('the hint says the limits as they are (the 10 MB is before the server makes pictures smaller)', () => {
    expect(NEW_TASK_TEXT.filesHint).toBe('Up to 10 MB each and 50 MB in all · pictures, PDFs, text, CSV, ZIP and Office files · attached once the task is created.');
  });

  it('task details check files the same way before sending them', () => {
    const screen = readFileSync(resolve(__dirname, '../screens/TaskDetailScreen.tsx'), 'utf8');
    expect(screen).toMatch(/checkTaskFiles\(/);
    const form = readFileSync(resolve(__dirname, '../screens/NewTaskScreen.tsx'), 'utf8');
    expect(form).toMatch(/checkTaskFiles\(/);
  });
});

describe('leaving the New task form while it is still sending (4a review #3)', () => {
  const task = { id: 't1', key: 'MICO-7', title: 'Fix pump' } as never;
  it('says how it ended, even after the form has gone', () => {
    expect(leftWhileSendingText({ kind: 'created', task })).toBe('Created MICO-7, with its files.');
    expect(leftWhileSendingText({ kind: 'files-failed', task, failed: [{ key: 'f1', name: 'plan.pdf', reason: 'Please try again.' }] })).toBe(
      'The task was created, but plan.pdf wasn’t attached: Please try again.',
    );
    expect(leftWhileSendingText({ kind: 'kept', message: 'Saved on this phone — will sync when you’re online.' })).toBe('Saved on this phone — will sync when you’re online.');
    expect(leftWhileSendingText({ kind: 'no-answer', message: NEW_TASK_TEXT.noAnswer })).toBe('The server didn’t answer in time — the task may already be created. Check the board before adding it again.');
    expect(leftWhileSendingText({ kind: 'refused', message: 'Couldn’t create the task. Please try again.' })).toBe('Couldn’t create the task. Please try again.');
  });

  it('the files still being sent aren’t deleted when the form goes; the end of the sending deletes them', () => {
    const screen = readFileSync(resolve(__dirname, '../screens/NewTaskScreen.tsx'), 'utf8');
    expect(screen).toMatch(/if \(busy\.current\) return; \/\/ still sending: the end of submit deletes them/);
    expect(screen).toMatch(/notice\(leftWhileSendingText\(out\)\)/);
  });
});

describe('a locked New task form, and one that never reached the server (4a review #4, #5)', () => {
  it('files can still be added to a locked form: the next try under the same key attaches them to the task it made', () => {
    expect(NEW_TASK_TEXT.locked).toBe(
      'Until the task is created, its details can’t change — if the first try reached the server, a change made now would be lost. You can still add or take off files, or start over.',
    );
    const screen = readFileSync(resolve(__dirname, '../screens/NewTaskScreen.tsx'), 'utf8');
    expect(screen).toMatch(/const pick = async \(pictures: boolean\) => \{\r?\n\s+if \(saving \|\| created\) return;/);
  });

  it('offline with files the form stays open: nothing was sent, so nothing is locked', () => {
    const screen = readFileSync(resolve(__dirname, '../screens/NewTaskScreen.tsx'), 'utf8');
    expect(screen).toMatch(/case 'not-sent':\r?\n\s+setLocked\(false\);/);
  });
});

describe('a server problem on create keeps the key (4a review #10)', () => {
  const input = { projectId: 'p1', columnId: 'c1', title: 'Write the report', priority: 'NORMAL' as const };
  const file = (key: string): NewTaskFile => ({ key, uri: `file:///${key}.jpg`, name: `${key}.jpg`, mimeType: 'image/jpeg', size: 10 });
  const deps = (over: Partial<Parameters<typeof sendNewTask>[0]>) => ({
    d: {
      createKept: async () => ({}) as ApiTask,
      createLive: async () => ({}) as ApiTask,
      upload: async () => ({}),
      onFile: () => {},
      ...over,
    },
  });
  it('a 5xx or 408 (a proxy’s 502/504 too: the server may have finished) keeps the key and locks the form, as no answer does', async () => {
    for (const status of [500, 502, 503, 504, 408]) {
      const d = deps({ createKept: async () => Promise.reject(new ApiError(status, 'ERROR', `Request failed (${status})`)), createLive: async () => Promise.reject(new ApiError(status, 'ERROR', 'x')) }).d;
      expect(await sendNewTask(d, { input, key: 'k1', files: [] }), String(status)).toEqual({ kind: 'no-answer', message: NEW_TASK_TEXT.serverTrouble });
      expect(await sendNewTask(d, { input, key: 'k1', files: [file('a')] }), String(status)).toEqual({ kind: 'no-answer', message: NEW_TASK_TEXT.serverTrouble });
    }
    expect(NEW_TASK_TEXT.serverTrouble).toBe('The server had a problem — the task may already be created. Tap Create task again to finish: it won’t be created twice.');
  });

  it('too many tries (429): nothing was taken — the same key, nothing locked, wait a moment', async () => {
    const d = deps({ createKept: async () => Promise.reject(new ApiError(429, 'RATE_LIMITED', 'Too many requests')) }).d;
    expect(await sendNewTask(d, { input, key: 'k1', files: [] })).toEqual({ kind: 'not-sent', message: NEW_TASK_TEXT.tooMany });
    expect(NEW_TASK_TEXT.tooMany).toBe('Too many tries just now — wait a moment, then tap Create task again.');
  });
});
