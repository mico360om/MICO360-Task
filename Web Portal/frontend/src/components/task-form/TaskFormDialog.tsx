import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useInRouterContext } from 'react-router-dom';
import { apiClient } from '../../api/client';
import { useProjectsWith } from '../../lib/useProjectsWith';
import { columnsApi } from '../../api/columns';
import { membersApi } from '../../api/members';
import { usersApi } from '../../api/users';
import { assigneesApi } from '../../api/assignees';
import { aiApi } from '../../api/ai';
import { tasksApi, type ApiTask, type DuplicateFiles, type DuplicateInput, type NewTaskInput, type Priority, type RecurrenceRule } from '../../api/tasks';
import { ApiError } from '../../lib/api-client';
import { todayKey } from '../../lib/due-date';
import { dueInputValue } from '../../lib/due-display';
import { defaultDueDay, defaultDueNote } from '../../lib/default-due';
import { formBoardDate, scheduledNote, waitingDay } from '../../lib/scheduled-start';
import { recurrenceSummary } from '../../lib/recurrence-summary';
import { useCompanyTimeZone } from '../../lib/company-clock';
import { dueDayWarning, useWorkingTime } from '../../lib/useWorkingTime';
import { notificationSettingsApi } from '../../api/notification-settings';
import { enqueueOffline } from '../../lib/offline-replay';
import { newIdempotencyKey } from '../../lib/offline-queue';
import { invalidateTaskQueries } from '../../lib/task-cache';
import { useDialog } from '../../hooks/useDialog';
import { ModalPortal } from '../ui/ModalPortal';
import { dialogLayer, dialogPanel, useTwoColumns } from '../ui/dialog-size';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { SearchableSelect } from '../ui/SearchableSelect';
import { ProjectAvatar } from '../ProjectAvatar';
import { projectOption } from '../project-option';
import { priorityOptions } from '../priority-option';
import { countsByWeight, projectWeights, weightChoices } from '../../lib/project-health';
import { RecurrenceEditor, REPEAT_FREQUENCIES, REPEAT_LABEL, withFrequency } from '../RecurrenceEditor';
import { AssigneeSelect, type PersonOption } from './AssigneeSelect';
import { DescribeTask } from './DescribeTask';
import { FilesField, type PendingFile } from './FilesField';
import { attachmentsApi } from '../../api/attachments';
import { pastedFiles } from '../../lib/clipboard-files';
import { isTypingTarget } from '../../lib/shortcuts';
import { MilestoneIcon } from '../TaskCard';
import { WaitingIcon } from '../approvals/ApprovalChip';
import { APPROVAL_HINT, APPROVAL_LOCKED } from '../../lib/approvals';
import { useAuthStore } from '../../stores/auth-store';
import { TASK_TEMPLATES_KEY, templatesApi, type TaskTemplate } from '../../api/templates';
import { hasChecklistData, templateTree } from '../../api/template-checklists';
import { inspectionsApi } from '../../api/inspections';
import { INSPECTION_LIMITS } from '../../lib/inspection-rules';
import { ChecklistDraftEditor } from '../checklists/ChecklistDraftEditor';
import { draftFromTree, draftToTree, emptyDraft, treeLeafCount, type ChecklistDraft } from '../../lib/checklist-tree';
import { AssignModeSwitch, GuestBadge, GuestPicker, guestChipText, pickedGuest, type AssignMode, type PickedGuest } from './guest-picker';
import { CategoryPicker } from './category-picker';
import { guestsApi } from '../../api/guests';
import { categoriesApi } from '../../api/categories';
import { GUEST_WORDS, guestLabel } from '../../lib/guest-contacts';
import { CATEGORY_WORDS } from '../../lib/task-categories';
import { isProjectArchived } from '../../lib/project-archive';
import { TaskKey } from '../TaskKey';
import { showTaskNotice, taskCreatedNotice } from '../../lib/task-notice';
import { alsoCopiedText, carriedStart, duplicatedNotice } from '../../lib/task-duplicate';
import { formatSize } from '../task-drawer/attachments';
import { statusColour } from '../../lib/colour-classes';

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
  /** Start in the first column of this kind (e.g. IN_PROGRESS), whichever project is chosen — the All projects board. */
  defaultColumnCategory?: string;
  /** Start with this due date ('YYYY-MM-DD'), e.g. the day chosen on the calendar. */
  defaultDueDate?: string;
  /** The board day the new task belongs to (per-date boards). */
  boardDate?: string;
  /** Offline: the new task was kept to send later, and the form closed. */
  onQueued?: () => void;
  /** Start filled in from this task template (the Templates page's "Use template"). */
  taskTemplateId?: string;
  /**
   * Duplicate Task: a copy of this task — the form opens filled in from it (GET /tasks/:id/duplicate), titled
   * "Duplicate of MSSP-34", to review before saving; saving makes the copy on the server (its files too, when
   * "Copy files" is ticked). It needs the connection.
   */
  duplicateOfId?: string;
}

interface Draft {
  projectId: string;
  columnId: string;
  title: string;
  description: string;
  priority: Priority;
  dueDate: string;
  /** Its start day ('' = none: the server starts it now). Later than today, a new task waits for it (future tasks). */
  startDate: string;
  rule: RecurrenceRule | null;
  assigneeIds: string[];
  milestone: boolean;
  /**
   * 1.23.3: a new task's checklists — several, nested (a task template fills them in); an existing
   * task's are edited in its panel. Text typed in an add box and not added yet is part of it: saved
   * with the rest, and a change.
   */
  checklists: ChecklistDraft;
  /** The inspection form the task is carried out with ('' = none), and where. */
  formId: string;
  place: string;
  /** Needs approval: a project manager must approve it before it counts as done. */
  approval: boolean;
  /** 1.24: guests from the project's company list (people outside the company, for the record), in order. */
  guests: PickedGuest[];
  /** 1.24: its categories from the project's list, in the project's order. */
  categoryIds: string[];
}

/** 1.24: the categories a project offers, cached for every place that shows them (the task panel too). */
export const categoriesKey = (projectId: string) => ['categories', projectId] as const;

export const TITLE_MAX = 191;
const DESCRIPTION_MAX = 20_000;
const LAST_PROJECT = 'mico360.newTask.project';

