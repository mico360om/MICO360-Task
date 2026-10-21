/**
 * The New task form (4a), as on the website (Web Portal/frontend/src/components/task-form/
 * TaskFormDialog.tsx): where the task goes (project and column), what it is (title, description),
 * when and how urgent (priority, due date, repeat), who does it (several assignees, from the
 * project's active members), whether it is a milestone, and files attached once it exists.
 *
 * Sending follows the app's offline rules: a task without files goes through the offline queue
 * under its Idempotency-Key (kept on this phone when it gets no answer, sent later — never twice);
 * a task with files needs a connection, so it is never kept, and one that got no answer keeps its
 * key and locks the form until a definite answer (the server matches the key, not what is sent).
 * Pure, so it is tested here (task-form.test.ts also checks the words against the website).
 */
import { ApiError, isNetworkError } from './api-client';
import { uploadErrorMessage, uploadMimeType } from './attachments';
import { validateAttachment } from './chat-model';
import { isKeptOnPhone, keptOnPhoneText } from './write-order';
import { recurrenceSummary } from './recurrence-summary';
import { displayName, type ApiColumn, type ApiDirectoryUser, type ApiMember, type ApiTask, type Priority, type RecurrenceRule } from './types';

/** The website's limits for the title and description. */
export const TITLE_MAX = 191;
export const DESCRIPTION_MAX = 20_000;

/** The form's words that aren't worked out (the website's, checked by the test). */
export const NEW_TASK_TEXT = {
  noProjects: 'Create a project first, then you can add tasks to it.',
  milestoneHint: 'A key date or deliverable of the project — listed on its dashboard.',
  noDueForRepeat: 'Set a due date to see the next dates.',
  offlineWithFiles: 'You’re offline, and files can’t be attached offline. Try again when you’re connected, or remove the files to save the task now.',
  /** A try that got no answer in time may be on the server: the next tap finishes it under the same key. */
  noAnswer: 'The server didn’t answer in time — the task may already be created. Tap Create task again to finish: it won’t be created twice.',
  stillSaving: 'The task is still being created — wait a moment, then tap Create task again.',
  /** A 5xx or 408 (a proxy's 502/504 too): the server may have finished it — the key stays (4a review). */
  serverTrouble: 'The server had a problem — the task may already be created. Tap Create task again to finish: it won’t be created twice.',
  /** 429: the server didn't take it at all. */
  tooMany: 'Too many tries just now — wait a moment, then tap Create task again.',
  /** Shown while the form is locked after a try with files got no answer. */
  locked:
    'Until the task is created, its details can’t change — if the first try reached the server, a change made now would be lost. You can still add or take off files, or start over.',
  filesHint: 'Up to 10 MB each and 50 MB in all · pictures, PDFs, text, CSV, ZIP and Office files · attached once the task is created.',
  /** A changed form would go under a key whose first try may be saved (5b review): not sent. */
  changedSinceTry: 'Your last try may have created the task, so the changed details weren’t sent. Tap Create task to finish that try, or start over.',
} as const;

/** What a create's key carried (5b review): a try kept under it is sent again only with exactly this. */
export function keptTry(input: NewTaskInput): string {
  return JSON.stringify(input);
}

/** Why this form can't go under the kept key (it changed since that try), or null to send it. */
export function keptTryProblem(kept: string | null, input: NewTaskInput): string | null {
  return kept && kept !== keptTry(input) ? NEW_TASK_TEXT.changedSinceTry : null;
}

/** "Start over" on a locked form: a new try (a new key), after a warning. */
export const START_OVER = {
  label: 'Start over',
  title: 'Start over?',
  message: 'If the first try reached the server, the task may already be created — check the board first, or you may end up with two. Starting over lets you change the form and create it as a new task.',
  confirm: 'Start over',
} as const;

export interface TaskDraft {
  projectId: string;
  columnId: string;
  title: string;
  description: string;
  priority: Priority;
  /** 'YYYY-MM-DD' (a company calendar day), or '' for none. */
  dueDate: string;
  rule: RecurrenceRule | null;
  assigneeIds: string[];
  milestone: boolean;
}

