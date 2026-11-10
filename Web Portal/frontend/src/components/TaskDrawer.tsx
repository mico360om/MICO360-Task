import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { ApiTask, Priority, RecurrenceRule } from '../api/tasks';
import { PriorityBadge } from './ui/PriorityBadge';
import { countsByWeight, projectWeights } from '../lib/project-health';
import { ClientEyeIcon, MilestoneIcon } from './TaskCard';
import { InspectionChip } from './inspections/inspection-ui';
import { Toggle } from './ui/Toggle';
import { ProjectAvatar, type ProjectLook } from './ProjectAvatar';
import { recurrenceSummary } from '../lib/recurrence-summary';
import { statusMeta } from '../lib/taskStatus';
import { formatDueDay, isTaskLate } from '../lib/due-display';
import { DEFAULT_TIME_ZONE } from '../lib/company-clock';
import { formatMeetingDay } from '../lib/meetingFormat';
import { dayText, instantDayText } from '../lib/day-words';
import { useMediaQuery } from '../lib/useMediaQuery';
import { Icon } from './meeting/kit';
import type { MentionPerson } from '../lib/mentions';
import { InlineDescription, InlineTitle } from './task-drawer/inline-text';
import { PropertiesPanel, type DrawerAssignee, type DrawerStatusColumn, type FieldPatch } from './task-drawer/properties';
import { NestedChecklists, type ChecklistActions, type ChecklistRemovedBatch } from './checklists/NestedChecklists';
import type { ChecklistAt, CLList, CLPerson } from '../lib/checklist-tree';
import { todayKey } from '../lib/due-date';
import { CommentsSection, type DrawerComment, type ReplyToComment } from './task-drawer/comments';
import { ActivityTimeline, type DrawerActivity } from './task-drawer/activity';
import { AttachmentsSection, type DrawerAttachment, type LoadOfficePreview, type SetFileClientVisible } from './task-drawer/attachments';
import { DependenciesSection, type DrawerDependencies, type DrawerTaskRef } from './task-drawer/dependencies';
import { ExportMenu, MoreActionsMenu, WatchButton } from './task-drawer/menus';
import { ShortcutHint, useShortcut, useShortcutHint } from './shortcuts/ShortcutProvider';
import { ConfirmDialog } from './ui/ConfirmDialog';
import type { StepDirection, TaskStepper } from '../lib/task-steps';
import { TaskKey } from './TaskKey';
import { mergedFromKeys } from '../lib/task-merge';

/** A carried-forward day ('YYYY-MM-DD') in words — "20 Oct 2026" — as the rest of the panel writes days. */
const carriedDay = (key: string) => dayText(key) || key;

/** Below 768px (the md width, in em as the layout's widths are). */
const PHONE_QUERY = '(max-width: 47.9375em)';

/** A checklist item as the panel gets it (1.23.3: in a checklist, under a parent, with a person and a due day). */
export interface DrawerChecklistItem {
  id: string;
  text: string;
  done: boolean;
  position?: number;
  listId?: string;
  parentId?: string | null;
  assignee?: CLPerson | null;
  /** 'YYYY-MM-DD'. */
  dueDate?: string | null;
}
export type DrawerChecklistList = CLList;

export type { DrawerAssignee, DrawerStatusColumn, DrawerComment, DrawerActivity, DrawerAttachment, DrawerDependencies, DrawerTaskRef };

