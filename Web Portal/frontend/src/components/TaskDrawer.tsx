import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ApiTask, Priority, RecurrenceRule } from '../api/tasks';
import { PriorityBadge } from './ui/PriorityBadge';
import { MilestoneIcon } from './TaskCard';
import { ProjectAvatar, type ProjectLook } from './ProjectAvatar';
import { recurrenceSummary } from '../lib/recurrence-summary';
import { statusMeta } from '../lib/taskStatus';
import { isOverdue } from '../lib/due-date';
import { formatDueDay, isTaskDone } from '../lib/due-display';
import { DEFAULT_TIME_ZONE } from '../lib/company-clock';
import { formatMeetingDay } from '../lib/meetingFormat';
import { Icon } from './meeting/kit';
import type { MentionPerson } from '../lib/mentions';
import { InlineDescription, InlineTitle } from './task-drawer/inline-text';
import { PropertiesPanel, type DrawerAssignee, type DrawerStatusColumn, type FieldPatch } from './task-drawer/properties';
import { ChecklistSection, type DrawerChecklistItem } from './task-drawer/checklist';
import { CommentsSection, type DrawerComment } from './task-drawer/comments';
import { ActivityTimeline, type DrawerActivity } from './task-drawer/activity';
import { AttachmentsSection, type DrawerAttachment, type LoadOfficePreview } from './task-drawer/attachments';
import { DependenciesSection, type DrawerDependencies, type DrawerTaskRef } from './task-drawer/dependencies';
import { ExportMenu, MoreActionsMenu, WatchButton } from './task-drawer/menus';
import { ShortcutHint, useShortcut, useShortcutHint } from './shortcuts/ShortcutProvider';

export type { DrawerAssignee, DrawerStatusColumn, DrawerChecklistItem, DrawerComment, DrawerActivity, DrawerAttachment, DrawerDependencies, DrawerTaskRef };