/** A new task as it opens: in the project and column it was opened from, on the day chosen (the calendar's). */
export function newTaskDraft(o: { projectId?: string; columnId?: string; dueDate?: string }): TaskDraft {
  return { projectId: o.projectId ?? '', columnId: o.columnId ?? '', title: '', description: '', priority: 'NORMAL', dueDate: o.dueDate ?? '', rule: null, assigneeIds: [], milestone: false };
}

// ── Where the task goes ──────────────────────────────────────────────────────

/** A project as the form needs it (the list's rows carry the owner, who gets a task nobody was picked for). */
export interface FormProject {
  id: string;
  name: string;
  code: string;
  number?: string | null;
  status: string;
  ownerId?: string | null;
}

/** The projects a task can be added to: those not archived (the website's rule). */
export function openProjectsOf<P extends Pick<FormProject, 'status'>>(projects: readonly P[] | null | undefined): P[] {
  return Array.isArray(projects) ? projects.filter((p) => p.status !== 'ARCHIVED') : [];
}

/** Where this phone keeps the project a person's last new task went to (the website keeps it in the browser). */
export function lastProjectKey(userId: string): string {
  return `mico360.newTask.project.${userId}`;
}

/** The project the form starts in: a fixed one (a board), the page's own, the one used last time, then the first open one. */
export function startProjectId(o: { fixed?: string | null; preferred?: string | null; last?: string | null; open: readonly { id: string }[] }): string {
  if (o.fixed) return o.fixed;
  const known = (id: string | null | undefined) => !!id && o.open.some((p) => p.id === id);
  if (known(o.preferred)) return o.preferred!;
  if (known(o.last)) return o.last!;
  return o.open[0]?.id ?? '';
}

/** A project's columns in board order, without the ones turned off. */
export function formColumns(columns: readonly ApiColumn[] | null | undefined): ApiColumn[] {
  return (Array.isArray(columns) ? columns : []).filter((c) => c.enabled !== false).sort((a, b) => a.position - b.position);
}

/**
 * The column to show: the one chosen while it is there; after a project change the same kind of
 * column (e.g. "in progress") when the new project has one; else the column asked for; else the first.
 */
export function pickColumn(columns: readonly ApiColumn[], o: { current: string; preferKind?: string | null; defaultColumnId?: string | null }): string {
  if (o.current && columns.some((c) => c.id === o.current)) return o.current;
  const pick = (o.preferKind ? columns.find((c) => c.category === o.preferKind) : undefined) ?? columns.find((c) => c.id === o.defaultColumnId) ?? columns[0];
  return pick?.id ?? '';
}

// ── Who does it ──────────────────────────────────────────────────────────────

export interface PersonOption {
  id: string;
  name: string;
  username: string;
  avatarUrl: string | null;
}

/**
 * Who can be assigned: the project's members, without the accounts the directory marks inactive
 * (the server refuses them: "Only active members of this project can be assigned"), with their pictures.
 */
export function assignablePeople(members: readonly ApiMember[] | null | undefined, directory: readonly ApiDirectoryUser[] | null | undefined): PersonOption[] {
  const dir = new Map((Array.isArray(directory) ? directory : []).map((d) => [d.id, d]));
  return (Array.isArray(members) ? members : [])
    .filter((m) => dir.get(m.id)?.active !== false)
    .map((m) => ({ id: m.id, name: displayName(m), username: m.username, avatarUrl: dir.get(m.id)?.avatarUrl ?? null }));
}

const listNames = (names: string[]) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

/** Someone who isn't on the newly chosen project can't work on the task there: taken off, and said so. */
export function prunedAssignees(ids: string[], people: readonly PersonOption[], known: ReadonlyMap<string, string>, projectName: string | null): { ids: string[]; notice: string | null } {
  const onTeam = new Set(people.map((p) => p.id));
  const gone = ids.filter((id) => !onTeam.has(id));
  if (gone.length === 0) return { ids, notice: null };
  const names = gone.map((id) => known.get(id) ?? 'Someone');
  return {
    ids: ids.filter((id) => onTeam.has(id)),
    notice: `${listNames(names)} ${names.length === 1 ? 'isn’t' : 'aren’t'} on ${projectName ?? 'that project'}, so they were taken off this task.`,
  };
}