export interface TaskDrawerProps {
  task: ApiTask;
  /** Company time zone: a task is overdue only once its due day is before today there. */
  timeZone?: string;
  /** A failed action (assign, upload, delete, status…) to show at the top of the drawer. */
  actionError?: string | null;
  onDismissError?: () => void;
  /** Every checklist item, list by list in tree order. */
  checklist: DrawerChecklistItem[];
  /** 1.23.3: the task's checklists (none yet, or an older server: one "Checklist"). */
  checklistLists?: DrawerChecklistList[];
  comments: DrawerComment[];
  /** The comments have loaded (until then an empty list isn't "no comments"; default: loaded). */
  commentsLoaded?: boolean;
  /** Who I am, for my comment while it is on its way. */
  me?: { name: string; avatarUrl?: string | null };
  onToggleChecklistItem?: (id: string, done: boolean) => Promise<void> | void;
  /** Add an item at a place (a checklist, under a parent, after a sibling); answers its id. */
  onAddChecklistItem?: (text: string, at: ChecklistAt) => Promise<string | void> | string | void;
  onRenameChecklistItem?: (id: string, text: string) => Promise<void> | void;
  /** Delete an item (and its sub-items); answers the batch Undo restores. */
  onRemoveChecklistItem?: (id: string) => Promise<ChecklistRemovedBatch | void> | ChecklistRemovedBatch | void;
  /** 1.23.3: everything else the checklists offer (sub-items, people, dates, moves, copies, whole checklists, restore). */
  checklistActions?: ChecklistActions;
  /** Opened at a checklist item (…&item=<id>): it is brought into view and marked. */
  checklistFocusItemId?: string | null;
  /** Deleted checklist items and checklists that can still be restored (their batches), for Restore in the history. */
  checklistRestorable?: ReadonlySet<string>;
  /** Ask AI to break the task into steps; the user reviews them before any is added. */
  onSuggestChecklist?: () => Promise<string[] | void>;
  /** Ask AI for a recommended priority + reason; the user applies it or not. */
  onSuggestPriority?: () => Promise<{ priority: Priority; reason: string }>;
  /**
   * Post a comment; resolves with the saved comment's id (when known), rejects with the reason when it could not be
   * posted (the comment stays, "Not sent", with its words).
   */
  onAddComment?: (body: string) => Promise<unknown> | void;
  /** Save a comment's new text; rejects with a message to show when it could not be saved. */
  onEditComment?: (id: string, body: string) => Promise<void> | void;
  onDeleteComment?: (id: string) => void;
  /**
   * Reply to any comment (owner, 10 Nov; 1.23: a client's) — `clientVisible`: in a client's thread, the client sees
   * the reply and gets it by email. Rejects with the reason to show when it couldn't be sent (the draft is kept).
   */
  onReplyComment?: ReplyToComment;
  /** Who an @mention in this task's comments would notify — suggested while typing, marked in comments. */
  mentionable?: MentionPerson[];
  assignees?: DrawerAssignee[];
  assignableUsers?: DrawerAssignee[];
  onAssignUser?: (userId: string) => Promise<void> | void;
  onUnassignUser?: (userId: string) => Promise<void> | void;
  attachments?: DrawerAttachment[];
  /** Upload one file, reporting how much has been sent (0–1); rejects with the reason on failure. */
  onUploadFile?: (file: File, onProgress?: (fraction: number) => void) => Promise<unknown> | void;
  onDeleteAttachment?: (id: string) => Promise<void> | void;
  /** Loads the text of a Word / Excel / PowerPoint attachment for its in-app preview. */
  onPreviewAttachment?: LoadOfficePreview;
  /** 1.23.7: "Show to client" on a file — for whoever may show the task to clients (as onSetClientVisible). */
  onSetAttachmentClientVisible?: SetFileClientVisible;
  dependencies?: DrawerDependencies;
  availableTasks?: DrawerTaskRef[];
  onAddDependency?: (dependsOnTaskId: string) => Promise<void> | void;
  onRemoveDependency?: (dependsOnTaskId: string) => Promise<void> | void;
  onSetRecurrence?: (rule: RecurrenceRule | null) => Promise<void> | void;
  /** The project's columns (Kanban stages) so status can be changed by moving the task. */
  statusColumns?: DrawerStatusColumn[];
  onChangeStatus?: (columnId: string) => Promise<void> | void;
  /** Task activity history (newest first). */
  activity?: DrawerActivity[];
  /**
   * Save an edit to one of the task's core fields — with `'series'` on a recurring task, apply it to
   * every occurrence. Rejects with the reason to show when it could not be saved.
   */
  onSaveEdit?: (patch: FieldPatch, scope?: 'series') => void | Promise<void>;
  /** @deprecated Inline edits show their own saving state. */
  savePending?: boolean;
  /** Delete the task — with `'series'` on a recurring task, delete the whole series. */
  onDelete?: (scope?: 'series') => void;
  /** Why this person may not delete this task: Delete task is shown greyed out, saying so. */
  deleteBlocked?: string | null;
  /** Why they may not delete its entire series: "Entire series" is shown greyed out, saying so. */
  seriesDeleteBlocked?: string | null;
  /** Whether the current user is watching (following) this task. */
  watching?: boolean;
  /** How many people watch this task. */
  watcherCount?: number;
  /** Toggle the current user's watch on this task. */
  onToggleWatch?: () => void;
  /** Download the task as an Excel workbook or a PDF. */
  onExport?: (format: 'xlsx' | 'pdf') => Promise<void>;
  /** Open the full edit form (every field at once). */
  onEdit?: () => void;
  /** The task's project, named in the header (1.23.5: with how it counts completion, for the Weight field). */
  project?: ProjectLook & { id: string; completionMode?: 'COUNT' | 'WEIGHT'; weightUrgent?: number; weightHigh?: number; weightNormal?: number; weightLow?: number };
  /** Move the task to another project (in “More actions”). */
  onMoveToProject?: () => void;
  /** Why it can't be moved now: the item is shown, unavailable, saying so. */
  moveUnavailable?: string | null;
  /** Save it as a task template (in “More actions”; whoever runs its project). */
  onSaveAsTemplate?: () => void;
  /**
   * Show the task on (or take it off) the project's client page — offered to whoever runs the
   * project. Rejects with the reason to show when it couldn't be changed.
   */
  onSetClientVisible?: (visible: boolean) => Promise<void> | void;
  /**
   * 1.23: "Also show its description" (only while the task is shown to the client). Rejects with
   * the reason to show when it couldn't be changed.
   */
  onSetClientDescription?: (show: boolean) => Promise<void> | void;
  /** The task's inspections (carried out for it, or the one it follows up), beside its details. */
  inspections?: ReactNode;
  /** The "Approval" section (needs approval; Approve / Send back while it waits) — first while it waits. */
  approval?: ReactNode;
  /** The "External contacts" section (people outside the company responsible for the task), under its details. */
  externalContacts?: ReactNode;
  /** Previous / Next through the list the task was opened from (none: no steps shown). */
  stepper?: TaskStepper;
  /** 1.23.1: merge it with other tasks (in “More actions”; administrators and its project's managers). */
  onMerge?: () => void;
  /** Why it can't be merged now: the item is shown, unavailable, saying so. */
  mergeUnavailable?: string | null;
  /** The "Merged from" panel (the tasks merged into this one), beside its details. */
  mergedFrom?: ReactNode;
  /** Opened by a merged task's number or link: "MICO-14 was merged into this task on 5 Nov by Khurram." */
  mergeNotice?: string | null;
  /** Checklist items and history lines that came with a merged task, by id ("From MICO-14"). */
  checklistFromKeys?: Record<string, string>;
  activityFromKeys?: Record<string, string>;
  onClose: () => void;
}