export interface TaskDrawerProps {
  task: ApiTask;
  /** Company time zone: a task is overdue only once its due day is before today there. */
  timeZone?: string;
  /** A failed action (assign, upload, delete, status…) to show at the top of the drawer. */
  actionError?: string | null;
  onDismissError?: () => void;
  checklist: DrawerChecklistItem[];
  comments: DrawerComment[];
  onToggleChecklistItem?: (id: string, done: boolean) => Promise<void> | void;
  onAddChecklistItem?: (text: string) => Promise<void> | void;
  onRenameChecklistItem?: (id: string, text: string) => Promise<void> | void;
  onRemoveChecklistItem?: (id: string) => void;
  /** Save a new order of the checklist (every item id, first to last). */
  onReorderChecklist?: (orderedIds: string[]) => Promise<void> | void;
  /** Ask AI to break the task into steps; the user reviews them before any is added. */
  onSuggestChecklist?: () => Promise<string[] | void>;
  /** Ask AI for a recommended priority + reason; the user applies it or not. */
  onSuggestPriority?: () => Promise<{ priority: Priority; reason: string }>;
  /** Post a comment; rejects with the reason when it could not be posted (the draft is kept). */
  onAddComment?: (body: string) => Promise<void> | void;
  /** Save a comment's new text; rejects with a message to show when it could not be saved. */
  onEditComment?: (id: string, body: string) => Promise<void> | void;
  onDeleteComment?: (id: string) => void;
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
  /** The task's project, named in the header. */
  project?: ProjectLook & { id: string };
  /** Move the task to another project (in “More actions”). */
  onMoveToProject?: () => void;
  /** Why it can't be moved now: the item is shown, unavailable, saying so. */
  moveUnavailable?: string | null;
  onClose: () => void;
}

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
  comments,
  onToggleChecklistItem,
  onAddChecklistItem,
  onRenameChecklistItem,
  onRemoveChecklistItem,
  onReorderChecklist,
  onSuggestChecklist,
  onSuggestPriority,
  onAddComment,
  onEditComment,
  onDeleteComment,
  mentionable = NO_PEOPLE,
  assignees,
  assignableUsers = [],
  onAssignUser,
  onUnassignUser,
  attachments = [],
  onUploadFile,
  onDeleteAttachment,
  onPreviewAttachment,
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
  watching,
  watcherCount,
  onToggleWatch,
  onExport,
  onEdit,
  project,
  onMoveToProject,
  moveUnavailable,
  onClose,
}: TaskDrawerProps) {
  // Escape / focus trapping live in TaskDrawerContainer, so they also work while loading or on errors.
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // E edits the task and Delete asks to delete it, while this panel is open.
  const rootRef = useRef<HTMLDivElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  useShortcut('edit', () => onEdit?.(), { scope: rootRef, enabled: !!onEdit });
  useShortcut('delete', () => setConfirmingDelete(true), { scope: rootRef, enabled: !!onDelete });
  const editHint = useShortcutHint('edit');
  const deleteHint = useShortcutHint('delete');
  // Asked to delete: focus moves to the safe answer, so Enter keeps the task.
  useEffect(() => {
    if (confirmingDelete) keepRef.current?.focus();
  }, [confirmingDelete]);
  // Every copy of a recurring series can be edited or deleted as a series; the newest carries the rule.
  const inSeries = Boolean(task.recurrenceRule || task.recurrenceParentId);
  const [scope, setScope] = useState<'one' | 'series'>('one');
  const saveField = onSaveEdit ? (patch: FieldPatch) => onSaveEdit(patch, inSeries && scope === 'series' ? 'series' : undefined) : undefined;

  // Calendar-day rule in the company zone; a finished task is never overdue.
  const overdue = !isTaskDone(task) && isOverdue(task.dueDate, timeZone);
  const dueText = formatDueDay(task.dueDate, timeZone);
  const carried = task.carryForwardLog && task.carryForwardLog.length > 0 ? task.carryForwardLog : null;

  // One column on a phone; on a wide screen the details, files and links sit beside the work and
  // the discussion. The document order is the phone's order, so reading and Tab follow it everywhere.
  return (
    <div ref={rootRef} data-shortcut-refresh role="dialog" aria-modal="true" aria-label={`Task ${task.key}`} className="keyboard-flow flex h-full w-full flex-col border-s border-line bg-surface shadow-lg">
      {/* A plain div, not <header>: inside a dialog that would be a second page "banner" landmark. */}
      <div data-testid="task-header" className="flex-none border-b border-line px-4 pb-3 pt-3 sm:px-6 sm:pt-4">
        <div className="flex items-center gap-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1.5">
            {project ? (
              <span data-testid="task-project" className="inline-flex min-w-0 max-w-[14rem] items-center gap-1.5 text-xs font-medium text-ink-2">
                <ProjectAvatar project={project} size="xs" />
                <span dir="auto" className="truncate">{project.name}</span>
              </span>
            ) : null}
            <span className="font-mono text-xs font-semibold text-ink-2">{task.key}</span>
            {task.formerKeys && task.formerKeys.length > 0 ? (
              // Its old numbers still find it (search, "open RIG-4").
              <span className="text-xs text-ink-3" title="Its old number still finds it in search">
                Formerly {task.formerKeys.join(', ')}
              </span>
            ) : null}
            <StatusPill category={task.columnCategory} />
            <PriorityBadge priority={task.priority} />
            {task.isMilestone ? (
              <span className="inline-flex items-center gap-1 rounded-md bg-brand/10 px-1.5 py-0.5 text-xs font-semibold text-brand">
                <MilestoneIcon size={12} />
                Milestone
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
          <div className="flex flex-none items-center gap-1.5">
            {onEdit ? (
              <button
                type="button"
                onClick={onEdit}
                aria-label="Edit task"
                title={editHint ? editHint.title('Edit every detail of the task') : 'Edit every detail of the task'}
                aria-keyshortcuts={editHint?.aria}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-2.5 text-sm font-semibold text-ink transition-colors hover:border-brand hover:text-brand"
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
              className={onMoveToProject ? '' : 'sm:hidden'}
            />
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              title="Close (Esc)"
              className="grid h-9 w-9 flex-none place-items-center rounded-lg text-ink-2 transition-colors hover:bg-ground hover:text-ink"
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
              <span className="inline-flex items-center gap-1 rounded-full bg-ground px-2 py-0.5 text-xs font-medium text-ink-2" title={carried.map((e) => `${e.from} → ${e.to}`).join('\n')}>
                ↪ Carried forward {carried.length}× · since {carried[0]!.from}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="keyboard-flow-body flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 sm:py-5">
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

        <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(17rem,20rem)] lg:grid-rows-[auto_auto_auto_auto_1fr] lg:items-start lg:gap-x-8 lg:gap-y-7">
          <section aria-labelledby="task-desc-heading" className="lg:col-start-1 lg:row-start-1">
            <h3 id="task-desc-heading" className="eyebrow mb-1.5">
              Description
            </h3>
            <InlineDescription description={task.description} onSave={saveField ? (description) => saveField({ description }) : undefined} />
          </section>
          {/* The details sit right after the description in reading (and Tab) order — beside the
              work on a wide screen (spanning every row; the last row soaks up any extra height),
              under the description on a phone. */}
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
            />
            <AttachmentsSection attachments={attachments} onUpload={onUploadFile} onDelete={onDeleteAttachment} onPreview={onPreviewAttachment} />
            {dependencies ? (
              <DependenciesSection taskId={task.id} dependencies={dependencies} availableTasks={availableTasks} onAdd={onAddDependency} onRemove={onRemoveDependency} />
            ) : null}
          </div>
          <div className="min-w-0 lg:col-start-1 lg:row-start-2">
            <ChecklistSection
              items={checklist}
              onToggle={onToggleChecklistItem}
              onAdd={onAddChecklistItem}
              onRename={onRenameChecklistItem}
              onRemove={onRemoveChecklistItem}
              onReorder={onReorderChecklist}
              onSuggest={onSuggestChecklist}
            />
          </div>
          <div className="min-w-0 lg:col-start-1 lg:row-start-3">
            <CommentsSection comments={comments} people={mentionable} onAdd={onAddComment} onEdit={onEditComment} onDelete={onDeleteComment} />
          </div>
          {activity.length > 0 ? (
            <div className="min-w-0 lg:col-start-1 lg:row-start-4">
              <ActivityTimeline activity={activity} />
            </div>
          ) : null}
        </div>
      </div>

      {/* Deleting is kept apart from everything else, and always asks first. */}
      {onDelete ? (
        <div data-drawer-footer className="flex-none border-t border-line px-4 py-2.5 sm:px-6">
          {confirmingDelete ? (
            <div role="group" aria-label="Confirm delete" className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-ink">{inSeries ? 'This is a recurring task — delete which?' : 'Delete this task? This can’t be undone.'}</span>
              <button type="button" onClick={() => onDelete()} className="h-9 rounded-lg bg-danger px-3 text-xs font-semibold text-white transition-colors hover:brightness-95 sm:h-8">
                {inSeries ? 'This occurrence' : 'Delete'}
              </button>
              {inSeries ? (
                <button type="button" onClick={() => onDelete('series')} className="h-9 rounded-lg bg-danger px-3 text-xs font-semibold text-white transition-colors hover:brightness-95 sm:h-8">
                  Entire series
                </button>
              ) : null}
              <button ref={keepRef} type="button" onClick={() => setConfirmingDelete(false)} className="h-9 rounded-lg px-3 text-xs font-medium text-ink-2 transition-colors hover:bg-ground sm:h-8">
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              title={deleteHint?.title('Delete task')}
              aria-keyshortcuts={deleteHint?.aria}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-ink-3 transition-colors hover:bg-danger-soft hover:text-danger sm:h-8"
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M6 6v14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V6M10 11v6M14 11v6" />
              </svg>
              Delete task
              <ShortcutHint action="delete" />
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