/**
 * After a project change whose people can't be loaded (offline with no copy — 4a review): nobody
 * picked can be checked against the new team, and a task kept for later with someone off it would
 * be refused on every try — so they are taken off, saying so.
 */
export function assigneesWithoutTeam(ids: string[], known: ReadonlyMap<string, string>, projectName: string | null): { ids: string[]; notice: string | null } {
  if (ids.length === 0) return { ids, notice: null };
  const names = ids.map((id) => known.get(id) ?? 'Someone');
  return {
    ids: [],
    notice: `The people on ${projectName ?? 'that project'} couldn’t be loaded, so ${listNames(names)} ${names.length === 1 ? 'was' : 'were'} taken off this task. Pick them again when you’re online.`,
  };
}

/** The project's owner by name, only when they are an active member (the server gives them the task only then — as the website says it). */
export function projectOwnerName(ownerId: string | null | undefined, people: readonly Pick<PersonOption, 'id' | 'name'>[]): string | null {
  if (!ownerId) return null;
  return people.find((p) => p.id === ownerId)?.name ?? null;
}

/** Who gets the task when nobody is picked: the project's owner (the server's default), or nobody. */
export function assigneeNote(ids: readonly string[], ownerName: string | null): string | null {
  if (ids.length) return null;
  return ownerName ? `Nobody picked — the task will go to ${ownerName}, the project owner.` : 'Nobody picked — the task will be unassigned.';
}

// ── The repeat ───────────────────────────────────────────────────────────────

/** "Repeats every week on Thu": a weekly rule without chosen days repeats on the due date's weekday. */
export function scheduleText(rule: RecurrenceRule, dueDate: string): string {
  if (rule.freq === 'WEEKLY' && !rule.weekdays?.length && /^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    return recurrenceSummary({ ...rule, weekdays: [new Date(`${dueDate}T00:00:00Z`).getUTCDay()] });
  }
  return recurrenceSummary(rule);
}

export function untilProblem(rule: RecurrenceRule | null, dueDate: string): string | null {
  return rule?.until && dueDate && String(rule.until).slice(0, 10) < dueDate ? 'The repeat can’t end before the due date.' : null;
}

// ── Checking and sending ─────────────────────────────────────────────────────

/** What POST /tasks gets: only what was given; people only when picked (else the project's default). */
export interface NewTaskInput {
  projectId: string;
  columnId: string;
  title: string;
  priority: Priority;
  description?: string;
  dueDate?: string;
  recurrenceRule?: RecurrenceRule;
  isMilestone?: true;
  assigneeIds?: string[];
  /** The board day the task belongs to (per-date boards). */
  boardDate?: string;
}

export type DraftCheck = { ok: true; input: NewTaskInput } | { ok: false; field: 'title' | 'repeat' | 'place'; message: string };

export function checkNewTask(d: TaskDraft, o: { noProjects: boolean; boardDate?: string }): DraftCheck {
  const title = d.title.trim();
  if (!title) return { ok: false, field: 'title', message: 'Give the task a title.' };
  const until = untilProblem(d.rule, d.dueDate);
  if (until) return { ok: false, field: 'repeat', message: until };
  if (!d.projectId || !d.columnId) return { ok: false, field: 'place', message: o.noProjects ? 'Create a project first.' : 'Choose where the task goes: its project and column.' };
  const description = d.description.trim();
  return {
    ok: true,
    input: {
      projectId: d.projectId,
      columnId: d.columnId,
      title: title.slice(0, TITLE_MAX),
      priority: d.priority,
      ...(description ? { description: description.slice(0, DESCRIPTION_MAX) } : {}),
      ...(d.dueDate ? { dueDate: d.dueDate } : {}),
      ...(d.rule ? { recurrenceRule: d.rule } : {}),
      ...(d.milestone ? { isMilestone: true as const } : {}),
      ...(d.assigneeIds.length ? { assigneeIds: [...new Set(d.assigneeIds)] } : {}),
      ...(o.boardDate ? { boardDate: o.boardDate } : {}),
    },
  };
}

/**
 * Is there something to keep? What you typed or chose — not what the form filled in itself (the
 * day it was opened on, the project and column it settled on), unless you picked the place.
 */