export type { TaskStepper };

/** Something typed in the panel and not yet saved (a title, description, comment or checklist box marks itself). */
export const UNSAVED_FIELD = '[data-unsaved]';

const STEP_BUTTON =
  'inline-flex h-9 flex-none items-center justify-center gap-1 rounded-lg border border-line px-2 text-sm font-semibold text-ink transition-colors hover:border-brand hover:text-brand disabled:cursor-default disabled:opacity-40 disabled:hover:border-line disabled:hover:text-ink max-sm:w-11 max-sm:px-0 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:!min-w-11';
const Chevron = ({ dir }: { dir: StepDirection }) => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="rtl:rotate-180">
    <path d={dir === 'previous' ? 'M15 18l-6-6 6-6' : 'M9 18l6-6-6-6'} />
  </svg>
);

const NO_PEOPLE: MentionPerson[] = [];

function StatusPill({ category }: { category?: string | null }) {
  const m = statusMeta(category);
  // Tinted with the status's own colour (dark text kept for contrast), so status reads at a glance.
  return (
    <span
      data-testid="status-pill"
      className="inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-semibold text-ink"
      style={{ background: `color-mix(in srgb, ${m.color} 16%, transparent)`, borderColor: `color-mix(in srgb, ${m.color} 40%, transparent)` }}
    >
      <span className="h-2 w-2 rounded-full" style={{ background: m.color }} aria-hidden />
      {m.label}
    </span>
  );
}

const CalendarIcon = () => (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="4" width="18" height="18" rx="2" />
    <path d="M16 2v4M8 2v4M3 10h18" />
  </svg>
);

/**
 * "Show to client": whether the project's client page and the Client portal list this task (its
 * title, status and due date) — and, with a tick of its own while it is shown, its description (1.23).
 */
