import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { projectsApi } from '../../api/projects';
import { columnsApi } from '../../api/columns';
import { membersApi } from '../../api/members';
import { usersApi } from '../../api/users';
import { assigneesApi } from '../../api/assignees';
import { aiApi } from '../../api/ai';
import { tasksApi, type ApiTask, type NewTaskInput, type Priority, type RecurrenceRule } from '../../api/tasks';
import { ApiError } from '../../lib/api-client';
import { todayKey } from '../../lib/due-date';
import { dueInputValue } from '../../lib/due-display';
import { recurrenceSummary } from '../../lib/recurrence-summary';
import { useCompanyTimeZone } from '../../lib/company-clock';
import { enqueueOffline } from '../../lib/offline-replay';
import { newIdempotencyKey } from '../../lib/offline-queue';
import { invalidateTaskQueries } from '../../lib/task-cache';
import { useDialog } from '../../hooks/useDialog';
import { ModalPortal } from '../ui/ModalPortal';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { SearchableSelect } from '../ui/SearchableSelect';
import { ProjectAvatar } from '../ProjectAvatar';
import { projectOption } from '../project-option';
import { priorityOptions } from '../priority-option';
import { RecurrenceEditor, REPEAT_FREQUENCIES, REPEAT_LABEL, withFrequency } from '../RecurrenceEditor';
import { AssigneeSelect, type PersonOption } from './AssigneeSelect';
import { DescribeTask } from './DescribeTask';
import { FilesField, type PendingFile } from './FilesField';
import { attachmentsApi } from '../../api/attachments';
import { pastedFiles } from '../../lib/clipboard-files';
import { isTypingTarget } from '../../lib/shortcuts';
import { MilestoneIcon } from '../TaskCard';

export interface TaskFormDialogProps {
  onClose: () => void;
  /** Edit this task; without it the form creates a new one. */
  task?: ApiTask | null;
  onCreated?: (task: ApiTask) => void;
  onSaved?: (task: ApiTask) => void;
  /** Create in this project only (e.g. from its board): shown, not changeable. */
  projectId?: string;
  /** Start in this project (the one the page shows) — still changeable. Ignored when archived or unknown. */
  defaultProjectId?: string;
  /** Start in this column (e.g. the one chosen on the board). */
  defaultColumnId?: string;
  /** Start with this due date ('YYYY-MM-DD'), e.g. the day chosen on the calendar. */
  defaultDueDate?: string;
  /** The board day the new task belongs to (per-date boards). */
  boardDate?: string;
  /** Offline: the new task was kept to send later, and the form closed. */
  onQueued?: () => void;
}

interface Draft {
  projectId: string;
  columnId: string;
  title: string;
  description: string;
  priority: Priority;
  dueDate: string;
  rule: RecurrenceRule | null;
  assigneeIds: string[];
  milestone: boolean;
}

export const TITLE_MAX = 191;
const DESCRIPTION_MAX = 20_000;
const LAST_PROJECT = 'mico360.newTask.project';

const sameRule = (a: RecurrenceRule | null, b: RecurrenceRule | null) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const fullName = (u: { firstName?: string | null; lastName?: string | null; username: string }) => [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username;
const listNames = (names: string[]) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

/** Why a file couldn't be attached, in the task panel's words. */
function fileFailure(err: unknown): string {
  if (err instanceof ApiError && err.status === 413) return 'That file is too large to upload.';
  if (err instanceof TypeError) return 'The server couldn’t be reached.';
  if (err instanceof Error && err.message && !/^Request failed/.test(err.message)) return err.message;
  return 'It couldn’t be uploaded.';
}

function reasonOf(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 403) return 'You don’t have permission to do that.';
    if (err.message && !/^Request failed/.test(err.message)) return err.message;
  }
  if (err instanceof TypeError) return 'The server couldn’t be reached.';
  return 'Please try again.';
}

/** "Repeats every week on Thu": a weekly rule without chosen days repeats on the due date's weekday. */
function scheduleText(rule: RecurrenceRule, dueDate: string): string {
  if (rule.freq === 'WEEKLY' && !rule.weekdays?.length && /^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    return recurrenceSummary({ ...rule, weekdays: [new Date(`${dueDate}T00:00:00Z`).getUTCDay()] });
  }
  return recurrenceSummary(rule);
}