export function isDraftDirty(d: TaskDraft, saved: TaskDraft, o: { placeChosen: boolean; files: number }): boolean {
  const mine = (x: TaskDraft) => JSON.stringify({ ...x, projectId: '', columnId: '' });
  return o.placeChosen || o.files > 0 || mine(d) !== mine(saved);
}

/** What Back asks before leaving with something not saved. */
export function leaveWarning({ saving, locked }: { saving: boolean; locked: boolean }): { title: string; message: string; stay: string; leave: string } {
  if (saving) return { title: 'Leave while saving?', message: 'The task may still be saving. Check the board before adding it again.', stay: 'Stay', leave: 'Leave' };
  if (locked) return { title: 'Leave without finishing?', message: 'The task may already be created — check the board before adding it again.', stay: 'Stay', leave: 'Leave' };
  return { title: 'Discard this task?', message: 'What you entered hasn’t been saved.', stay: 'Keep editing', leave: 'Discard' };
}

export function submitLabel({ created, saving, uploading }: { created: boolean; saving: boolean; uploading: boolean }): string {
  if (created) return 'Done';
  if (saving) return uploading ? 'Attaching files…' : 'Creating…';
  return 'Create task';
}

// ── Files ────────────────────────────────────────────────────────────────────

/** A file waiting to go up with a new task; `fraction` while it uploads, `error` if it couldn't. */
export interface NewTaskFile {
  key: string;
  uri: string;
  name: string;
  mimeType: string | null;
  size: number | null;
  fraction?: number;
  error?: string;
}

/** The files the picker gave, added after the ones already there (each with its own key). */
/** The most a task holds in files (the server's UPLOAD_MAX_TOTAL_BYTES_PER_TASK default). */
export const TASK_FILES_MAX_BYTES = 50 * 1024 * 1024;

/**
 * Picked files checked against the server's rules before anything is sent (4a review): each up to
 * 10 MB, of a kind it takes (validateAttachment, as for chat files), not empty, and 50 MB in all
 * with what the task holds already (`alreadyBytes`). The ones that pass, and why the rest didn't.
 * Counted as picked: the server makes pictures smaller only after this check.
 */
export function checkTaskFiles<F extends { name: string; size?: number | null; mimeType?: string | null }>(
  alreadyBytes: number,
  picked: readonly F[],
): { ok: F[]; problems: string[]; refused: { file: F; reason: string }[] } {
  const ok: F[] = [];
  const problems: string[] = [];
  const refused: { file: F; reason: string }[] = [];
  let total = alreadyBytes;
  for (const f of picked) {
    const size = typeof f.size === 'number' ? f.size : null;
    const problem = validateAttachment({ name: f.name, size: size ?? 1, type: uploadMimeType(f.name, f.mimeType) });
    const reason = problem ?? (size !== null && total + size > TASK_FILES_MAX_BYTES ? `“${f.name}” would take this task past 50 MB of files.` : null);
    if (reason) {
      problems.push(reason);
      refused.push({ file: f, reason });
      continue;
    }
    total += size ?? 0;
    ok.push(f);
  }
  return { ok, problems, refused };
}

export function withPickedFiles(
  files: NewTaskFile[],
  picked: readonly { uri: string; name: string; mimeType?: string | null; size?: number | null }[],
  seq: { n: number },
): NewTaskFile[] {
  return [...files, ...picked.map((p) => ({ key: `f${++seq.n}`, uri: p.uri, name: p.name, mimeType: p.mimeType ?? null, size: typeof p.size === 'number' ? p.size : null }))];
}

export function createdWithoutFilesText(failed: readonly { name: string; reason: string }[]): string {
  return failed.length === 1
    ? `The task was created, but ${failed[0]!.name} wasn’t attached: ${failed[0]!.reason}`
    : `The task was created, but these files weren’t attached: ${failed.map((f) => `${f.name} (${f.reason})`).join('; ')}. Add them from the task.`;
}

/**
 * How a New task ended after its form was left while it was still sending (4a review): said in a
 * toast, since the form is gone.
 */
export function leftWhileSendingText(out: NewTaskOutcome): string {
  switch (out.kind) {
    case 'created':
      return `Created ${out.task.key}, with its files.`;
    case 'files-failed':
      return createdWithoutFilesText(out.failed);
    case 'no-answer':
      return 'The server didn’t answer in time — the task may already be created. Check the board before adding it again.';
    default:
      return out.message;
  }
}