function ClientViewSwitch({
  on,
  onChange,
  description,
  onDescription,
}: {
  on: boolean;
  onChange: (visible: boolean) => Promise<void> | void;
  description: boolean;
  onDescription?: (show: boolean) => Promise<void> | void;
}) {
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // The description tick shows what was ticked while it saves, until the task says so too (back as
  // it was if the save fails; after a moment, whatever the task says).
  const [ticking, setTicking] = useState<boolean | null>(null);
  useEffect(() => {
    if (ticking === null || saving) return;
    if (ticking === description) {
      setTicking(null);
      return;
    }
    const t = setTimeout(() => setTicking(null), 1000);
    return () => clearTimeout(t);
  }, [ticking, saving, description]);
  const run = async (save: () => Promise<void> | void) => {
    setSaving(true);
    setProblem(null);
    try {
      await save();
    } catch (err) {
      setTicking(null);
      setProblem(err instanceof Error && err.message && !/^Request failed/.test(err.message) ? err.message : 'Couldn’t change it. Please try again.');
    } finally {
      setSaving(false);
    }
  };
  return (
    <section aria-labelledby="task-client-heading" className="rounded-xl border border-line p-3">
      <div className="flex items-center justify-between gap-3">
        <h3 id="task-client-heading" className="eyebrow">Client view</h3>
        <Toggle on={on} onChange={() => void run(() => onChange(!on))} label="Show to client" describedBy="task-client-hint" disabled={saving} />
      </div>
      <p id="task-client-hint" className="mt-1 text-xs leading-relaxed text-ink-2">
        Show to client: its title, status and due date appear on the project’s client page and in the Client portal, where clients with access may comment on it or sign it off, if allowed.
        {' '}Its description only with “Also show its description”, files only those marked “Show to client”. Never people or the team’s comments, except replies marked “Visible to client”.
      </p>
      {on && onDescription ? (
        <label className="mt-2 flex min-h-9 cursor-pointer items-center gap-2 text-sm text-ink [@media(pointer:coarse)]:min-h-11">
          <input
            type="checkbox"
            checked={ticking ?? description}
            disabled={saving}
            onChange={(e) => {
              const show = e.target.checked;
              setTicking(show);
              void run(() => onDescription(show));
            }}
            className="h-4 w-4 flex-none accent-[rgb(var(--c-brand))]"
          />
          Also show its description
        </label>
      ) : null}
      {problem ? <p role="alert" className="mt-1 text-xs font-medium text-danger">{problem}</p> : null}
    </section>
  );
}

/** 1.23: "Client accepted · 30 Oct 2026" — the client signed off this finish in the Client portal. */
function ClientAcceptedMark({ at, timeZone }: { at: string; timeZone: string }) {
  const day = instantDayText(at, timeZone);
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-success-soft px-1.5 py-0.5 text-xs font-semibold text-success" title="The client signed it off in the Client portal">
      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M20 6 9 17l-5-5" />
      </svg>
      {day ? `Client accepted · ${day}` : 'Client accepted'}
    </span>
  );
}

/** The meeting the task was created from: a link to it, or — for someone not part of it — just a mention. */
function MeetingLink({ meeting, timeZone }: { meeting: NonNullable<ApiTask['meeting']>; timeZone: string }) {
  if (!meeting.canView || !meeting.title) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-ground px-2 py-0.5 text-xs font-medium text-ink-2 [&_svg]:h-3.5 [&_svg]:w-3.5">
        {Icon.calendar}
        From a meeting you’re not part of
      </span>
    );
  }
  const day = meeting.startAt ? formatMeetingDay(meeting.startAt, timeZone) : '';
  return (
    <Link
      to={`/meetings/${encodeURIComponent(meeting.id)}`}
      title="Open the meeting this task was created from"
      className="inline-flex min-h-7 max-w-full items-center gap-1 rounded-full bg-brand/10 px-2 text-xs font-medium text-brand transition-colors hover:bg-brand/15 hover:underline [&_svg]:h-3.5 [&_svg]:w-3.5 [&_svg]:flex-none"
    >
      {Icon.calendar}
      <span className="truncate">From meeting: {meeting.title}</span>
      {day ? <span className="flex-none">· {day}</span> : null}
    </Link>
  );
}