const fieldClass = (bad = false) =>
  `block w-full rounded-xl border bg-surface px-3.5 text-base text-ink outline-none transition-colors placeholder:text-ink-3 focus:ring-2 sm:text-sm ${
    bad ? 'border-danger focus:border-danger focus:ring-danger/20' : 'border-line hover:border-ink-3 focus:border-brand focus:ring-brand/20'
  }`;

function Label({ htmlFor, required, optional, children }: { htmlFor?: string; required?: boolean; optional?: boolean; children: ReactNode }) {
  const inner = (
    <>
      {children}
      {required ? <span aria-hidden="true" className="text-danger">*</span> : null}
      {optional ? <span className="text-xs font-normal text-ink-2">(optional)</span> : null}
    </>
  );
  const cls = 'mb-1.5 flex items-baseline gap-1.5 text-sm font-semibold text-ink';
  return htmlFor ? <label htmlFor={htmlFor} className={cls}>{inner}</label> : <span className={cls}>{inner}</span>;
}

/**
 * The task form, for a new task and for editing one: where it goes (project and column), what it is
 * (title, description), when and how urgent (priority, due date, repeat) and who does it. A new task
 * can be started from a plain-English description. Saving shows progress and is never sent twice;
 * what was entered stays after a failure, and closing with changes asks first.
 */