const sameRule = (a: RecurrenceRule | null, b: RecurrenceRule | null) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
/** A repeating task with an inspection form is a schedule: its checks are made on each date (the server does the same). */
const asCheck = (d: Draft): Draft => (d.formId && d.rule && d.rule.createNext !== 'ON_SCHEDULE' ? { ...d, rule: { ...d.rule, createNext: 'ON_SCHEDULE' } } : d);
const fullName = (u: { firstName?: string | null; lastName?: string | null; username: string }) => [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username;
const listNames = (names: string[]) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

/** Why a file couldn't be attached, in the task panel's words. */
function fileFailure(err: unknown): string {
  if (err instanceof ApiError && err.status === 413) return 'That file is too large to upload.';
  if (err instanceof TypeError) return 'The server couldn’t be reached.';
  if (err instanceof Error && err.message && !/^Request failed/.test(err.message)) return err.message;
  return 'It couldn’t be uploaded.';
}

/**
 * Why a save or create was refused, after "Couldn’t …": the server's own sentence (a 403's too —
 * "Only the project’s managers can turn off approval for this task."), plain words for a 403 that
 * has none, or "Please try again.".
 */
function reasonOf(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.message && !/^Request failed/.test(err.message)) return err.message;
    if (err.status === 403) return 'You don’t have permission to do that.';
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
export function TaskFormDialog({ onClose, task, onCreated, onSaved, projectId: fixedProjectId, defaultProjectId, defaultColumnId, defaultColumnCategory, defaultDueDate, boardDate, onQueued, taskTemplateId, duplicateOfId }: TaskFormDialogProps) {
  const editing = !!task;
  // Duplicate Task: the form for a copy of another task (a new task, filled in from it).
  const duplicating = !editing && !!duplicateOfId;
  const qc = useQueryClient();
  const timeZone = useCompanyTimeZone();
  const ids = { title: useId(), desc: useId(), due: useId(), dueNote: useId(), dueWarn: useId(), start: useId(), startNote: useId(), startErr: useId(), titleErr: useId(), untilErr: useId(), owner: useId(), place: useId(), formNote: useId(), approvalHint: useId(), approvalLocked: useId(), teamErr: useId(), catLabel: useId(), catErr: useId(), copyNote: useId() };

  // One empty checklist draft for how the form opened and the form itself (so an untouched form isn't "changed").
  const [blankChecklists] = useState(emptyDraft);
  const start = (): Draft =>
    task
      ? {
          projectId: task.projectId,
          columnId: task.columnId,
          title: task.title,
          description: task.description ?? '',
          priority: task.priority,
          dueDate: dueInputValue(task.dueDate, timeZone),
          startDate: dueInputValue(task.startDate, timeZone),
          rule: task.recurrenceRule ?? null,
          assigneeIds: [],
          milestone: !!task.isMilestone,
          checklists: blankChecklists,
          formId: task.inspectionFormId ?? '',
          place: task.inspectionPlace ?? '',
          approval: !!task.needsApproval,
          guests: task.taskGuests ? task.taskGuests.map((g) => pickedGuest({ ...g, id: g.guestId })) : (task.guests ?? []).map(pickedGuest),
          categoryIds: (task.categories ?? []).map((c) => c.id),
        }
      : { projectId: fixedProjectId ?? '', columnId: defaultColumnId ?? '', title: '', description: '', priority: 'NORMAL', dueDate: defaultDueDate ?? '', startDate: '', rule: null, assigneeIds: [], milestone: false, checklists: blankChecklists, formId: '', place: '', approval: false, guests: [], categoryIds: [] };
  // `saved` is what the server has (or, for a new task, how the form opened); `draft` is the form.
  const [saved, setSaved] = useState<Draft>(start);
  const [draft, setDraft] = useState<Draft>(start);
  const set = (patch: Partial<Draft>) => setDraft((d) => asCheck({ ...d, ...patch }));
  /** A value the form fills in itself (a default, data that loaded) — not a change of yours. */
  const settle = (patch: Partial<Draft>) => {
    setSaved((s) => asCheck({ ...s, ...patch }));
    set(patch);
  };
  const [placeChosen, setPlaceChosen] = useState(false);
  // 1.23.5: its weight (shown for projects counting by weight) — '' = the project's default for its priority.
  const [weight, setWeight] = useState(() => (task?.weight != null ? String(task.weight) : ''));
  const [savedWeight, setSavedWeight] = useState(weight);
  const [scope, setScope] = useState<'one' | 'series'>('one');
  const [titleError, setTitleError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  // 1.24: the Assign box picks team members ("Internal user") or guests; why a save was stopped there
  // (guests and no team member) or at Categories (the project needs one); what a project change took off.
  const [assignMode, setAssignMode] = useState<AssignMode>('internal');
  const [teamError, setTeamError] = useState(false);
  const [categoryError, setCategoryError] = useState(false);
  const [notes, setNotes] = useState<{ members?: string; guests?: string; categories?: string }>({});
  const assignRef = useRef<HTMLDivElement>(null);
  const categoriesRef = useRef<HTMLDivElement>(null);
  const myId = useAuthStore((s) => s.user?.id);
  // Files for a new task (chosen, dropped or pasted); they go up once the task exists.
  const [files, setFiles] = useState<PendingFile[]>([]);
  const fileSeq = useRef(0);
  // Set when the task was created but a file couldn't be attached: "Done" then closes.
  const [created, setCreated] = useState<ApiTask | null>(null);
  const busy = useRef(false);
  const version = useRef(task?.version);
  const titleRef = useRef<HTMLInputElement>(null);
  const untilRef = useRef<HTMLDivElement>(null);

  // Notification & Scheduling: the task's own reminder schedule (edits only; a new task uses its project's).
  const scheduleQ = useQuery({
    queryKey: ['task-reminder-schedule', task?.id ?? ''],
    queryFn: () => notificationSettingsApi(apiClient).taskSchedule(task!.id),
    enabled: !!task?.id,
    staleTime: 30_000,
  });
  const schedule = scheduleQ.data && Array.isArray(scheduleQ.data.schedules) ? scheduleQ.data : null;
  const [reminderPick, setReminderPick] = useState<string | null>(null);
  const savedReminder = schedule?.scheduleId ?? '';
  const reminderChanged = reminderPick !== null && reminderPick !== savedReminder;

  /** A new guest being typed in the Assign box (not on the task until it is added). */
  const guestTyping = () => Boolean(dialogRef.current?.querySelector('[data-guest-form][data-unsaved]'));
  const dirty =
    reminderChanged ||
    placeChosen ||
    files.length > 0 ||
    JSON.stringify({ ...draft, projectId: '', columnId: '' }) !== JSON.stringify({ ...saved, projectId: '', columnId: '' }) ||
    draft.columnId !== saved.columnId ||
    weight !== savedWeight;
  // Duplicate Task: how the copy's files went (said in the notice once the form closes).
  const copiedFiles = useRef<DuplicateFiles | null>(null);
  const finish = (task: ApiTask) => {
    // 1.22.3: "Task MICO-143 created", with Open — the app shell shows it, wherever the form was opened.
    showTaskNotice(duplicating ? duplicatedNotice(task, copiedFiles.current) : taskCreatedNotice(task));
    onCreated?.(task);
    onClose();
  };
  const requestClose = () => {
    if (busy.current) return;
    if (created) finish(created);
    else if (dirty || guestTyping()) setConfirmClose(true);
    else onClose();
  };
  const addFiles = (more: File[]) => {
    if (more.length) setFiles((f) => [...f, ...more.map((file) => ({ key: `f${++fileSeq.current}`, file }))]);
  };
  const patchFile = (key: string, patch: Partial<PendingFile>) => setFiles((f) => f.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  const dialogRef = useDialog(requestClose);

  // ── Start from a task template (new tasks): it fills in the title, description, priority and checklist ──
  const templatesQ = useQuery({ queryKey: TASK_TEMPLATES_KEY, queryFn: () => templatesApi(apiClient).listTasks(), enabled: !editing && !duplicating, staleTime: 30_000 });
  // Only well-formed templates (a server without templates answers something else, or nothing).
  const taskTemplates = useMemo(
    () => (Array.isArray(templatesQ.data) ? templatesQ.data.filter((t) => t && typeof t.name === 'string' && typeof t.title === 'string' && hasChecklistData(t)) : []),
    [templatesQ.data],
  );
  const [usedTemplate, setUsedTemplate] = useState<TaskTemplate | null>(null);
  const filledFrom = (t: TaskTemplate): Partial<Draft> => ({ title: t.title, description: t.description ?? '', priority: t.priority, checklists: draftFromTree(templateTree(t)) });
  function applyTemplate(id: string) {
    const t = taskTemplates.find((x) => x.id === id);
    if (!t) return;
    set(filledFrom(t));
    setUsedTemplate(t);
    setTitleError(null);
  }
  // Opened for one template: filled in from it once it has loaded (as how the form opened, not a change).
  const askedTemplate = useRef(taskTemplateId ?? null);
  useEffect(() => {
    if (!askedTemplate.current) return;
    const t = taskTemplates.find((x) => x.id === askedTemplate.current);
    if (!t) return;
    askedTemplate.current = null;
    settle(filledFrom(t));
    setUsedTemplate(t);
  }, [taskTemplates]);

  // ── Duplicate Task: the original, as the form starts from it ──
  const prefillQ = useQuery({ queryKey: ['task-duplicate', duplicateOfId], queryFn: () => tasksApi(apiClient).duplicatePrefill(duplicateOfId!), enabled: duplicating, staleTime: 0, gcTime: 0 });
  // (Only a well-formed answer: anything else is said to be a problem below.)
  const prefillOk = Boolean(prefillQ.data && typeof prefillQ.data === 'object' && prefillQ.data.task && prefillQ.data.original);
  const prefill = duplicating && prefillOk ? prefillQ.data : undefined;
  const [copyFiles, setCopyFiles] = useState(true);
  const [prefillApplied, setPrefillApplied] = useState(false);

  // ── Where the task goes ──
  // (1.22: with the page's or the task's own project when an administrator's "Show my projects only"
  // leaves it off the list — a board or task opened by its link.)
  const { projects: allProjects, listQ: projectsQ, fetchingExtra } = useProjectsWith(task?.projectId ?? fixedProjectId ?? defaultProjectId ?? prefill?.task.projectId);
  // Archived — or all its companies archived: no new tasks there.
  const openProjects = useMemo(() => allProjects.filter((p) => !isProjectArchived(p)), [allProjects]);
  const project = allProjects.find((p) => p.id === draft.projectId) ?? null;
  const projectFixed = editing || !!fixedProjectId;
  // "New tasks in this project need approval" ticks a new task's box (until you choose yourself).
  const approvalChosen = useRef(false);
  const projectWantsApproval = !!project?.newTasksNeedApproval;
  // Turning "Needs approval" off is for the people who run the project and admins only (owner, 30 Oct;
  // the server refuses anyone else): for everyone else the tick stays on once it is on — a saved task's
  // tick, or the one the project gives its new tasks. Ticking it on is anyone's.
  const isAdmin = useAuthStore((s) => s.isAdmin());
  const canManageProject = isAdmin || project?.canManage === true || (editing && task?.approval?.canApprove === true);
  const approvalLocked = !canManageProject && (editing ? !!task?.needsApproval : projectWantsApproval);
  useEffect(() => {
    if (editing || !project) return;
    // Your own choice stands — unless the project's tick is locked on for you.
    if (approvalChosen.current && !approvalLocked) return;
    settle({ approval: projectWantsApproval });
  }, [editing, project?.id, projectWantsApproval, approvalLocked]);
  const noProjects = !projectFixed && projectsQ.isSuccess && openProjects.length === 0;

  useEffect(() => {
    // (Wait for the page's own project when it is being fetched — else another one would be chosen.)
    if (projectFixed || draft.projectId || openProjects.length === 0 || fetchingExtra) return;
    // A copy starts in its original's project (below); only when that one is closed is another chosen here.
    if (duplicating && !prefillApplied) return;
    let last: string | null = null;
    try { last = localStorage.getItem(LAST_PROJECT); } catch { /* storage unavailable */ }
    // The page's own project first, then the one used last time, then the first open project.
    const start = [defaultProjectId, last].find((id) => id && openProjects.some((p) => p.id === id)) ?? openProjects[0]!.id;
    // A copy's people came from its original's project: whoever isn't on this one is taken off (with the notice).
    if (duplicating) pruneFor.current = start;
    settle({ projectId: start });
  }, [projectFixed, draft.projectId, openProjects, defaultProjectId, fetchingExtra, duplicating, prefillApplied]);

  // A copy: filled in from its original once both it and the projects are here (as how the form opened —
  // not a change of yours). Its project, unless that one is archived now: then another (above).
  useEffect(() => {
    // (Projects that couldn't be read: filled in all the same — the form then asks for a project.)
    if (!prefill || prefillApplied || !(projectsQ.isSuccess || projectsQ.isError) || fetchingExtra) return;
    const t = prefill.task;
    const open = openProjects.some((p) => p.id === t.projectId);
    settle({
      projectId: open ? t.projectId : '',
      columnId: open ? (t.columnId ?? '') : '',
      title: t.title,
      description: t.description ?? '',
      priority: t.priority,
      dueDate: t.dueDate ?? '',
      // Its start date in the form's Start date field (when it still fits the due date): the field and its
      // "Scheduled for …" note show it, and it can be changed or cleared like any new task's.
      startDate: carriedStart(t.startDate, t.dueDate) ?? '',
      rule: null,
      assigneeIds: t.assigneeIds,
      milestone: t.isMilestone,
      checklists: draftFromTree(t.checklists),
      formId: t.inspectionFormId ?? '',
      place: t.inspectionPlace ?? '',
      // 1.24: its guests and categories (a project change re-checks both, as for any new task).
      guests: (t.guests ?? []).map(pickedGuest),
      categoryIds: t.categoryIds ?? [],
    });
    const w = t.weight != null ? String(t.weight) : '';
    setWeight(w);
    setSavedWeight(w);
    setPrefillApplied(true);
  }, [prefill, prefillApplied, projectsQ.isSuccess, projectsQ.isError, fetchingExtra, openProjects]);

  const columnsQ = useQuery({ queryKey: ['columns', draft.projectId], queryFn: () => columnsApi(apiClient).list(draft.projectId), enabled: !!draft.projectId });
  const columns = useMemo(
    () => (Array.isArray(columnsQ.data) ? columnsQ.data : []).filter((c) => c.enabled !== false || c.id === task?.columnId).sort((a, b) => a.position - b.position),
    [columnsQ.data, task?.columnId],
  );
  // After a project change, land in the same kind of column (e.g. "in progress") when the new project has one.
  const preferKind = useRef<string | null>(defaultColumnCategory ?? (duplicateOfId ? 'TODO' : null));
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
    setNotes((n) => ({ ...n, members: `${listNames(names)} ${names.length === 1 ? 'isn’t' : 'aren’t'} on ${project?.name ?? 'that project'}, so ${names.length === 1 ? 'they were' : 'they were'} taken off this task.` }));
  }, [membersQ.isSuccess, membersQ.isFetching, people, draft.projectId]);

  // ── 1.24 Guests: from the project's main company's list ──
  // An existing task's come with it (an older server sends none, and has no guests to pick from).
  const guestsKnown = !editing || task?.taskGuests !== undefined || task?.guests !== undefined;
  const teamProblem = draft.guests.length > 0 && draft.assigneeIds.length === 0 && (!editing || assigneesQ.isSuccess);
  function addGuest(g: PickedGuest) {
    // The person adding a guest looks after them when nobody from the team is picked yet (changeable).
    const me = myId && people.some((p) => p.id === myId) ? myId : null;
    setDraft((d) => (d.guests.some((x) => x.id === g.id) ? d : asCheck({ ...d, guests: [...d.guests, g], ...(d.assigneeIds.length === 0 && me ? { assigneeIds: [me] } : {}) })));
  }
  const removeGuest = (id: string) => set({ guests: draft.guests.filter((g) => g.id !== id) });
  /** After a project change: keep only the guests the new project's company list has (another company's list is another list). */
  async function recheckGuests(projectId: string, picked: PickedGuest[], projectName: string) {
    const api = guestsApi(apiClient);
    const onList = await Promise.all(picked.map((g) => api.forProject(projectId, g.name).then((list) => Array.isArray(list) && list.some((x) => x.id === g.id), () => false)));
    const gone = picked.filter((_, i) => !onList[i]);
    if (gone.length === 0) return;
    setDraft((d) => (d.projectId !== projectId ? d : asCheck({ ...d, guests: d.guests.filter((g) => !gone.some((x) => x.id === g.id)) })));
    setNotes((n) => ({ ...n, guests: `${listNames(gone.map(guestLabel))} ${gone.length === 1 ? 'isn’t' : 'aren’t'} on ${projectName}’s guest list, so ${gone.length === 1 ? 'they were' : 'they were'} taken off this task.` }));
  }

  // ── 1.24 Categories: the project's own list ──
  const categoriesQ = useQuery({ queryKey: categoriesKey(draft.projectId), queryFn: () => categoriesApi(apiClient).forProject(draft.projectId), enabled: !!draft.projectId, staleTime: 30_000 });
  const projectCats = categoriesQ.data && Array.isArray(categoriesQ.data.categories) ? categoriesQ.data : null;
  const catChoices = projectCats?.categories ?? [];
  const catsRequired = projectCats?.requireCategory === true;
  // An existing task's come with it (an older server sends none). Shown when the project has any or needs one.
  const categoriesKnown = !editing || task?.categories !== undefined;
  const catsShown = categoriesKnown && !!projectCats && (catChoices.length > 0 || catsRequired || draft.categoryIds.length > 0);
  const categoryProblem = catsShown && catsRequired && draft.categoryIds.length === 0;
  /** The categories the last Save read (when it had to read them itself). */
  const catsAtSave = useRef<typeof projectCats>(null);
  const keptCategories = useMemo(() => (task?.categories ?? []).filter((c) => c.retired).map((c) => c.id), [task?.categories]);
  // A problem put right is forgotten (it is said again only at the next save).
  useEffect(() => {
    if (!teamProblem) setTeamError(false);
  }, [teamProblem]);
  useEffect(() => {
    if (!categoryProblem) setCategoryError(false);
  }, [categoryProblem]);

  function chooseProject(id: string) {
    if (id === draft.projectId) return;
    preferKind.current = columns.find((c) => c.id === draft.columnId)?.category ?? null;
    pruneFor.current = id;
    setNotes(draft.categoryIds.length > 0 ? { categories: 'Categories are each project’s own, so the ones picked were cleared.' } : {});
    setPlaceChosen(true);
    // Categories are each project's own: the ones picked go.
    set({ projectId: id, columnId: '', categoryIds: [] });
    const next = allProjects.find((p) => p.id === id);
    const sameCompany = !!project?.mainCompanyId && project.mainCompanyId === next?.mainCompanyId;
    if (draft.guests.length > 0 && !sameCompany) void recheckGuests(id, draft.guests, next?.name ?? 'that project');
  }

  const ownerName = project?.ownerId ? known.current.get(project.ownerId) ?? null : null;
  const assigneeNote = draft.assigneeIds.length
    ? null
    : editing
      ? 'Nobody is assigned.'
      : ownerName
        ? `Nobody picked — the task will go to ${ownerName}, the project owner.`
        : 'Nobody picked — the task will be unassigned.';

  // ── When ──
  // A new task left without a date gets one from its project (the server does it): the board day it
  // is added to when that is later, else today. An edit never does — a date cleared on purpose stays
  // cleared. `dueWhen` is the date the task will have, which the repeat preview works from.
  const today = todayKey(timeZone);
  // Tasks scheduled for the future: a Start date later than today puts a new task on its start day's
  // board (the server does it) — so the board's own day is sent only without one (lib/scheduled-start),
  // and the project's "due today" gives the start day, as the server will.
  const sentBoard = editing ? undefined : formBoardDate(boardDate, draft.startDate, today);
  const landsOn = sentBoard ?? (draft.startDate > today ? draft.startDate : undefined);
  const autoDue = editing ? null : defaultDueDay(project, draft.dueDate, landsOn, today);
  const dueWhen = draft.dueDate || autoDue || '';
  // Notification & Scheduling: a due date on a holiday or weekend of the project's company is said (never moved).
  const workingTime = useWorkingTime({ projectId: draft.projectId || null, enabled: !!draft.projectId });
  const dueWarning = dueDayWarning(dueWhen, workingTime.calendar);
  // A copy: its files, and what is copied without a field here (its start date is in the Start date field).
  const originalFiles = prefill?.files ?? [];
  const alsoCopied = prefill ? alsoCopiedText({ tags: prefill.task.tags, watchers: prefill.watchers.length, estimatedHours: prefill.task.estimatedHours }, today) : null;
  // The server's rule, said before anything is sent (an edit: only once a date changes, as the server).
  const datesChanged = !editing || draft.startDate !== saved.startDate || draft.dueDate !== saved.dueDate;
  const startProblem = datesChanged && draft.startDate && draft.dueDate && draft.startDate > draft.dueDate ? 'The start date must be on or before the due date.' : null;
  // "Scheduled for 20 Nov" under the Start date while it waits — never for a task already under way (it stays).
  const startNote = (() => {
    if (startProblem) return null;
    if (!editing) return scheduledNote(draft.startDate, today);
    if (draft.startDate === saved.startDate) {
      const waits = task ? waitingDay(task, timeZone) : null;
      return waits ? scheduledNote(waits, today) : null;
    }
    const kind = columns.find((c) => c.id === draft.columnId)?.category ?? task?.columnCategory ?? 'TODO';
    const notStarted = (kind === 'BACKLOG' || kind === 'TODO') && !task?.completedAt && !task?.approvalRequestedAt;
    if (!notStarted) return draft.startDate > today ? 'It’s already under way, so it stays where it is.' : null;
    return scheduledNote(draft.startDate, today);
  })();

  // ── An inspection form (a check): finishing its inspection completes the task ──
  const formsQ = useQuery({ queryKey: ['inspection-forms'], queryFn: () => inspectionsApi(apiClient).listForms(), staleTime: 30_000 });
  const formOptions = useMemo(() => {
    const live = Array.isArray(formsQ.data?.forms) ? formsQ.data!.forms : [];
    const opts = [{ value: '', label: 'No form' }, ...live.map((f) => ({ value: f.id, label: f.title, hint: `${f.itemCount} ${f.itemCount === 1 ? 'item' : 'items'}` }))];
    // A task whose form was deleted since keeps it (the check can still be done): shown, marked.
    const carried = task?.inspectionForm;
    if (carried && !live.some((f) => f.id === carried.id)) opts.push({ value: carried.id, label: carried.deleted ? `${carried.title} (deleted)` : carried.title, hint: '' });
    return opts;
  }, [formsQ.data, task?.inspectionForm]);
  const chosenForm = formOptions.find((o) => o.value === draft.formId && o.value);

  // ── Repeat ──
  const inSeries = !!(task?.recurrenceRule || task?.recurrenceParentId);
  const canRepeat = !task?.recurrenceNextId;
  const untilProblem = draft.rule?.until && dueWhen && draft.rule.until.slice(0, 10) < dueWhen ? 'The repeat can’t end before the due date.' : null;

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
    if (startProblem) {
      document.getElementById(ids.start)?.focus();
      return;
    }
    if (guestTyping()) {
      setBanner('Add the guest you’re typing in, or cancel it, first.');
      return;
    }
    // 1.24: a task with guests needs a person from the team (the server says so too).
    if (teamProblem) {
      setTeamError(true);
      setAssignMode('internal');
      setTimeout(() => assignRef.current?.querySelector<HTMLElement>('input[role="combobox"]')?.focus(), 0);
      return;
    }
    // 1.24: the project's categories not read yet (a quick Save): read them now, so its rule is kept.
    let cats = projectCats;
    if (draft.projectId && !cats && categoriesKnown) {
      cats = await qc
        .fetchQuery({ queryKey: categoriesKey(draft.projectId), queryFn: () => categoriesApi(apiClient).forProject(draft.projectId) })
        .then((d) => (d && Array.isArray(d.categories) ? d : null))
        .catch(() => null);
    }
    catsAtSave.current = cats;
    // 1.24: a project that asks every task for a category.
    if (categoryProblem || (cats && !projectCats && cats.requireCategory && cats.categories.some((c) => !c.retired) && draft.categoryIds.length === 0)) {
      setCategoryError(true);
      categoriesRef.current?.querySelector<HTMLElement>('button')?.focus();
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
    if (duplicating) {
      await duplicate();
      return;
    }
    // With anything typed in an add box and not added yet, where it was typed.
    const checklists = draftToTree(draft.checklists);
    const input: NewTaskInput & { recurrenceRule?: RecurrenceRule } = {
      projectId: draft.projectId,
      columnId: draft.columnId,
      title: draft.title.trim(),
      priority: draft.priority,
      // 1.23.5: only for a project counting by weight; none = its default for the priority.
      ...(countsByWeight(project) && weight ? { weight: Number(weight) } : {}),
      ...(draft.description.trim() ? { description: draft.description.trim() } : {}),
      ...(draft.dueDate ? { dueDate: draft.dueDate } : {}),
      ...(draft.startDate ? { startDate: draft.startDate } : {}),
      ...(draft.rule ? { recurrenceRule: draft.rule } : {}),
      ...(draft.milestone ? { isMilestone: true } : {}),
      // Ticked: needs approval. Unticked where the project ticks new tasks: says it doesn't.
      ...(draft.approval ? { needsApproval: true } : projectWantsApproval ? { needsApproval: false } : {}),
      // 1.23.3: the checklists, with their titles and nesting.
      ...(checklists.length ? { checklists } : {}),
      // Only when someone was picked — otherwise the project's default (its owner) applies.
      ...(draft.assigneeIds.length ? { assigneeIds: draft.assigneeIds } : {}),
      // 1.24: guests from the company's list (a team member is picked too — checked above).
      ...(draft.guests.length ? { guests: draft.guests.map((g) => ({ guestId: g.id })) } : {}),
      // 1.24: sent whenever the project has categories or needs one (sent, they are checked).
      ...((): { categoryIds?: string[] } => {
        const cats = catsAtSave.current ?? projectCats;
        return cats && (cats.categories.length > 0 || cats.requireCategory) ? { categoryIds: draft.categoryIds } : {};
      })(),
      ...(sentBoard ? { boardDate: sentBoard } : {}),
      ...(draft.formId ? { inspectionFormId: draft.formId, inspectionPlace: draft.place.trim() || null } : {}),
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

  /**
   * Duplicate Task: the copy, made on the server from the form as reviewed — the New task form's fields, the
   * original's start date when it still fits, the files tick (what the form has no field for — tags, the
   * estimate, watchers — the server takes from the original). Never queued offline: its files are copied there.
   */
  async function duplicate() {
    const checklists = draftToTree(draft.checklists);
    const input: DuplicateInput = {
      projectId: draft.projectId,
      columnId: draft.columnId,
      title: draft.title.trim(),
      priority: draft.priority,
      // Its weight as shown (none = the project's default for its priority), whatever the project counts by.
      weight: weight ? Number(weight) : null,
      ...(draft.description.trim() ? { description: draft.description.trim() } : {}),
      ...(draft.dueDate ? { dueDate: draft.dueDate } : {}),
      // The Start date field (filled in with the original's when it fit its due date); empty = none of its own (the automatic one).
      startDate: draft.startDate || null,
      ...(draft.rule ? { recurrenceRule: draft.rule } : {}),
      isMilestone: draft.milestone,
      ...(draft.approval ? { needsApproval: true } : projectWantsApproval ? { needsApproval: false } : {}),
      ...(checklists.length ? { checklists } : {}),
      // Only when someone is picked — otherwise the project's default (its owner), as for any new task.
      ...(draft.assigneeIds.length ? { assigneeIds: draft.assigneeIds } : {}),
      // 1.24: its guests (the server keeps each one's note from the original) and categories, as for any new task.
      ...(draft.guests.length ? { guests: draft.guests.map((g) => ({ guestId: g.id })) } : {}),
      ...((): { categoryIds?: string[] } => {
        const cats = catsAtSave.current ?? projectCats;
        return cats && (cats.categories.length > 0 || cats.requireCategory) ? { categoryIds: draft.categoryIds } : {};
      })(),
      ...(draft.formId ? { inspectionFormId: draft.formId, inspectionPlace: draft.place.trim() || null } : {}),
      copyFiles: originalFiles.length > 0 && copyFiles,
    };
    try {
      const made = await tasksApi(apiClient).duplicate(duplicateOfId!, input, { idempotencyKey: newIdempotencyKey() });
      copiedFiles.current = made.files;
      void invalidateTaskQueries(qc);
      if (files.length) {
        const failed = await attachFiles(made.task);
        void invalidateTaskQueries(qc);
        void qc.invalidateQueries({ queryKey: ['attachments', made.task.id] });
        if (failed.length) {
          setCreated(made.task);
          setBanner(
            failed.length === 1
              ? `The copy was created, but ${failed[0]!.name} wasn’t attached: ${failed[0]!.reason}`
              : `The copy was created, but these files weren’t attached: ${failed.map((f) => `${f.name} (${f.reason})`).join('; ')}. Add them from the task.`,
          );
          return;
        }
      }
      finish(made.task);
    } catch (err) {
      if (!(err instanceof ApiError)) {
        setBanner('You’re offline. Duplicating a task needs the connection — its files are copied on the server. Try again when you’re connected.');
        return;
      }
      setBanner(`Couldn’t duplicate the task. ${reasonOf(err)}`);
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
      if (draft.startDate !== done.startDate) fields.startDate = draft.startDate || null;
      if (draft.milestone !== done.milestone) fields.isMilestone = draft.milestone;
      if (weight !== savedWeight) fields.weight = weight ? Number(weight) : null;
      if (draft.approval !== done.approval) fields.needsApproval = draft.approval;
      // The tick and a new status in one request, so the server judges them together (an approver
      // unticking a waiting task and moving it elsewhere moves it — it isn't completed first).
      const moveWithTick = draft.approval !== done.approval && draft.columnId !== done.columnId;
      if (moveWithTick) fields.columnId = draft.columnId;
      if (draft.formId !== done.formId) fields.inspectionFormId = draft.formId || null;
      // Without a form there is no place; with one, the place as typed (blank: none).
      const placeNow = draft.formId ? draft.place.trim() || null : null;
      if (placeNow !== (done.place.trim() || null)) fields.inspectionPlace = placeNow;
      const ruleChanged = canRepeat && !sameRule(draft.rule, done.rule);
      if (ruleChanged && !series) fields.recurrenceRule = draft.rule;
      if (Object.keys(fields).length) {
        latest = await tasksApi(apiClient).update(t.id, { ...fields, ...(version.current != null ? { expectedVersion: version.current } : {}), ...(series ? { scope: 'series' } : {}) });
        version.current = latest.version ?? version.current;
        keep({ title: draft.title, description: draft.description, priority: draft.priority, dueDate: draft.dueDate, startDate: draft.startDate, milestone: draft.milestone, approval: draft.approval, formId: draft.formId, place: draft.formId ? draft.place : '', ...(moveWithTick ? { columnId: draft.columnId } : {}), ...(ruleChanged && !series ? { rule: draft.rule } : {}) });
        if (fields.weight !== undefined) setSavedWeight(weight);
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
      // 1.24: its categories, only when the set changed (the server checks the project's rule).
      if (categoriesKnown && JSON.stringify(draft.categoryIds) !== JSON.stringify(done.categoryIds)) {
        await categoriesApi(apiClient).setForTask(t.id, draft.categoryIds);
        keep({ categoryIds: draft.categoryIds });
      }
      // People: team members added first, then guests added and removed, team members removed last —
      // so a task with guests always keeps someone from the team (the server refuses otherwise). Each
      // change is kept as it goes through, so a retry sends only the rest.
      const add = draft.assigneeIds.filter((id) => !done.assigneeIds.includes(id));
      if (add.length) {
        await assigneesApi(apiClient).assignMany(t.id, add);
        keep({ assigneeIds: [...done.assigneeIds, ...add] });
      }
      const guests = guestsApi(apiClient);
      for (const g of draft.guests.filter((x) => !done.guests.some((d) => d.id === x.id))) {
        // Put on it by someone else meanwhile: it is on the task either way.
        await guests.addToTask(t.id, g.id).catch((err) => {
          if (!(err instanceof ApiError && err.status === 409 && err.code === 'GUEST_ON_TASK')) throw err;
        });
        keep({ guests: [...done.guests, g] });
      }
      for (const g of done.guests.filter((x) => !draft.guests.some((d) => d.id === x.id))) {
        // Taken off by someone else already: it is gone either way.
        await guests.removeFromTask(t.id, g.id).catch((err) => {
          if (!(err instanceof ApiError && err.status === 404)) throw err;
        });
        keep({ guests: done.guests.filter((x) => x.id !== g.id) });
      }
      for (const id of done.assigneeIds.filter((x) => !draft.assigneeIds.includes(x))) {
        await assigneesApi(apiClient).unassign(t.id, id);
        keep({ assigneeIds: done.assigneeIds.filter((x) => x !== id) });
      }
      // Notification & Scheduling: its own reminder schedule ('' = its project's).
      if (reminderChanged) {
        await notificationSettingsApi(apiClient).saveTaskSchedule(t.id, reminderPick || null);
        void qc.invalidateQueries({ queryKey: ['task-reminder-schedule', t.id] });
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

  // 1.23.8 one colour scheme: a column's colour is its status kind's.
  const columnOptions = columns.map((c) => ({ value: c.id, label: c.name, icon: <span className="h-2.5 w-2.5 rounded-full" style={{ background: statusColour(c.category) }} /> }));
  const repeatOptions = [{ value: 'NONE', label: 'Does not repeat' }, ...REPEAT_FREQUENCIES.map((f) => ({ value: f, label: REPEAT_LABEL[f] }))];
  const heading = editing ? 'Edit task' : duplicating ? `Duplicate of ${prefill?.original.key ?? '…'}` : 'New task';
  // A copy waits for its original (or says why it can't be copied).
  const prefillProblem =
    duplicating && prefillQ.isSuccess && !prefillOk
      ? 'Couldn’t open the task to duplicate. Please try again.'
      : duplicating && prefillQ.isError
      ? `Couldn’t open the task to duplicate. ${prefillQ.error instanceof ApiError && (prefillQ.error.status === 404 || prefillQ.error.status === 403) ? 'It may have been deleted, or you can’t open it any more.' : reasonOf(prefillQ.error)}`
      : null;
  const prefillWaiting = duplicating && !prefillApplied;

  // Big form (1.22): 960px and two columns from 1024px — what the task is on the left (template,
  // Describe, project and column, title, description, checklist, files); when, who and how on the
  // right (dates and repeat, assignees and guests, categories, inspection form, milestone, approval).
  // One column below, in the order it always had.
  const twoColumns = useTwoColumns();
  const templateField = !editing && !duplicating && !noProjects && taskTemplates.length ? (
    <div>
      <Label>Start from a template</Label>
      <SearchableSelect
        size="lg"
        ariaLabel="Task template"
        placeholder="Choose a task template"
        options={taskTemplates.map((t) => {
          const n = treeLeafCount(templateTree(t));
          return { value: t.id, label: t.name, hint: n ? `${n} checklist item${n === 1 ? '' : 's'}` : undefined };
        })}
        value={usedTemplate?.id ?? ''}
        onChange={applyTemplate}
      />
      {usedTemplate ? <p role="status" className="mt-1 text-xs text-ink-2">Filled in from “{usedTemplate.name}” — change anything before saving.</p> : null}
    </div>
  ) : null;
  const describeField = !editing && !duplicating && !noProjects ? (
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
  ) : null;
  const placeFields = (
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
          placeholder={!draft.projectId ? (projectsQ.isLoading ? 'Loading…' : 'Choose a project first') : columnsQ.isLoading ? 'Loading…' : 'This project has no columns'}
          options={columnOptions}
        />
      </div>
    </div>
  );
  // What a project change took off (people, guests) or cleared (categories).
  const noticeText = [notes.members, notes.guests, notes.categories].filter(Boolean);
  const noticeLine = noticeText.length ? (
    <div role="status" className="-mt-2 space-y-0.5 text-xs text-ink-2">
      {noticeText.map((t) => (
        <p key={t}>{t}</p>
      ))}
    </div>
  ) : null;
  // A copy: what goes with it that the form has no field for.
  const alsoCopiedLine = alsoCopied ? (
    <p className="flex items-start gap-2 rounded-xl bg-ground px-3.5 py-2.5 text-xs text-ink-2">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="mt-px flex-none text-brand">
        <rect x="8" y="8" width="13" height="13" rx="2" />
        <path d="M4 16V5a1 1 0 0 1 1-1h11" />
      </svg>
      <span dir="auto">{alsoCopied}</span>
    </p>
  ) : null;
  // A copy: "Copy files (3)", on by default — its files are copied on the server as new files of the copy.
  const copyFilesField =
    duplicating && originalFiles.length ? (
      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line px-3.5 py-3 transition-colors hover:border-brand/40">
        <input type="checkbox" checked={copyFiles} onChange={(e) => setCopyFiles(e.target.checked)} disabled={saving || !!created} aria-describedby={ids.copyNote} className="mt-0.5 h-4 w-4 accent-brand" />
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-ink">Copy files ({originalFiles.length})</span>
          <span id={ids.copyNote} dir="auto" className="block break-words text-xs text-ink-2">
            {fileNames(originalFiles)} · {formatSize(originalFiles.reduce((n, f) => n + f.sizeBytes, 0))}
          </span>
        </span>
      </label>
    ) : null;
  const titleField = (
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
  );
  const descriptionField = (
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
  );
  const checklistField = !editing ? (
    <div>
      <Label optional>Checklists</Label>
      <ChecklistDraftEditor draft={draft.checklists} onChange={(checklists) => set({ checklists })} disabled={saving || !!created} />
    </div>
  ) : null;
  const formFields = (
    <div className={twoColumns ? 'grid gap-4' : 'grid gap-4 sm:grid-cols-2'}>
      <div className="min-w-0">
        <Label optional>Inspection form</Label>
        <SearchableSelect
          size="lg"
          ariaLabel="Inspection form"
          describedBy={ids.formNote}
          placeholder={formsQ.isLoading ? 'Loading…' : 'No form'}
          options={formOptions}
          value={draft.formId}
          onChange={(v) => set({ formId: v })}
        />
        <p id={ids.formNote} className="mt-1 text-xs text-ink-2">
          {chosenForm ? 'The task opens this checklist; finishing it completes the task.' : 'A check carried out with a checklist (optional).'}
        </p>
      </div>
      {draft.formId ? (
        <div className="min-w-0">
          <Label htmlFor={ids.place}>Place (optional)</Label>
          <input id={ids.place} dir="auto" value={draft.place} maxLength={INSPECTION_LIMITS.placeMax} onChange={(e) => set({ place: e.target.value })} placeholder="e.g. Rig 3" className={`${fieldClass()} h-11`} />
        </div>
      ) : null}
    </div>
  );
  const whenFields = (
    <div className={twoColumns ? 'grid grid-cols-2 gap-4' : 'grid gap-4 sm:grid-cols-3'}>
      <div className={twoColumns && !countsByWeight(project) ? 'col-span-2 min-w-0' : 'min-w-0'}>
        <Label>Priority</Label>
        <SearchableSelect size="lg" ariaLabel="Priority" options={priorityOptions()} value={draft.priority} onChange={(v) => set({ priority: v as Priority })} />
      </div>
      {countsByWeight(project) ? (
        // 1.23.5: this project counts its completion by weight — how much this task counts.
        <div className="min-w-0">
          <Label optional>Weight</Label>
          <SearchableSelect size="lg" ariaLabel="Weight" options={weightChoices(projectWeights(project)[draft.priority])} value={weight} onChange={setWeight} />
        </div>
      ) : null}
      <div className="min-w-0">
        <Label htmlFor={ids.start} optional>Start date</Label>
        <input
          id={ids.start}
          type="date"
          value={draft.startDate}
          onChange={(e) => set({ startDate: e.target.value })}
          aria-invalid={startProblem ? true : undefined}
          aria-describedby={[startProblem ? ids.startErr : null, startNote ? ids.startNote : null].filter(Boolean).join(' ') || undefined}
          className={`${fieldClass(!!startProblem)} h-11`}
        />
        {startProblem ? <p id={ids.startErr} role="alert" className="mt-1 text-xs font-medium text-danger">{startProblem}</p> : null}
        {startNote ? <p id={ids.startNote} className="mt-1 text-xs text-ink-2">{startNote}</p> : null}
      </div>
      <div className="min-w-0">
        <Label htmlFor={ids.due} optional>Due date</Label>
        <input
          id={ids.due}
          type="date"
          value={draft.dueDate}
          onChange={(e) => set({ dueDate: e.target.value })}
          aria-describedby={[autoDue ? ids.dueNote : null, dueWarning ? ids.dueWarn : null].filter(Boolean).join(' ') || undefined}
          className={`${fieldClass()} h-11`}
        />
        {autoDue ? <p id={ids.dueNote} className="mt-1 text-xs text-ink-2">{defaultDueNote(autoDue, today)}</p> : null}
        {dueWarning ? (
          <p id={ids.dueWarn} aria-live="polite" className="mt-1 text-xs font-medium text-warning">
            {dueWarning}
          </p>
        ) : null}
      </div>
      <div className={twoColumns ? 'col-span-2 min-w-0' : 'min-w-0'}>
        <Label>Repeat</Label>
        {canRepeat ? (
          <SearchableSelect
            size="lg"
            ariaLabel="Repeat"
            options={repeatOptions}
            value={draft.rule?.freq ?? 'NONE'}
            onChange={(v) => set({ rule: withFrequency(draft.rule, v) })}
          />
        ) : (
          <p className="flex min-h-[44px] items-center rounded-xl bg-ground px-3.5 text-xs text-ink-2">
            An earlier copy of a repeating series — change the repeat on its newest copy.
          </p>
        )}
      </div>
      {schedule?.canEdit && schedule.schedules.length ? (
        <div className={twoColumns ? 'col-span-2 min-w-0' : 'min-w-0'}>
          <Label>Reminders</Label>
          <SearchableSelect
            size="lg"
            ariaLabel="Reminders"
            options={[
              { value: '', label: `The project’s (${schedule.schedules.find((x) => x.id === (schedule.projectScheduleId ?? schedule.schedules.find((y) => y.isDefault)?.id))?.name ?? 'default'})` },
              ...schedule.schedules.map((x) => ({ value: x.id, label: x.name })),
            ]}
            value={reminderPick ?? savedReminder}
            onChange={(v) => setReminderPick(v)}
          />
        </div>
      ) : null}
    </div>
  );
  const repeatSchedule = draft.rule && canRepeat ? (
    <fieldset role="group" aria-label="Repeat schedule" className="rounded-2xl border border-line bg-ground/50 p-3.5 sm:p-4">
      <p className="mb-3 flex items-start gap-2 text-sm font-semibold text-ink">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="mt-0.5 flex-none text-brand">
          <path d="M17 2l4 4-4 4" /><path d="M3 11V9a3 3 0 0 1 3-3h15" /><path d="M7 22l-4-4 4-4" /><path d="M21 13v2a3 3 0 0 1-3 3H3" />
        </svg>
        <span>{scheduleText(draft.rule, dueWhen)}</span>
      </p>
      <div ref={untilRef}>
        <RecurrenceEditor hideFrequency kind={draft.formId ? 'check' : 'task'} value={draft.rule} onChange={(rule) => set({ rule })} dueDate={dueWhen || null} />
      </div>
      {untilProblem ? <p id={ids.untilErr} role="alert" className="mt-2 text-xs font-medium text-danger">{untilProblem}</p> : null}
      {!dueWhen ? <p className="mt-2 text-xs text-ink-2">Set a due date to see the next dates.</p> : null}
    </fieldset>
  ) : null;
  // 1.24 The Assign box: team members ("Internal user") and guests from the company's list ("Guest"),
  // the guests after the team in one list, each marked Guest.
  const showTeamError = teamError && teamProblem;
  const guestChips = draft.guests.length
    ? draft.guests.map((g) => (
        <li key={`guest-${g.id}`} data-guest-chip={g.id} className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-line bg-ground py-1 pe-1 ps-2.5 text-sm text-ink">
          <span dir="auto" className="min-w-0 truncate" title={guestChipText(g)}>
            {guestChipText(g)}
          </span>
          <GuestBadge />
          <button
            type="button"
            onClick={() => removeGuest(g.id)}
            disabled={saving || !!created}
            aria-label={`Remove ${guestLabel(g)}`}
            title={`Remove ${guestLabel(g)}`}
            className="grid h-6 w-6 flex-none place-items-center rounded-full text-ink-2 transition-colors hover:bg-danger-soft hover:text-danger [@media(pointer:coarse)]:-my-2.5 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
          >
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </li>
      ))
    : null;
  const assigneesField = (
    <div ref={assignRef}>
      <Label optional={!draft.guests.length}>Assignees</Label>
      <AssigneeSelect
        people={people}
        value={draft.assigneeIds}
        onChange={(assigneeIds) => set({ assigneeIds })}
        note={showTeamError ? null : teamProblem ? GUEST_WORDS.needsTeam : assigneeNote}
        disabled={!draft.projectId}
        invalid={showTeamError || undefined}
        describedBy={showTeamError ? ids.teamErr : undefined}
        extraChips={guestChips}
        modeSwitch={guestsKnown && draft.projectId ? <AssignModeSwitch mode={assignMode} onChange={setAssignMode} disabled={saving || !!created} /> : null}
        picker={
          guestsKnown && draft.projectId && assignMode === 'guest' ? (
            <GuestPicker projectId={draft.projectId} exclude={draft.guests.map((g) => g.id)} onPick={addGuest} disabled={saving || !!created} />
          ) : undefined
        }
      />
      {showTeamError ? (
        <p id={ids.teamErr} role="alert" className="mt-1 text-xs font-medium text-danger">
          {GUEST_WORDS.needsTeam}
        </p>
      ) : null}
    </div>
  );
  // 1.24 Categories: the project's own list (shown when it has any, or needs one).
  const showCategoryError = categoryError && categoryProblem;
  const categoriesField = catsShown ? (
    <div ref={categoriesRef}>
      <span id={ids.catLabel} className="mb-1.5 flex items-baseline gap-1.5 text-sm font-semibold text-ink">
        {CATEGORY_WORDS.heading}
        {catsRequired ? (
          <>
            <span aria-hidden="true" className="text-danger">*</span>
            <span className="text-xs font-normal text-ink-2">(required)</span>
          </>
        ) : (
          <span className="text-xs font-normal text-ink-2">(optional)</span>
        )}
      </span>
      <CategoryPicker
        categories={catChoices}
        value={draft.categoryIds}
        kept={keptCategories}
        onChange={(categoryIds) => set({ categoryIds })}
        labelledBy={ids.catLabel}
        required={catsRequired}
        invalid={showCategoryError}
        describedBy={showCategoryError ? ids.catErr : undefined}
        disabled={saving || !!created}
      />
      {showCategoryError ? (
        <p id={ids.catErr} role="alert" className="mt-1 text-xs font-medium text-danger">
          {CATEGORY_WORDS.pickOne}
        </p>
      ) : null}
    </div>
  ) : null;
  const attachmentsField = !editing ? (
    <div>
      <Label optional>Attachments</Label>
      <FilesField files={files} onAdd={addFiles} onRemove={(key) => setFiles((f) => f.filter((p) => p.key !== key))} busy={saving || !!created} />
    </div>
  ) : null;
  const milestoneField = (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line px-3.5 py-3 transition-colors hover:border-brand/40">
      <input type="checkbox" checked={draft.milestone} onChange={(e) => set({ milestone: e.target.checked })} className="mt-0.5 h-4 w-4 accent-brand" />
      <span>
        <span className="flex items-center gap-1.5 text-sm font-semibold text-ink"><span className="text-brand"><MilestoneIcon /></span>Milestone</span>
        <span className="block text-xs text-ink-2">A key date or deliverable of the project — listed on its dashboard.</span>
      </span>
    </label>
  );
  const approvalField = (
    <label className={`flex items-start gap-3 rounded-xl border border-line px-3.5 py-3 transition-colors ${approvalLocked ? 'bg-ground/60' : 'cursor-pointer hover:border-brand/40'}`}>
      <input
        type="checkbox"
        checked={draft.approval}
        disabled={approvalLocked}
        aria-describedby={approvalLocked ? `${ids.approvalHint} ${ids.approvalLocked}` : ids.approvalHint}
        onChange={(e) => {
          approvalChosen.current = true;
          set({ approval: e.target.checked });
        }}
        className="mt-0.5 h-4 w-4 accent-brand"
      />
      <span>
        <span className="flex items-center gap-1.5 text-sm font-semibold text-ink"><span className="text-warning"><WaitingIcon size={14} /></span>Needs approval</span>
        <span id={ids.approvalHint} className="block text-xs text-ink-2">{APPROVAL_HINT}</span>
        {approvalLocked ? <span id={ids.approvalLocked} className="block text-xs text-ink-2">{APPROVAL_LOCKED}</span> : null}
        {editing && task?.approvalRequestedAt && !approvalLocked ? <span className="block text-xs text-ink-3">It is waiting for approval: turning this off marks it done.</span> : null}
      </span>
    </label>
  );
  const scopeField = editing && inSeries ? (
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
      <p className="mt-1 text-xs text-ink-2">The title, description and priority go to every copy when you choose the series; dates change on this copy only.</p>
    </fieldset>
  ) : null;

  return (
    <ModalPortal>
      <div className={dialogLayer('wide')}>
        <div className="absolute inset-0 bg-scrim animate-fade-in" onClick={requestClose} aria-hidden="true" />
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
          className={`keyboard-flow-cramped card relative flex flex-col overflow-hidden shadow-lift animate-scale-in ${dialogPanel('wide')}`}
        >
          <div className="flex flex-none items-center gap-3 border-b border-line px-4 py-3.5 sm:px-6">
            <h2 className="font-display text-xl font-bold text-ink">{heading}</h2>
            {task ? <TaskKey value={task.key} size="lg" /> : null}
            <button type="button" onClick={requestClose} aria-label="Close" title="Close (Esc)" className="ms-auto grid h-10 w-10 place-items-center rounded-lg text-ink-2 transition-colors hover:bg-ground hover:text-ink [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </div>

          <form onSubmit={(e) => void submit(e)} noValidate className="keyboard-flow-body flex min-h-0 flex-1 flex-col">
            <div className="keyboard-flow-body min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 sm:py-5">
              {banner ? <p role="alert" className="rounded-xl border border-danger/30 bg-danger-soft px-3.5 py-2.5 text-sm text-danger">{banner}</p> : null}
              {prefillProblem ? (
                <p role="alert" className="rounded-xl border border-danger/30 bg-danger-soft px-3.5 py-2.5 text-sm text-danger">{prefillProblem}</p>
              ) : prefillWaiting ? (
                <p role="status" className="py-10 text-center text-sm text-ink-2">Loading the task…</p>
              ) : noProjects ? (
                <NoProjectYet />
              ) : (
              <>
              {twoColumns ? (
                <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] items-start gap-6">
                  <div data-form-column="task" className="min-w-0 space-y-5">
                    {templateField}
                    {describeField}
                    {placeFields}
                    {noticeLine}
                    {alsoCopiedLine}
                    {titleField}
                    {descriptionField}
                    {checklistField}
                    {copyFilesField}
                    {attachmentsField}
                  </div>
                  <div data-form-column="details" className="min-w-0 space-y-5">
                    {whenFields}
                    {repeatSchedule}
                    {assigneesField}
                    {categoriesField}
                    {formFields}
                    {milestoneField}
                    {approvalField}
                    {scopeField}
                  </div>
                </div>
              ) : (
                <>
                  {templateField}
                  {describeField}
                  {placeFields}
                  {noticeLine}
                  {alsoCopiedLine}
                  {titleField}
                  {descriptionField}
                  {checklistField}
                  {formFields}
                  {whenFields}
                  {repeatSchedule}
                  {assigneesField}
                  {categoriesField}
                  {copyFilesField}
                  {attachmentsField}
                  {milestoneField}
                  {approvalField}
                  {scopeField}
                </>
              )}
              </>
              )}
            </div>

            <div className="flex flex-none items-center gap-2 border-t border-line bg-surface px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:justify-end sm:px-6">
              {!created ? (
                <button type="button" title="Cancel (Esc)" aria-keyshortcuts="Escape" onClick={requestClose} disabled={saving} className="!min-h-[44px] flex-1 rounded-xl border border-line px-4 text-sm font-semibold text-ink transition-colors hover:bg-ground disabled:opacity-50 sm:flex-none">
                  Cancel
                </button>
              ) : null}
              {noProjects ? (
                <CreateProjectLink onGo={onClose} />
              ) : (
              <Button type="submit" shortcut={editing ? 'save' : 'submit'} showShortcut loading={saving} disabled={prefillWaiting} className="!min-h-[44px] flex-[2] sm:flex-none sm:min-w-[9.5rem]">
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
              )}
            </div>
          </form>
        </div>
      </div>
      {confirmClose ? (
        <ConfirmDialog
          title={editing ? 'Discard your changes?' : duplicating ? 'Discard this copy?' : 'Discard this task?'}
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

/** "plan.pdf, site.dwg and photo.png" — a few names, then how many more. */
function fileNames(files: { filename: string }[], shown = 3): string {
  const names = files.map((f) => f.filename);
  if (names.length <= shown + 1) return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `${names.slice(0, shown).join(', ')} and ${names.length - shown} more`;
}

/** Where a new project is made: the Projects page, with its New project form open. */
export const NEW_PROJECT_PATH = '/projects?new=1';

/** No project to add a task to yet: what a task needs, in place of the form's fields. */
function NoProjectYet() {
  return (
    <div className="grid place-items-center gap-2 px-2 py-10 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand/10 text-brand" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          <path d="M12 11v5M9.5 13.5h5" />
        </svg>
      </span>
      <p className="font-semibold text-ink">Create a project first</p>
      <p className="max-w-sm text-sm text-ink-2">Every task belongs to a project, with its board and people. Make the first project, then you can add tasks to it.</p>
    </div>
  );
}

const CREATE_PROJECT_LINK =
  'inline-flex !min-h-[44px] flex-[2] items-center justify-center gap-2 rounded-xl bg-brand-gradient px-4 text-sm font-semibold text-white shadow-brand transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lift sm:flex-none sm:min-w-[9.5rem]';

/** The form's main button when there is no project: off to make one (a plain link outside the app's router). */
function CreateProjectLink({ onGo }: { onGo: () => void }) {
  return useInRouterContext() ? (
    <Link to={NEW_PROJECT_PATH} onClick={onGo} className={CREATE_PROJECT_LINK}>Create a project</Link>
  ) : (
    <a href={NEW_PROJECT_PATH} className={CREATE_PROJECT_LINK}>Create a project</a>
  );
}