export function TaskDrawer({
  task,
  timeZone = DEFAULT_TIME_ZONE,
  actionError,
  onDismissError,
  checklist,
  checklistLists = [],
  comments,
  onToggleChecklistItem,
  onAddChecklistItem,
  onRenameChecklistItem,
  onRemoveChecklistItem,
  checklistActions,
  checklistFocusItemId,
  checklistRestorable,
  onSuggestChecklist,
  onSuggestPriority,
  commentsLoaded,
  me,
  onAddComment,
  onEditComment,
  onDeleteComment,
  onReplyComment,
  mentionable = NO_PEOPLE,
  assignees,
  assignableUsers = [],
  onAssignUser,
  onUnassignUser,
  attachments = [],
  onUploadFile,
  onDeleteAttachment,
  onPreviewAttachment,
  onSetAttachmentClientVisible,
  dependencies,
  availableTasks = [],
  onAddDependency,
  onRemoveDependency,
  onSetRecurrence,
  statusColumns = [],
  onChangeStatus,
  activity = [],
  onSaveEdit,
  onDelete,
  deleteBlocked,
  seriesDeleteBlocked,
  watching,
  watcherCount,
  onToggleWatch,
  onExport,
  onEdit,
  project,
  onMoveToProject,
  moveUnavailable,
  onSaveAsTemplate,
  onSetClientVisible,
  onSetClientDescription,
  inspections,
  approval,
  externalContacts,
  stepper,
  onMerge,
  mergeUnavailable,
  mergedFrom,
  mergeNotice,
  checklistFromKeys,
  activityFromKeys,
  onClose,
}: TaskDrawerProps) {
  // Escape / focus trapping live in TaskDrawerContainer, so they also work while loading or on errors.
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // E edits the task and Delete asks to delete it, while this panel is open.
  const rootRef = useRef<HTMLDivElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  useShortcut('edit', () => onEdit?.(), { scope: rootRef, enabled: !!onEdit });
  useShortcut('delete', () => setConfirmingDelete(true), { scope: rootRef, enabled: !!onDelete && !deleteBlocked });
  const editHint = useShortcutHint('edit');
  const deleteHint = useShortcutHint('delete');
  // Previous / Next (and K / J): something typed and not saved asks first, as the edit form does.
  const [askStep, setAskStep] = useState<StepDirection | null>(null);
  const previousRef = useRef<HTMLButtonElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const stepTo = (dir: StepDirection) => (dir === 'next' ? stepper?.onNext : stepper?.onPrevious);
  const step = (dir: StepDirection) => {
    const go = stepTo(dir);
    if (!go) return;
    if (rootRef.current?.querySelector(UNSAVED_FIELD)) setAskStep(dir);
    else go();
  };
  useShortcut('next', () => step('next'), { scope: rootRef, enabled: !!stepper?.onNext });
  useShortcut('previous', () => step('previous'), { scope: rootRef, enabled: !!stepper?.onPrevious });
  const nextHint = useShortcutHint('next');
  const previousHint = useShortcutHint('previous');
  const placeId = useId();
  // The panel of the task just stepped to: focus stays on the step pressed (the other at the end).
  const stepFocus = useRef(stepper?.focus ?? null);
  useEffect(() => {
    const dir = stepFocus.current;
    if (!dir) return;
    const pressed = dir === 'next' ? nextRef.current : previousRef.current;
    const other = dir === 'next' ? previousRef.current : nextRef.current;
    (pressed && !pressed.disabled ? pressed : other)?.focus();
  }, []);
  const deleteWhyId = useId();
  const seriesWhyId = useId();
  // Asked to delete: focus moves to the safe answer, so Enter keeps the task.
  useEffect(() => {
    if (confirmingDelete) keepRef.current?.focus();
  }, [confirmingDelete]);
  // Every copy of a recurring series can be edited or deleted as a series; the newest carries the rule.
  const inSeries = Boolean(task.recurrenceRule || task.recurrenceParentId);
  const [scope, setScope] = useState<'one' | 'series'>('one');
  const saveField = onSaveEdit ? (patch: FieldPatch) => onSaveEdit(patch, inSeries && scope === 'series' ? 'series' : undefined) : undefined;

  // Calendar-day rule in the company zone; a finished task is never overdue, nor one waiting for approval.
  const overdue = isTaskLate(task, timeZone);
  const dueText = formatDueDay(task.dueDate, timeZone);
  const carried = task.carryForwardLog && task.carryForwardLog.length > 0 ? task.carryForwardLog : null;

  // Client view, "Needs approval" (while the task isn't waiting), an inspection to start, files and
  // blockers: beside the work on a wide screen and under the details on a tablet; on a phone after
  // the checklist and comments, which come first.
  const phone = useMediaQuery(PHONE_QUERY);
  const former = mergedFromKeys(task).former;
  // The checklists: the panel's own changes, then everything else the container offers.
  // Only a new list from the server is new items (a tick waiting for the server stays while the panel redraws).
  const checklistItems = useMemo(
    () => checklist.map((i) => ({ id: i.id, listId: i.listId ?? '', parentId: i.parentId ?? null, text: i.text, done: i.done, assignee: i.assignee ?? null, dueDate: i.dueDate ?? null })),
    [checklist],
  );
  const listActions: ChecklistActions = {
    toggle: onToggleChecklistItem,
    addItem: onAddChecklistItem ? (at, text) => onAddChecklistItem(text, at) : undefined,
    rename: onRenameChecklistItem,
    remove: onRemoveChecklistItem,
    ...checklistActions,
  };
  const sideParts = (
    <>
      {mergedFrom}
      {onSetClientVisible ? (
        <ClientViewSwitch on={!!task.clientVisible} onChange={onSetClientVisible} description={!!task.clientShowDescription} onDescription={onSetClientDescription} />
      ) : null}
      {task.approvalRequestedAt ? null : approval}
      {task.inspectionFormId ? null : inspections}
      <AttachmentsSection
        attachments={attachments}
        onUpload={onUploadFile}
        onDelete={onDeleteAttachment}
        onPreview={onPreviewAttachment}
        onSetClientVisible={onSetAttachmentClientVisible}
        taskShownToClient={!!task.clientVisible}
      />
      {dependencies ? (
        <DependenciesSection taskId={task.id} dependencies={dependencies} availableTasks={availableTasks} onAdd={onAddDependency} onRemove={onRemoveDependency} />
      ) : null}
    </>
  );

  // One column on a phone and a tablet; on a wide screen the details, files and links sit beside the
  // work and the discussion. The document order is what is seen, so reading and Tab follow it everywhere.
  return (
    <div ref={rootRef} data-shortcut-refresh role="dialog" aria-modal="true" aria-label={`Task ${task.key}`} className="keyboard-flow flex h-full w-full flex-col border-s border-line bg-surface shadow-lg">
      {/* A plain div, not <header>: inside a dialog that would be a second page "banner" landmark. */}
      <div data-testid="task-header" className="flex-none border-b border-line px-4 pb-3 pt-3 sm:px-6 sm:pt-4">
        <div className="flex items-center gap-2 max-sm:flex-wrap">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1.5">
            {project ? (
              <span data-testid="task-project" className="inline-flex min-w-0 max-w-[14rem] items-center gap-1.5 text-xs font-medium text-ink-2">
                <ProjectAvatar project={project} size="xs" />
                <span dir="auto" className="truncate">{project.name}</span>
              </span>
            ) : null}
            <TaskKey value={task.key} size="lg" />
            {former.length > 0 ? (
              // Its old numbers still find it (search, "open RIG-4"). 1.23.1: merged tasks' numbers are in "Merged from".
              <span className="text-xs text-ink-3" title="Its old number still finds it in search">
                Formerly {former.join(', ')}
              </span>
            ) : null}
            <StatusPill category={task.columnCategory} />
            {task.clientAcceptedAt ? <ClientAcceptedMark at={task.clientAcceptedAt} timeZone={timeZone} /> : null}
            <PriorityBadge priority={task.priority} />
            {task.isMilestone ? (
              <span className="inline-flex items-center gap-1 rounded-md bg-brand/10 px-1.5 py-0.5 text-xs font-semibold text-brand">
                <MilestoneIcon size={12} />
                Milestone
              </span>
            ) : null}
            {task.inspectionFormId ? <InspectionChip size="sm" /> : null}
            {task.clientVisible ? (
              <span className="inline-flex items-center gap-1 rounded-md bg-info-soft px-1.5 py-0.5 text-xs font-semibold text-info" title="Shown on the project’s client page">
                <ClientEyeIcon size={12} />
                Visible to client
              </span>
            ) : null}
            {dueText ? (
              <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium ${overdue ? 'bg-danger-soft text-danger' : 'text-ink-2'}`}>
                <CalendarIcon />
                {overdue ? <span>Overdue ·</span> : <span className="sr-only">Due</span>}
                <time dateTime={task.dueDate ?? undefined}>{dueText}</time>
              </span>
            ) : null}
          </div>
          {stepper ? (
            <div
              role="group"
              aria-label="Step through the list"
              // From a small tablet up, beside the actions; on a phone a row of its own under them (the key,
              // status and dates keep their room), the steps spread across it.
              className="flex flex-none items-center gap-1 border-e border-line pe-1.5 max-sm:order-last max-sm:basis-full max-sm:justify-between max-sm:border-e-0 max-sm:pe-0"
            >
              <button
                ref={previousRef}
                type="button"
                onClick={() => step('previous')}
                disabled={!stepper.onPrevious}
                aria-label="Previous task"
                aria-describedby={placeId}
                title={previousHint ? previousHint.title('Previous task') : 'Previous task'}
                aria-keyshortcuts={previousHint?.aria}
                className={STEP_BUTTON}
              >
                <Chevron dir="previous" />
                <span className="max-sm:sr-only">Previous</span>
              </button>
              <span id={placeId} className="whitespace-nowrap px-0.5 text-xs tabular-nums text-ink-2">
                {stepper.position} of {stepper.total}
              </span>
              <button
                ref={nextRef}
                type="button"
                onClick={() => step('next')}
                disabled={!stepper.onNext}
                aria-label="Next task"
                aria-describedby={placeId}
                title={nextHint ? nextHint.title('Next task') : 'Next task'}
                aria-keyshortcuts={nextHint?.aria}
                className={STEP_BUTTON}
              >
                <span className="max-sm:sr-only">Next</span>
                <Chevron dir="next" />
              </button>
            </div>
          ) : null}
          <div className="flex flex-none items-center gap-1.5">
            {onEdit ? (
              <button
                type="button"
                onClick={onEdit}
                aria-label="Edit task"
                title={editHint ? editHint.title('Edit every detail of the task') : 'Edit every detail of the task'}
                aria-keyshortcuts={editHint?.aria}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-2.5 text-sm font-semibold text-ink transition-colors hover:border-brand hover:text-brand [@media(pointer:coarse)]:h-11"
              >
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
                </svg>
                <span aria-hidden="true" className="hidden sm:inline">Edit</span>
                <ShortcutHint action="edit" />
              </button>
            ) : null}
            {onToggleWatch ? <WatchButton watching={Boolean(watching)} count={watcherCount} onToggle={onToggleWatch} className="hidden sm:inline-flex" /> : null}
            {onExport ? <ExportMenu onExport={onExport} className="hidden sm:block" /> : null}
            <MoreActionsMenu
              watching={watching}
              onToggleWatch={onToggleWatch}
              onExport={onExport}
              onMoveToProject={onMoveToProject}
              moveUnavailable={moveUnavailable}
              onSaveAsTemplate={onSaveAsTemplate}
              onMerge={onMerge}
              mergeUnavailable={mergeUnavailable}
              className={onMoveToProject || onSaveAsTemplate || onMerge ? '' : 'sm:hidden'}
            />
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              title="Close (Esc)"
              className="grid h-9 w-9 flex-none place-items-center rounded-lg text-ink-2 transition-colors hover:bg-ground hover:text-ink [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
        <div className="mt-2">
          <InlineTitle title={task.title} onSave={saveField ? (title) => saveField({ title }) : undefined} />
        </div>
        {inSeries || carried || task.meeting ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {task.meeting ? <MeetingLink meeting={task.meeting} timeZone={timeZone} /> : null}
            {task.recurrenceRule ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand">{Icon.repeat}{recurrenceSummary(task.recurrenceRule)}</span>
            ) : inSeries ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-ground px-2 py-0.5 text-xs font-medium text-ink-2">{Icon.repeat}Part of a repeating series</span>
            ) : null}
            {carried ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-ground px-2 py-0.5 text-xs font-medium text-ink-2" title={carried.map((e) => `${carriedDay(e.from)} → ${carriedDay(e.to)}`).join('\n')}>
                ↪ Carried forward {carried.length}× · since {carriedDay(carried[0]!.from)}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="keyboard-flow-body flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 sm:py-5">
        {mergeNotice ? (
          <p role="status" className="mb-4 rounded-lg bg-info-soft px-3 py-2 text-sm text-info">
            {mergeNotice}
          </p>
        ) : null}
        {actionError ? (
          <div role="alert" className="mb-4 flex items-start justify-between gap-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
            <span>{actionError}</span>
            {onDismissError ? (
              <button type="button" onClick={onDismissError} className="flex-none text-xs font-semibold underline">
                Dismiss
              </button>
            ) : null}
          </div>
        ) : null}

        {/* A check (a task that carries a form) is done by carrying out its inspection: that comes first. */}
        {/* Waiting for approval: the approver's buttons (or whose approval it waits for) come first. */}
        {task.approvalRequestedAt && approval ? <div className="mb-6">{approval}</div> : null}
        {task.inspectionFormId && inspections ? <div className="mb-6">{inspections}</div> : null}
        <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(17rem,20rem)] lg:grid-rows-[auto_auto_auto_auto_1fr] lg:items-start lg:gap-x-8 lg:gap-y-7">
          <section aria-labelledby="task-desc-heading" className="lg:col-start-1 lg:row-start-1">
            <h3 id="task-desc-heading" className="eyebrow mb-1.5">
              Description
            </h3>
            <InlineDescription description={task.description} onSave={saveField ? (description) => saveField({ description }) : undefined} />
          </section>
          {/* The details sit right after the description in reading (and Tab) order — beside the
              work on a wide screen (spanning every row; the last row soaks up any extra height),
              under the description on a tablet or phone. On a phone (below 768px) Client view, "Needs
              approval", files and blockers wait until after the checklist and comments: they are placed there in the
              page itself (not moved by CSS), so Tab and a screen reader follow what is seen. */}
          <div className="flex min-w-0 flex-col gap-5 lg:col-start-2 lg:row-span-5 lg:row-start-1">
            <PropertiesPanel
              task={task}
              timeZone={timeZone}
              statusColumns={statusColumns}
              onChangeStatus={onChangeStatus}
              onSaveField={saveField}
              onSuggestPriority={onSuggestPriority}
              onSetRecurrence={onSetRecurrence}
              assignees={assignees}
              assignableUsers={assignableUsers}
              onAssignUser={onAssignUser}
              onUnassignUser={onUnassignUser}
              inSeries={inSeries}
              scope={scope}
              onScope={setScope}
              weightDefaults={countsByWeight(project) ? projectWeights(project) : null}
            />
            {/* Apart from the assignees above: the people outside the company responsible for it. */}
            {externalContacts}
            {phone ? null : sideParts}
          </div>
          <div className="min-w-0 lg:col-start-1 lg:row-start-2">
            <NestedChecklists
              lists={checklistLists}
              items={checklistItems}
              actions={listActions}
              people={assignableUsers}
              today={todayKey(timeZone)}
              memoryKey={task.id}
              focusItemId={checklistFocusItemId}
              onSuggest={onSuggestChecklist}
              fromKeys={checklistFromKeys}
            />
          </div>
          <div className="min-w-0 lg:col-start-1 lg:row-start-3">
            <CommentsSection comments={comments} loaded={commentsLoaded} me={me} people={mentionable} onAdd={onAddComment} onEdit={onEditComment} onDelete={onDeleteComment} onReply={onReplyComment} />
          </div>
          {phone ? <div className="flex min-w-0 flex-col gap-5">{sideParts}</div> : null}
          {activity.length > 0 ? (
            <div className="min-w-0 lg:col-start-1 lg:row-start-4">
              <ActivityTimeline activity={activity} fromKeys={activityFromKeys} restorable={checklistRestorable} onRestore={checklistActions?.restore} />
            </div>
          ) : null}
        </div>
      </div>

      {/* Deleting is kept apart from everything else, and always asks first. */}
      {onDelete ? (
        <div data-drawer-footer className="flex-none border-t border-line px-4 py-2.5 sm:px-6">
          {confirmingDelete ? (
            // 1.23.2 (owner): at the right of the bottom bar, where Delete task is.
            <div role="group" aria-label="Confirm delete" className="flex flex-wrap items-center justify-end gap-2">
              {/* On a phone the question takes its own line, so the buttons stay together under it. */}
              <span className="text-right text-sm text-ink max-sm:basis-full">{inSeries ? 'This is a recurring task — delete which?' : 'Delete this task? This can’t be undone.'}</span>
              <button type="button" onClick={() => onDelete()} className="h-9 rounded-lg bg-danger px-3 text-xs font-semibold text-white transition-colors hover:brightness-95 sm:h-8 [@media(pointer:coarse)]:h-11">
                {inSeries ? 'This occurrence' : 'Delete'}
              </button>
              {inSeries ? (
                <button
                  type="button"
                  onClick={() => {
                    if (!seriesDeleteBlocked) onDelete('series');
                  }}
                  aria-disabled={seriesDeleteBlocked ? 'true' : undefined}
                  aria-describedby={seriesDeleteBlocked ? seriesWhyId : undefined}
                  title={seriesDeleteBlocked ?? undefined}
                  className="h-9 rounded-lg bg-danger px-3 text-xs font-semibold text-white transition-colors hover:brightness-95 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:brightness-100 sm:h-8 [@media(pointer:coarse)]:h-11"
                >
                  Entire series
                </button>
              ) : null}
              <button ref={keepRef} type="button" onClick={() => setConfirmingDelete(false)} className="h-9 rounded-lg px-3 text-xs font-medium text-ink-2 transition-colors hover:bg-ground sm:h-8 [@media(pointer:coarse)]:h-11">
                Cancel
              </button>
              {inSeries && seriesDeleteBlocked ? (
                <span id={seriesWhyId} className="basis-full text-right text-xs text-ink-3">
                  {seriesDeleteBlocked}
                </span>
              ) : null}
            </div>
          ) : (
            // 1.23.2 (owner: "keep it on right align"): Delete task at the far right, its reason just before it
            // (wrapping above it, right-aligned, on a narrow panel).
            <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1">
              {deleteBlocked ? (
                <span id={deleteWhyId} className="text-right text-xs text-ink-3">
                  {deleteBlocked}
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  if (!deleteBlocked) setConfirmingDelete(true);
                }}
                title={deleteBlocked ?? deleteHint?.title('Delete task')}
                aria-keyshortcuts={deleteBlocked ? undefined : deleteHint?.aria}
                aria-disabled={deleteBlocked ? 'true' : undefined}
                aria-describedby={deleteBlocked ? deleteWhyId : undefined}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-ink-3 transition-colors hover:bg-danger-soft hover:text-danger aria-disabled:cursor-not-allowed aria-disabled:opacity-60 aria-disabled:hover:bg-transparent aria-disabled:hover:text-ink-3 sm:h-8 [@media(pointer:coarse)]:h-11"
              >
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M6 6v14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V6M10 11v6M14 11v6" />
                </svg>
                Delete task
                {deleteBlocked ? null : <ShortcutHint action="delete" />}
              </button>
            </div>
          )}
        </div>
      ) : null}
      {askStep ? (
        <ConfirmDialog
          title="Discard your changes?"
          confirmLabel="Discard"
          keepLabel="Keep editing"
          onConfirm={() => {
            const go = stepTo(askStep);
            setAskStep(null);
            go?.();
          }}
          onClose={() => setAskStep(null)}
        >
          What you typed in this task hasn’t been saved. It is lost if you open the {askStep === 'next' ? 'next' : 'previous'} task.
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