function reasonOf(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 403) return 'You don’t have permission to do that.';
    if (err.message && !/^Request failed/.test(err.message)) return err.message;
  }
  return 'Please try again.';
}

export type NewTaskOutcome =
  | { kind: 'created'; task: ApiTask }
  /** Created, but some files weren't attached ("Done" then closes). */
  | { kind: 'files-failed'; task: ApiTask; failed: { key: string; name: string; reason: string }[] }
  /** No answer, no files: kept on this phone; the queue sends it (with the same key). */
  | { kind: 'kept'; message: string }
  /** No answer (or the first try is still being saved): it may be on the server — the key stays and the form is locked. */
  | { kind: 'no-answer'; message: string }
  /** Not taken: offline with files (the request never left), or too many tries (429) — nothing is locked, the key stays. */
  | { kind: 'not-sent'; message: string }
  /** The server refused it: the form stays as it is, and the next try is a new one. */
  | { kind: 'refused'; message: string };

export interface SendNewTaskDeps {
  /** POST /tasks under the key, through the offline queue (sendInOrder): kept on this phone when no answer comes. */
  createKept: (input: NewTaskInput, key: string) => Promise<ApiTask>;
  /** POST /tasks under the key, never kept (a task with files needs a connection). */
  createLive: (input: NewTaskInput, key: string) => Promise<ApiTask>;
  upload: (taskId: string, file: NewTaskFile, onProgress: (fraction: number) => void) => Promise<unknown>;
  /** A file's progress or failure, for the list. */
  onFile: (key: string, patch: Partial<NewTaskFile>) => void;
}

/** Create the task (one request, with its people), then attach its files one by one. */
export async function sendNewTask(deps: SendNewTaskDeps, req: { input: NewTaskInput; key: string; files: readonly NewTaskFile[] }): Promise<NewTaskOutcome> {
  const withFiles = req.files.length > 0;
  let task: ApiTask;
  try {
    task = await (withFiles ? deps.createLive : deps.createKept)(req.input, req.key);
  } catch (e) {
    if (e instanceof ApiError && e.code === 'IDEMPOTENCY_IN_PROGRESS') return { kind: 'no-answer', message: NEW_TASK_TEXT.stillSaving };
    // A server problem isn't a refusal (4a review): the server may have finished the task behind a
    // proxy's 502/504, and it lets the key go on a 5xx — the same key goes again, the form locked.
    if (e instanceof ApiError && (e.status >= 500 || e.status === 408)) return { kind: 'no-answer', message: NEW_TASK_TEXT.serverTrouble };
    if (e instanceof ApiError && e.status === 429) return { kind: 'not-sent', message: NEW_TASK_TEXT.tooMany };
    if (isNetworkError(e)) {
      if (!withFiles && isKeptOnPhone(e)) return { kind: 'kept', message: keptOnPhoneText(e) };
      // Files can't wait offline with the task: say so rather than save it without them. Offline
      // the request never left, so the form isn't locked; only a try with no answer may be saved.
      const timedOut = (e as { timedOut?: unknown }).timedOut === true;
      if (withFiles && !timedOut) return { kind: 'not-sent', message: NEW_TASK_TEXT.offlineWithFiles };
      return { kind: 'no-answer', message: NEW_TASK_TEXT.noAnswer };
    }
    return { kind: 'refused', message: `Couldn’t create the task. ${reasonOf(e)}` };
  }
  const failed: { key: string; name: string; reason: string }[] = [];
  for (const f of req.files) {
    deps.onFile(f.key, { fraction: 0, error: undefined });
    try {
      await deps.upload(task.id, f, (fraction) => deps.onFile(f.key, { fraction }));
      deps.onFile(f.key, { fraction: 1 });
    } catch (e) {
      const reason = uploadErrorMessage(e);
      deps.onFile(f.key, { fraction: undefined, error: reason });
      failed.push({ key: f.key, name: f.name, reason });
    }
  }
  return failed.length ? { kind: 'files-failed', task, failed } : { kind: 'created', task };
}