export function TaskFormDialog({ onClose, task, onCreated, onSaved, projectId: fixedProjectId, defaultProjectId, defaultColumnId, defaultDueDate, boardDate, onQueued }: TaskFormDialogProps) {
  const editing = !!task;
  const qc = useQueryClient();
  const timeZone = useCompanyTimeZone();
  const ids = { title: useId(), desc: useId(), due: useId(), titleErr: useId(), untilErr: useId(), owner: useId() };

  const start = (): Draft =>
    task
      ? {
          projectId: task.projectId,
          columnId: task.columnId,
          title: task.title,
          description: task.description ?? '',
          priority: task.priority,
          dueDate: dueInputValue(task.dueDate, timeZone),
          rule: task.recurrenceRule ?? null,
          assigneeIds: [],
          milestone: !!task.isMilestone,
        }
      : { projectId: fixedProjectId ?? '', columnId: defaultColumnId ?? '', title: '', description: '', priority: 'NORMAL', dueDate: defaultDueDate ?? '', rule: null, assigneeIds: [], milestone: false };
  // `saved` is what the server has (or, for a new task, how the form opened); `draft` is the form.
  const [saved, setSaved] = useState<Draft>(start);
  const [draft, setDraft] = useState<Draft>(start);
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  /** A value the form fills in itself (a default, data that loaded) — not a change of yours. */
  const settle = (patch: Partial<Draft>) => {
    setSaved((s) => ({ ...s, ...patch }));
    set(patch);
  };
  const [placeChosen, setPlaceChosen] = useState(false);
  const [scope, setScope] = useState<'one' | 'series'>('one');
  const [titleError, setTitleError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  // Files for a new task (chosen, dropped or pasted); they go up once the task exists.
  const [files, setFiles] = useState<PendingFile[]>([]);
  const fileSeq = useRef(0);
  // Set when the task was created but a file couldn't be attached: "Done" then closes.
  const [created, setCreated] = useState<ApiTask | null>(null);
  const busy = useRef(false);
  const version = useRef(task?.version);
  const titleRef = useRef<HTMLInputElement>(null);
  const untilRef = useRef<HTMLDivElement>(null);

  const dirty =
    placeChosen ||
    files.length > 0 ||
    JSON.stringify({ ...draft, projectId: '', columnId: '' }) !== JSON.stringify({ ...saved, projectId: '', columnId: '' }) ||
    draft.columnId !== saved.columnId;
  const finish = (task: ApiTask) => {
    onCreated?.(task);
    onClose();
  };
  const requestClose = () => {
    if (busy.current) return;
    if (created) finish(created);
    else if (dirty) setConfirmClose(true);
    else onClose();
  };
  const addFiles = (more: File[]) => {
    if (more.length) setFiles((f) => [...f, ...more.map((file) => ({ key: `f${++fileSeq.current}`, file }))]);
  };
  const patchFile = (key: string, patch: Partial<PendingFile>) => setFiles((f) => f.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  const dialogRef = useDialog(requestClose);

  // ── Where the task goes ──
  const projectsQ = useQuery({ queryKey: ['projects'], queryFn: () => projectsApi(apiClient).list() });
  const allProjects = useMemo(() => (Array.isArray(projectsQ.data) ? projectsQ.data : []), [projectsQ.data]);
  const openProjects = useMemo(() => allProjects.filter((p) => p.status !== 'ARCHIVED'), [allProjects]);
  const project = allProjects.find((p) => p.id === draft.projectId) ?? null;
  const projectFixed = editing || !!fixedProjectId;
  const noProjects = !projectFixed && projectsQ.isSuccess && openProjects.length === 0;

  useEffect(() => {
    if (projectFixed || draft.projectId || openProjects.length === 0) return;
    let last: string | null = null;
    try { last = localStorage.getItem(LAST_PROJECT); } catch { /* storage unavailable */ }
    // The page's own project first, then the one used last time, then the first open project.
    const start = [defaultProjectId, last].find((id) => id && openProjects.some((p) => p.id === id)) ?? openProjects[0]!.id;
    settle({ projectId: start });
  }, [projectFixed, draft.projectId, openProjects, defaultProjectId]);

  const columnsQ = useQuery({ queryKey: ['columns', draft.projectId], queryFn: () => columnsApi(apiClient).list(draft.projectId), enabled: !!draft.projectId });
  const columns = useMemo(
    () => (Array.isArray(columnsQ.data) ? columnsQ.data : []).filter((c) => c.enabled !== false || c.id === task?.columnId).sort((a, b) => a.position - b.position),
    [columnsQ.data, task?.columnId],
  );
  // After a project change, land in the same kind of column (e.g. "in progress") when the new project has one.
  const preferKind = useRef<string | null>(null);
  useEffect(() => {
    if (!columnsQ.isSuccess || columns.length === 0 || columns.some((c) => c.id === draft.columnId)) return;
    const pick = columns.find((c) => preferKind.current && c.category === preferKind.current) ?? columns.find((c) => c.id === defaultColumnId) ?? columns[0]!;
    if (placeChosen) set({ columnId: pick.id });
    else settle({ columnId: pick.id });
  }, [columnsQ.isSuccess, columns, draft.columnId]);

  // ── Who can do it ──
  const membersQ = useQuery({ queryKey: ['members', draft.projectId], queryFn: () => membersApi(apiClient).list(draft.projectId), enabled: !!draft.projectId });
  const dirQ = useQuery({ queryKey: ['directory'], queryFn: () => usersApi(apiClient).directory() });
  const people = useMemo<PersonOption[]>(() => {
    const dir = Array.isArray(dirQ.data) ? dirQ.data : [];
    return (Array.isArray(membersQ.data) ? membersQ.data : []).map((m) => ({ id: m.id, name: fullName(m), username: m.username, avatarUrl: dir.find((d) => d.id === m.id)?.avatarUrl ?? null }));
  }, [membersQ.data, dirQ.data]);
  const known = useRef(new Map<string, string>());
  for (const p of people) known.current.set(p.id, p.name);

  const assigneesQ = useQuery({ queryKey: ['assignees', task?.id], queryFn: () => assigneesApi(apiClient).list(task!.id), enabled: editing });
  const assigneesLoaded = useRef(false);
  useEffect(() => {
    if (!editing || assigneesLoaded.current || !Array.isArray(assigneesQ.data)) return;
    assigneesLoaded.current = true;
    for (const a of assigneesQ.data) known.current.set(a.id, fullName(a));
    settle({ assigneeIds: assigneesQ.data.map((a) => a.id) });
  }, [editing, assigneesQ.data]);

  // Someone who isn't on the newly chosen project can't work on the task there.
  const pruneFor = useRef<string | null>(null);
  useEffect(() => {
    if (!pruneFor.current || pruneFor.current !== draft.projectId || !membersQ.isSuccess || membersQ.isFetching) return;
    pruneFor.current = null;
    const onTeam = new Set(people.map((p) => p.id));
    const gone = draft.assigneeIds.filter((id) => !onTeam.has(id));
    if (gone.length === 0) return;
    set({ assigneeIds: draft.assigneeIds.filter((id) => onTeam.has(id)) });
    const names = gone.map((id) => known.current.get(id) ?? 'Someone');
    setNotice(`${listNames(names)} ${names.length === 1 ? 'isn’t' : 'aren’t'} on ${project?.name ?? 'that project'}, so ${names.length === 1 ? 'they were' : 'they were'} taken off this task.`);
  }, [membersQ.isSuccess, membersQ.isFetching, people, draft.projectId]);

  function chooseProject(id: string) {
    if (id === draft.projectId) return;
    preferKind.current = columns.find((c) => c.id === draft.columnId)?.category ?? null;
    pruneFor.current = id;
    setNotice(null);
    setPlaceChosen(true);
    set({ projectId: id, columnId: '' });
  }

  const ownerName = project?.ownerId ? known.current.get(project.ownerId) ?? null : null;
  const assigneeNote = draft.assigneeIds.length
    ? null
    : editing
      ? 'Nobody is assigned.'
      : ownerName
        ? `Nobody picked — the task will go to ${ownerName}, the project owner.`
        : 'Nobody picked — the task will be unassigned.';

  // ── Repeat ──
  const inSeries = !!(task?.recurrenceRule || task?.recurrenceParentId);
  const canRepeat = !task?.recurrenceNextId;
  const untilProblem = draft.rule?.until && draft.dueDate && draft.rule.until.slice(0, 10) < draft.dueDate ? 'The repeat can’t end before the due date.' : null;

  // ── Saving ──
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy.current) return;
    if (created) {
      finish(created); // the task exists already: never a second one
      return;
    }
    if (!draft.title.trim()) {
      setTitleError('Give the task a title.');
      titleRef.current?.focus();
      return;
    }
    if (untilProblem) {
      untilRef.current?.querySelector<HTMLElement>('input[aria-label="End date"]')?.focus();
      return;
    }
    if (!draft.projectId || !draft.columnId) {
      setBanner(noProjects ? 'Create a project first.' : 'Choose where the task goes: its project and column.');
      return;
    }
    busy.current = true;
    setSaving(true);
    setBanner(null);
    try {
      if (editing) await saveChanges();
      else await create();
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  async function create() {
    const input: NewTaskInput & { recurrenceRule?: RecurrenceRule } = {
      projectId: draft.projectId,
      columnId: draft.columnId,
      title: draft.title.trim(),
      priority: draft.priority,
      ...(draft.description.trim() ? { description: draft.description.trim() } : {}),
      ...(draft.dueDate ? { dueDate: draft.dueDate } : {}),
      ...(draft.rule ? { recurrenceRule: draft.rule } : {}),
      ...(draft.milestone ? { isMilestone: true } : {}),
      // Only when someone was picked — otherwise the project's default (its owner) applies.
      ...(draft.assigneeIds.length ? { assigneeIds: draft.assigneeIds } : {}),
      ...(boardDate ? { boardDate } : {}),
    };
    // One key per attempt: the offline queue reuses it, so a create that did reach the server is never duplicated.
    const idempotencyKey = newIdempotencyKey();
    try {
      const created = await tasksApi(apiClient).create(input, { idempotencyKey });
      if (!fixedProjectId) {
        try { localStorage.setItem(LAST_PROJECT, draft.projectId); } catch { /* storage unavailable */ }
      }
      void invalidateTaskQueries(qc);
      if (files.length) {
        const failed = await attachFiles(created);
        void invalidateTaskQueries(qc);
        void qc.invalidateQueries({ queryKey: ['attachments', created.id] });
        if (failed.length) {
          setCreated(created);
          setBanner(
            failed.length === 1
              ? `The task was created, but ${failed[0]!.name} wasn’t attached: ${failed[0]!.reason}`
              : `The task was created, but these files weren’t attached: ${failed.map((f) => `${f.name} (${f.reason})`).join('; ')}. Add them from the task.`,
          );
          return;
        }
      }
      finish(created);
    } catch (err) {
      // Files can't wait offline with the task: say so rather than save it without them.
      if (!(err instanceof ApiError) && files.length) {
        setBanner('You’re offline, and files can’t be attached offline. Try again when you’re connected, or remove the files to save the task now.');
        return;
      }
      // Offline: keep the task and send it when the connection returns (server refusals stay on screen).
      if (!(err instanceof ApiError) && enqueueOffline('task.create', input, { idempotencyKey })) {
        onQueued?.();
        onClose();
        return;
      }
      setBanner(`Couldn’t create the task. ${reasonOf(err)}`);
    }
  }

  /** Upload the new task's files one by one, with progress; returns the ones that couldn't go up. */
  async function attachFiles(task: ApiTask): Promise<Array<{ name: string; reason: string }>> {
    const failed: Array<{ name: string; reason: string }> = [];
    for (const p of files) {
      patchFile(p.key, { fraction: 0, error: undefined });
      try {
        await attachmentsApi(apiClient).upload(task.id, p.file, (fraction) => patchFile(p.key, { fraction }));
        patchFile(p.key, { fraction: 1 });
      } catch (err) {
        const reason = fileFailure(err);
        patchFile(p.key, { fraction: undefined, error: reason });
        failed.push({ name: p.file.name, reason });
      }
    }
    return failed;
  }

  async function saveChanges() {
    const t = task!;
    let done = saved;
    let latest: ApiTask = t;
    const keep = (patch: Partial<Draft>) => {
      done = { ...done, ...patch };
      setSaved(done);
    };
    const series = inSeries && scope === 'series';
    try {
      const fields: Parameters<ReturnType<typeof tasksApi>['update']>[1] = {};
      if (draft.title.trim() !== done.title.trim()) fields.title = draft.title.trim();
      if (draft.description.trim() !== done.description.trim()) fields.description = draft.description.trim();
      if (draft.priority !== done.priority) fields.priority = draft.priority;
      if (draft.dueDate !== done.dueDate) fields.dueDate = draft.dueDate || null;
      if (draft.milestone !== done.milestone) fields.isMilestone = draft.milestone;
      const ruleChanged = canRepeat && !sameRule(draft.rule, done.rule);
      if (ruleChanged && !series) fields.recurrenceRule = draft.rule;
      if (Object.keys(fields).length) {
        latest = await tasksApi(apiClient).update(t.id, { ...fields, ...(version.current != null ? { expectedVersion: version.current } : {}), ...(series ? { scope: 'series' } : {}) });
        version.current = latest.version ?? version.current;
        keep({ title: draft.title, description: draft.description, priority: draft.priority, dueDate: draft.dueDate, milestone: draft.milestone, ...(ruleChanged && !series ? { rule: draft.rule } : {}) });
      }
      // The repeat rule lives on the series' newest copy only: it is never sent "for the whole series".
      if (ruleChanged && series) {
        latest = await tasksApi(apiClient).update(t.id, { recurrenceRule: draft.rule });
        version.current = latest.version ?? version.current;
        keep({ rule: draft.rule });
      }
      if (draft.columnId !== done.columnId) {
        latest = await tasksApi(apiClient).move(t.id, draft.columnId);
        version.current = latest.version ?? version.current;
        keep({ columnId: draft.columnId });
      }
      const add = draft.assigneeIds.filter((id) => !done.assigneeIds.includes(id));
      if (add.length) {
        await assigneesApi(apiClient).assignMany(t.id, add);
        keep({ assigneeIds: [...done.assigneeIds, ...add] });
      }
      for (const id of done.assigneeIds.filter((x) => !draft.assigneeIds.includes(x))) {
        await assigneesApi(apiClient).unassign(t.id, id);
        keep({ assigneeIds: done.assigneeIds.filter((x) => x !== id) });
      }
      void invalidateTaskQueries(qc);
      void qc.invalidateQueries({ queryKey: ['task', t.id] });
      void qc.invalidateQueries({ queryKey: ['assignees', t.id] });
      void qc.invalidateQueries({ queryKey: ['task-activity', t.id] });
      onSaved?.(latest);
      onClose();
    } catch (err) {
      if (done !== saved) void invalidateTaskQueries(qc);
      setBanner(
        err instanceof ApiError && err.code === 'VERSION_CONFLICT'
          ? 'Someone else changed this task while you were editing. Close this form and open the task again to see their changes — then make yours.'
          : `Couldn’t save ${done !== saved ? 'all of ' : ''}the changes. ${reasonOf(err)}`,
      );
    }
  }

  const columnOptions = columns.map((c) => ({ value: c.id, label: c.name, icon: <span className="h-2.5 w-2.5 rounded-full" style={{ background: c.color }} /> }));
  const repeatOptions = [{ value: 'NONE', label: 'Does not repeat' }, ...REPEAT_FREQUENCIES.map((f) => ({ value: f, label: REPEAT_LABEL[f] }))];
  const heading = editing ? 'Edit task' : 'New task';

  return (
    <ModalPortal>
      <div className="above-keyboard fixed inset-0 z-50 flex items-stretch justify-center sm:items-center sm:p-4">
        <div className="absolute inset-0 bg-ink/40 animate-fade-in" onClick={requestClose} aria-hidden="true" />
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label={heading}
          // A picture pasted anywhere in a new task's form (Ctrl+V) is added to its files; text pasted
          // into a field stays text (see pastedFiles).
          onPaste={(e) => {
            if (editing || created || saving) return;
            const got = pastedFiles(e.clipboardData, { typing: e.target instanceof Element && isTypingTarget(e.target) });
            if (got.length === 0) return;
            e.preventDefault();
            addFiles(got);
          }}
          className="keyboard-flow-cramped relative flex h-full w-full flex-col overflow-hidden bg-surface shadow-lift animate-scale-in sm:h-auto sm:max-h-[calc(var(--visible-height)*0.9)] sm:w-[min(800px,calc(100vw-32px))] sm:rounded-2xl"
        >
          <div className="flex flex-none items-center gap-3 border-b border-line px-4 py-3.5 sm:px-6">
            <h2 className="font-display text-xl font-bold text-ink">{heading}</h2>
            {task ? <span className="rounded-md bg-ground px-1.5 py-0.5 font-mono text-xs font-semibold text-ink-2">{task.key}</span> : null}
            <button type="button" onClick={requestClose} aria-label="Close" title="Close (Esc)" className="ms-auto grid h-10 w-10 place-items-center rounded-lg text-ink-2 transition-colors hover:bg-ground hover:text-ink">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </div>

          <form onSubmit={(e) => void submit(e)} noValidate className="keyboard-flow-body flex min-h-0 flex-1 flex-col">
            <div className="keyboard-flow-body min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 sm:py-5">
              {banner ? <p role="alert" className="rounded-xl border border-danger/30 bg-danger-soft px-3.5 py-2.5 text-sm text-danger">{banner}</p> : null}
              {noProjects ? <p className="rounded-xl bg-ground px-3.5 py-3 text-sm text-ink-2">Create a project first, then you can add tasks to it.</p> : null}

              {!editing && !noProjects ? (
                <DescribeTask
                  onParse={(text) => aiApi(apiClient).parseTask(text, todayKey(timeZone))}
                  current={{ title: draft.title, description: draft.description, dueDate: draft.dueDate, priority: draft.priority, rule: draft.rule, projectId: draft.projectId }}
                  initial={{ title: saved.title, description: saved.description, dueDate: saved.dueDate, priority: saved.priority, rule: saved.rule, projectId: saved.projectId }}
                  projects={projectFixed ? undefined : openProjects}
                  projectChosen={placeChosen}
                  repeatText={scheduleText}
                  onApply={({ projectId, ...patch }) => {
                    if (projectId) chooseProject(projectId); // its columns and people follow, as when picked by hand
                    set(patch);
                    if (patch.title) setTitleError(null);
                  }}
                />
              ) : null}

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="min-w-0">
                  <Label>Project</Label>
                  {projectFixed ? (
                    <div className="flex min-h-[44px] items-center gap-2.5 rounded-xl border border-line bg-ground px-3.5 text-sm text-ink">
                      {project ? <ProjectAvatar project={project} size="sm" /> : null}
                      <span dir="auto" className="min-w-0 truncate">{project?.name ?? 'Loading…'}</span>
                    </div>
                  ) : (
                    <SearchableSelect size="lg" ariaLabel="Project" placeholder={projectsQ.isLoading ? 'Loading…' : 'Choose a project'} options={openProjects.map(projectOption)} value={draft.projectId} onChange={chooseProject} />
                  )}
                </div>
                <div className="min-w-0">
                  <Label>Column</Label>
                  <SearchableSelect
                    size="lg"
                    ariaLabel="Column"
                    value={draft.columnId}
                    onChange={(v) => { setPlaceChosen(true); set({ columnId: v }); }}
                    disabled={columns.length === 0}
                    placeholder={columnsQ.isLoading || !draft.projectId ? 'Loading…' : 'This project has no columns'}
                    options={columnOptions}
                  />
                </div>
              </div>
              {notice ? <p role="status" className="-mt-2 text-xs text-ink-2">{notice}</p> : null}

              <div>
                <Label htmlFor={ids.title} required>Task title</Label>
                <input
                  id={ids.title}
                  ref={titleRef}
                  dir="auto"
                  value={draft.title}
                  maxLength={TITLE_MAX}
                  aria-required="true"
                  aria-invalid={titleError ? true : undefined}
                  aria-describedby={titleError ? ids.titleErr : undefined}
                  onChange={(e) => { set({ title: e.target.value }); if (titleError) setTitleError(null); }}
                  placeholder="What needs to be done?"
                  className={`${fieldClass(!!titleError)} h-11`}
                />
                {titleError ? <p id={ids.titleErr} className="mt-1 text-xs font-medium text-danger">{titleError}</p> : null}
              </div>

              <div>
                <Label htmlFor={ids.desc} optional>Description</Label>
                <textarea
                  id={ids.desc}
                  dir="auto"
                  rows={5}
                  value={draft.description}
                  maxLength={DESCRIPTION_MAX}
                  onChange={(e) => set({ description: e.target.value })}
                  placeholder="Details, links, acceptance notes…"
                  className={`${fieldClass()} min-h-[8rem] resize-y py-2.5 leading-relaxed`}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div className="min-w-0">
                  <Label>Priority</Label>
                  <SearchableSelect size="lg" ariaLabel="Priority" options={priorityOptions()} value={draft.priority} onChange={(v) => set({ priority: v as Priority })} />
                </div>
                <div className="min-w-0">
                  <Label htmlFor={ids.due} optional>Due date</Label>
                  <input id={ids.due} type="date" value={draft.dueDate} onChange={(e) => set({ dueDate: e.target.value })} className={`${fieldClass()} h-11`} />
                </div>
                <div className="min-w-0">
                  <Label>Repeat</Label>
                  {canRepeat ? (
                    <SearchableSelect size="lg" ariaLabel="Repeat" options={repeatOptions} value={draft.rule?.freq ?? 'NONE'} onChange={(v) => set({ rule: withFrequency(draft.rule, v) })} />
                  ) : (
                    <p className="flex min-h-[44px] items-center rounded-xl bg-ground px-3.5 text-xs text-ink-2">
                      An earlier copy of a repeating series — change the repeat on its newest copy.
                    </p>
                  )}
                </div>
              </div>

              {draft.rule && canRepeat ? (
                <fieldset role="group" aria-label="Repeat schedule" className="rounded-2xl border border-line bg-ground/50 p-3.5 sm:p-4">
                  <p className="mb-3 flex items-start gap-2 text-sm font-semibold text-ink">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="mt-0.5 flex-none text-brand">
                      <path d="M17 2l4 4-4 4" /><path d="M3 11V9a3 3 0 0 1 3-3h15" /><path d="M7 22l-4-4 4-4" /><path d="M21 13v2a3 3 0 0 1-3 3H3" />
                    </svg>
                    <span>{scheduleText(draft.rule, draft.dueDate)}</span>
                  </p>
                  <div ref={untilRef}>
                    <RecurrenceEditor hideFrequency value={draft.rule} onChange={(rule) => set({ rule })} dueDate={draft.dueDate || null} />
                  </div>
                  {untilProblem ? <p id={ids.untilErr} role="alert" className="mt-2 text-xs font-medium text-danger">{untilProblem}</p> : null}
                  {!draft.dueDate ? <p className="mt-2 text-xs text-ink-2">Set a due date to see the next dates.</p> : null}
                </fieldset>
              ) : null}

              <div>
                <Label optional>Assignees</Label>
                <AssigneeSelect
                  people={people}
                  value={draft.assigneeIds}
                  onChange={(assigneeIds) => set({ assigneeIds })}
                  note={assigneeNote}
                  disabled={!draft.projectId}
                />
              </div>

              {!editing ? (
                <div>
                  <Label optional>Attachments</Label>
                  <FilesField files={files} onAdd={addFiles} onRemove={(key) => setFiles((f) => f.filter((p) => p.key !== key))} busy={saving || !!created} />
                </div>
              ) : null}

              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line px-3.5 py-3 transition-colors hover:border-brand/40">
                <input type="checkbox" checked={draft.milestone} onChange={(e) => set({ milestone: e.target.checked })} className="mt-0.5 h-4 w-4 accent-brand" />
                <span>
                  <span className="flex items-center gap-1.5 text-sm font-semibold text-ink"><span className="text-brand"><MilestoneIcon /></span>Milestone</span>
                  <span className="block text-xs text-ink-2">A key date or deliverable of the project — listed on its dashboard.</span>
                </span>
              </label>

              {editing && inSeries ? (
                <fieldset className="rounded-xl border border-line px-3.5 py-3">
                  <legend className="px-1 text-sm font-semibold text-ink">Apply changes to</legend>
                  <div className="flex flex-wrap gap-x-5 gap-y-2">
                    {(['one', 'series'] as const).map((s) => (
                      <label key={s} className="inline-flex min-h-[32px] cursor-pointer items-center gap-2 text-sm text-ink">
                        <input type="radio" name="task-form-scope" checked={scope === s} onChange={() => setScope(s)} className="h-4 w-4 accent-brand" />
                        {s === 'one' ? 'This task' : 'Entire series'}
                      </label>
                    ))}
                  </div>
                  <p className="mt-1 text-xs text-ink-2">The title, description, priority and due date go to every copy when you choose the series.</p>
                </fieldset>
              ) : null}
            </div>

            <div className="flex flex-none items-center gap-2 border-t border-line bg-surface px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:justify-end sm:px-6">
              {!created ? (
                <button type="button" title="Cancel (Esc)" aria-keyshortcuts="Escape" onClick={requestClose} disabled={saving} className="!min-h-[44px] flex-1 rounded-xl border border-line px-4 text-sm font-semibold text-ink transition-colors hover:bg-ground disabled:opacity-50 sm:flex-none">
                  Cancel
                </button>
              ) : null}
              <Button type="submit" shortcut={editing ? 'save' : 'submit'} showShortcut loading={saving} disabled={noProjects} className="!min-h-[44px] flex-[2] sm:flex-none sm:min-w-[9.5rem]">
                {created
                  ? 'Done'
                  : saving
                    ? editing
                      ? 'Saving…'
                      : files.some((p) => p.fraction !== undefined)
                        ? 'Attaching files…'
                        : 'Creating…'
                    : editing
                      ? 'Save changes'
                      : 'Create task'}
              </Button>
            </div>
          </form>
        </div>
      </div>
      {confirmClose ? (
        <ConfirmDialog
          title={editing ? 'Discard your changes?' : 'Discard this task?'}
          confirmLabel="Discard"
          keepLabel="Keep editing"
          onConfirm={() => { setConfirmClose(false); onClose(); }}
          onClose={() => setConfirmClose(false)}
        >
          {editing ? 'Your changes to this task haven’t been saved.' : 'What you entered hasn’t been saved.'}
        </ConfirmDialog>
      ) : null}
    </ModalPortal>
  );
}
