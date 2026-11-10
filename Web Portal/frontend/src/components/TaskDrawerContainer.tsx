import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { checklistApi, type ChecklistPlace } from '../api/checklist';
import type { ChecklistAt } from '../lib/checklist-tree';
import { commentsApi, type ApiComment, type CommentReply } from '../api/comments';
import { useTaskCommentsRealtime } from '../lib/useTaskCommentsRealtime';
import { attachmentsApi, type ApiAttachment } from '../api/attachments';
import { dependenciesApi } from '../api/dependencies';
import { assigneesApi } from '../api/assignees';
import { membersApi } from '../api/members';
import { usersApi } from '../api/users';
import { columnsApi } from '../api/columns';
import { activityApi } from '../api/activity';
import { watchersApi } from '../api/watchers';
import { aiApi } from '../api/ai';
import { tasksApi, type Priority, type RecurrenceRule } from '../api/tasks';
import { downloadBlob, fileNameOf, fileSlug } from '../lib/download';
import { ApiError } from '../lib/api-client';
import { invalidateTaskQueries } from '../lib/task-cache';
import { useCompanyTimeZone } from '../lib/company-clock';
import { useDialog } from '../hooks/useDialog';
import { useAuthStore } from '../stores/auth-store';
import { TaskDrawer, type DrawerTaskRef, type TaskStepper } from './TaskDrawer';
import { TaskFormDialog } from './task-form/TaskFormDialog';
import { MoveTaskDialog, useMoveTargets } from './MoveTaskDialog';
import { SaveTaskTemplateDialog } from './templates/SaveAsTemplate';
import { useProjectsWith } from '../lib/useProjectsWith';
import { clientSharesApi } from '../api/client-shares';
import { TaskInspections } from './inspections/TaskInspections';
import { moveAvailability, movedText } from '../lib/task-move';
import { TaskApproval } from './approvals/TaskApproval';
import { TaskExternalContacts } from './task-drawer/TaskExternalContacts';
import { approvalNotice } from '../lib/approvals';
import { DELETE_NOT_ALLOWED, DELETE_NOT_ALLOWED_CODE, DELETE_SERIES_NOT_ALLOWED, mayDeleteSeries, mayDeleteTask } from '../lib/task-delete-rule';
import { isProjectArchived, projectReadOnly } from '../lib/project-archive';
import { taskMergeApi, type MergeResult } from '../api/task-merge';
import { invalidateMergeQueries, mergeAvailability, mergeNoticeText } from '../lib/task-merge';
import { addedToMainText, onMergedWrite } from '../lib/merged-write';
import { todayKey } from '../lib/due-date';
import { MergeTasksDialog } from './MergeTasksDialog';
import { MergedFromPanel } from './task-merge/MergedFromPanel';
import { MergedToast } from './task-merge/MergedToast';
import { UndoMergeDialog } from './task-merge/UndoMergeDialog';

export interface TaskDrawerContainerProps {
  taskId: string;
  onClose: () => void;
  /** 1.23.3: opened at a checklist item (…&item=<id>). */
  focusItemId?: string | null;
  /** Previous / Next through the list the task was opened from (the app shell's panel; 1.22). */
  stepper?: TaskStepper;
}

/** A readable message for a failed drawer action (the server's own message when it sent one). */
function failureText(e: unknown, fallback: string): string {
  if (e instanceof ApiError) {
    if (e.status === 413) return 'That file is too large to upload.';
    // A refusal under the delete rule says why (who may delete it); any other 403, the plain words.
    if (e.status === 403 && e.code !== DELETE_NOT_ALLOWED_CODE) return 'You don’t have permission to do that.';
    if (e.code === 'VERSION_CONFLICT') return 'Someone else changed this task. Reload it and try again.';
    if (e.message) return e.message;
  }
  if (e instanceof Error && !(e instanceof ApiError)) return `${fallback} Check your connection and try again.`;
  return fallback;
}

/** Run an action for the drawer, turning a failure into an Error carrying the message to show. */
async function attempt<T>(action: () => Promise<T>, fallback: string): Promise<T> {
  try {
    return await action();
  } catch (e) {
    throw new Error(failureText(e, fallback));
  }
}

/** "First Last", or the username when someone has no name set. */
const fullName = (u: { firstName: string | null; lastName: string | null; username: string }) =>
  [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username;

/**
 * The task panel for one task. 1.23.1: a merged task's id (an old link, a notice) opens its main task —
 * the server answers with the main task, and the panel shows that one (every read and change by its own
 * id), with a line saying which task was asked for.
 */
export function TaskDrawerContainer(props: TaskDrawerContainerProps) {
  const queryClient = useQueryClient();
  const asked = useQuery({ queryKey: ['task', props.taskId], queryFn: () => tasksApi(apiClient).get(props.taskId) });
  const mainId = asked.data && asked.data.id && asked.data.id !== props.taskId ? asked.data.id : null;
  const timeZone = useCompanyTimeZone();
  const notice = mainId && asked.data?.mergeNotice ? mergeNoticeText(asked.data.mergeNotice, timeZone, todayKey(timeZone)) : null;
  // Something added on a panel opened before its task was merged went to the main task: say where, and
  // show the main task (reading the task again finds it).
  const [added, setAdded] = useState<string | null>(null);
  useEffect(
    () =>
      onMergedWrite((m) => {
        setAdded(addedToMainText(m));
        void invalidateMergeQueries(queryClient);
      }),
    [queryClient],
  );
  useEffect(() => {
    if (!added) return;
    const t = setTimeout(() => setAdded(null), 8000);
    return () => clearTimeout(t);
  }, [added]);
  return (
    <>
      <TaskDrawerPanel key={mainId ?? props.taskId} {...props} taskId={mainId ?? props.taskId} mergeNotice={notice} />
      {added
        ? createPortal(
            <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[70] flex justify-center px-4 sm:bottom-6">
              <p role="status" className="pointer-events-auto flex items-center gap-3 rounded-full border border-line bg-surface px-4 py-2 text-sm font-medium text-ink shadow-lift">
                <span>{added}</span>
                <button type="button" onClick={() => setAdded(null)} aria-label="Dismiss" className="text-ink-2 hover:text-ink [@media(pointer:coarse)]:!min-h-11">
                  ✕
                </button>
              </p>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

/** A place in the checklists as the server takes it (the implicit first "Checklist" has no id yet). */
const placeOf = (at: ChecklistAt): ChecklistPlace => ({ listId: at.listId || undefined, parentId: at.parentId, afterId: at.afterId });

function TaskDrawerPanel({ taskId, onClose, stepper, mergeNotice, focusItemId }: TaskDrawerContainerProps & { mergeNotice: string | null }) {
  const queryClient = useQueryClient();
  const timeZone = useCompanyTimeZone();
  const isAdmin = useAuthStore((s) => s.isAdmin());
  const myId = useAuthStore((s) => s.user?.id);
  // Escape closes, focus moves into the panel and stays there, and returns to the trigger on close —
  // in every state (loading, not found, loaded), so the drawer can always be dismissed.
  const dialogRef = useDialog(onClose, { initialFocus: 'container' });
  const [actionError, setActionError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [moving, setMoving] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  // 1.23.1: the merge dialog, the notice after a merge (with Undo), and the Undo question.
  const [merging, setMerging] = useState(false);
  const [merged, setMerged] = useState<MergeResult | null>(null);
  const [undoing, setUndoing] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);
  const failed = (fallback: string) => (e: unknown) => setActionError(failureText(e, fallback));
  // Stepped to another task (Previous / Next): nothing of the last one's stays open over it.
  const [shownTaskId, setShownTaskId] = useState(taskId);
  if (shownTaskId !== taskId) {
    setShownTaskId(taskId);
    setActionError(null);
    setEditing(false);
    setMoving(false);
    setSavingTemplate(false);
    setToast(null);
    setMerging(false);
    setUndoing(null);
  }

  const taskQ = useQuery({ queryKey: ['task', taskId], queryFn: () => tasksApi(apiClient).get(taskId) });
  const checklistQ = useQuery({ queryKey: ['checklist', taskId], queryFn: () => checklistApi(apiClient).list(taskId) });
  // 1.23.3: deleted items and checklists that can still be restored (Restore in the history). An older
  // server has no such list: nothing to restore, asked once.
  const deletedQ = useQuery({ queryKey: ['checklist-deleted', taskId], queryFn: () => checklistApi(apiClient).deleted(taskId), retry: false });
  const restorable = useMemo(() => new Set((Array.isArray(deletedQ.data) ? deletedQ.data : []).map((b) => b.batchId)), [deletedQ.data]);
  const commentsQ = useQuery({ queryKey: ['comments', taskId], queryFn: () => commentsApi(apiClient).list(taskId) });
  // Comments, newest first (owner, 10 Nov): comments added, changed or deleted by anyone show without reopening —
  // read again through the comments' own checks.
  useTaskCommentsRealtime(taskQ.data?.projectId, taskId, () => void queryClient.invalidateQueries({ queryKey: ['comments', taskId] }));
  const mentionableQ = useQuery({ queryKey: ['mentionable', taskId], queryFn: () => commentsApi(apiClient).mentionable(taskId), staleTime: 60_000 });
  const mentionable = useMemo(
    () => (Array.isArray(mentionableQ.data) ? mentionableQ.data : []).map((p) => ({ id: p.id, username: p.username, name: fullName(p), avatarUrl: p.avatarUrl })),
    [mentionableQ.data],
  );
  const attachmentsQ = useQuery({ queryKey: ['attachments', taskId], queryFn: () => attachmentsApi(apiClient).list(taskId) });
  const dependenciesQ = useQuery({ queryKey: ['dependencies', taskId], queryFn: () => dependenciesApi(apiClient).list(taskId) });
  const projectId = taskQ.data?.projectId;
  const projectTasksQ = useQuery({
    queryKey: ['project-tasks', projectId],
    queryFn: () => tasksApi(apiClient).list(projectId),
    enabled: !!projectId,
  });
  const columnsQ = useQuery({
    queryKey: ['columns', projectId], // same key as the board/composer so one invalidation refreshes every view
    queryFn: () => columnsApi(apiClient).list(projectId as string),
    enabled: !!projectId,
  });
  const columns = Array.isArray(columnsQ.data) ? columnsQ.data : [];
  // The task's project team: who can be assigned (any member may assign — not only admins) and
  // whether I manage the project (managers and admins may delete tasks).
  const membersQ = useQuery({
    queryKey: ['members', projectId],
    queryFn: () => membersApi(apiClient).list(projectId as string),
    enabled: !!projectId,
  });
  const members = Array.isArray(membersQ.data) ? membersQ.data : [];
  // Its project, for the header (the list is cached for every page), and who may move it elsewhere.
  // (1.22: also a project off an administrator's "Show my projects only" list, opened by its link.)
  const project = useProjectsWith(projectId).projects.find((p) => p.id === projectId);
  // Whoever runs the project (its owner, named manager or a manager on its team — the server says)
  // and admins may delete its tasks; an older server that doesn't say: MANAGER members.
  const runsProject = isAdmin || (project?.canManage ?? members.some((m) => m.id === myId && m.role === 'MANAGER'));
  const moveTargets = useMoveTargets(Boolean(projectId));
  const canMove = projectId ? moveAvailability(projectId, moveTargets, project?.name) : null;
  // 1.23.1 Merge tasks: administrators and whoever manages the task's project (the server checks every project).
  const readOnly = project ? projectReadOnly(project) : null;
  const canMerge = projectId ? mergeAvailability(projectId, moveTargets, { readOnly: readOnly ? `${project!.name} is ${readOnly} — reopen it first.` : null }) : null;
  const mergesQ = useQuery({
    queryKey: ['task-merges', taskId],
    queryFn: () => taskMergeApi(apiClient).mergedFrom(taskId),
    enabled: Boolean(taskQ.data?.mergedFrom?.length),
  });
  const labels = taskQ.data?.mergedFrom?.length ? mergesQ.data?.labels : undefined;
  const afterMerge = () => {
    setActionError(null);
    void invalidateMergeQueries(queryClient);
  };

  const activityQ = useQuery({ queryKey: ['task-activity', taskId], queryFn: () => activityApi(apiClient).forTask(taskId) });
  const watchStatusQ = useQuery({ queryKey: ['task-watch', taskId], queryFn: () => watchersApi(apiClient).status(taskId) });
  const watchersQ = useQuery({ queryKey: ['task-watchers', taskId], queryFn: () => watchersApi(apiClient).list(taskId) });

  /** After any change to this task, refresh every view that shows tasks (board, lists, calendar, dashboard…) and its timeline. */
  const refreshTaskViews = () => {
    setActionError(null);
    void queryClient.invalidateQueries({ queryKey: ['task-activity', taskId] });
    void invalidateTaskQueries(queryClient);
  };

  const toggleWatchM = useMutation({
    mutationFn: async () => {
      if (watchStatusQ.data) await watchersApi(apiClient).unwatch(taskId);
      else await watchersApi(apiClient).watch(taskId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['task-watch', taskId] });
      queryClient.invalidateQueries({ queryKey: ['task-watchers', taskId] });
    },
    onError: failed('Couldn’t change watching.'),
  });

  const moveM = useMutation({
    mutationFn: (columnId: string) => tasksApi(apiClient).move(taskId, columnId),
    onSuccess: refreshTaskViews,
  });

  // Task approvals: the tick, Approve and Send back — each from the version on screen.
  const afterApproval = (t: { id: string }) => {
    queryClient.setQueryData(['task', taskId], (old: unknown) => (old && typeof old === 'object' ? { ...old, ...t } : t));
    void queryClient.invalidateQueries({ queryKey: ['comments', taskId] }); // a send-back's reason is a comment
    refreshTaskViews();
  };
  // A refusal (changed meanwhile, approved by someone else) reloads the task, so a retry is from what is there now.
  const reloadTask = () => void queryClient.invalidateQueries({ queryKey: ['task', taskId] });
  const tickM = useMutation({
    mutationFn: (on: boolean) => tasksApi(apiClient).update(taskId, { needsApproval: on, expectedVersion: taskQ.data?.version }),
    onSuccess: afterApproval,
    onError: reloadTask,
  });
  const approveM = useMutation({ mutationFn: () => tasksApi(apiClient).approve(taskId, taskQ.data?.version), onSuccess: afterApproval, onError: reloadTask });
  const sendBackM = useMutation({ mutationFn: (reason: string) => tasksApi(apiClient).sendBack(taskId, reason, taskQ.data?.version), onSuccess: afterApproval, onError: reloadTask });

  const invalidateAttachments = () => {
    queryClient.invalidateQueries({ queryKey: ['attachments', taskId] });
    refreshTaskViews(); // card attachment counts
  };
  const uploadM = useMutation({
    mutationFn: ({ file, onProgress }: { file: File; onProgress?: (fraction: number) => void }) => attachmentsApi(apiClient).upload(taskId, file, onProgress),
    onSuccess: invalidateAttachments,
  });
  const deleteM = useMutation({
    mutationFn: (id: string) => attachmentsApi(apiClient).remove(id),
    onSuccess: invalidateAttachments,
  });

  const invalidateDeps = () => {
    void queryClient.invalidateQueries({ queryKey: ['dependencies', taskId] });
    void queryClient.invalidateQueries({ queryKey: ['task-activity', taskId] }); // the timeline names the blocker
  };
  const addDepM = useMutation({
    mutationFn: (dependsOnTaskId: string) => dependenciesApi(apiClient).add(taskId, dependsOnTaskId),
    onSuccess: invalidateDeps,
  });
  const removeDepM = useMutation({
    mutationFn: (dependsOnTaskId: string) => dependenciesApi(apiClient).remove(taskId, dependsOnTaskId),
    onSuccess: invalidateDeps,
  });

  const recurrenceM = useMutation({
    mutationFn: (rule: RecurrenceRule | null) => tasksApi(apiClient).update(taskId, { recurrenceRule: rule }),
    onSuccess: refreshTaskViews,
  });

  // Inline edits are awaited by the drawer, which shows "Saving… / Saved" or the server's reason.
  const editM = useMutation({
    mutationFn: (input: {
      patch: { title?: string; description?: string; priority?: Priority; dueDate?: string | null; weight?: number | null };
      scope?: 'series';
    }) => tasksApi(apiClient).update(taskId, { ...input.patch, ...(input.scope ? { scope: input.scope } : {}) }),
    onSuccess: refreshTaskViews,
  });

  const deleteTaskM = useMutation({
    mutationFn: (scope?: 'series') => tasksApi(apiClient).remove(taskId, scope),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ['task', taskId] });
      refreshTaskViews();
      onClose();
    },
    onError: failed('Couldn’t delete the task.'),
  });

  /** Every view of the checklist refreshed; done once the checklist itself has been read again. */
  const invalidateChecklist = () => {
    void queryClient.invalidateQueries({ queryKey: ['checklist-deleted', taskId] });
    refreshTaskViews(); // progress + checklist counts on cards, My Tasks' items for me, the calendar, the history
    return queryClient.invalidateQueries({ queryKey: ['checklist', taskId] });
  };
  /**
   * A checklist change saved, then every view of it refreshed; a refusal carries the server's words.
   * It answers once the checklist has been read again (1.23.3 review), so what comes next — typing on
   * after a new item, its sub-item box — has its place on screen.
   */
  const saveChecklist = <T,>(action: () => Promise<T>, fallback: string) =>
    attempt(async () => {
      const result = await action();
      await invalidateChecklist();
      return result;
    }, fallback);
  const cl = checklistApi(apiClient);
  const editCommentM = useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) => commentsApi(apiClient).update(id, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['comments', taskId] }),
  });
  const deleteCommentM = useMutation({
    mutationFn: (id: string) => commentsApi(apiClient).remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['comments', taskId] });
      refreshTaskViews(); // comment counts
    },
    onError: failed('Couldn’t delete the comment.'),
  });
  const addCommentM = useMutation({
    // A reply carries the comment it answers (and, in a client's thread, "Visible to client" when ticked).
    mutationFn: ({ body, reply }: { body: string; reply?: CommentReply }) => commentsApi(apiClient).add(taskId, body, reply),
    onSuccess: (saved) => {
      // The saved comment shows at once (a comment on its way meets it here), then the list is read again.
      if (saved && typeof saved === 'object' && saved.id && saved.taskId === taskId) {
        queryClient.setQueryData<ApiComment[]>(['comments', taskId], (old) => (Array.isArray(old) && !old.some((c) => c.id === saved.id) ? [...old, saved] : old));
      }
      void queryClient.invalidateQueries({ queryKey: ['comments', taskId] });
      refreshTaskViews(); // comment counts
    },
  });

  // AI: break the task into steps — returned for the user to review; nothing is added here.
  const suggestChecklist = async () => {
    const t = taskQ.data;
    if (!t) return [];
    return attempt(() => aiApi(apiClient).breakdown(t.title, t.description ?? undefined), 'The AI suggestion failed.');
  };
  // AI: recommend a priority for the task (the drawer shows it for the user to apply).
  const suggestPriority = async () => {
    const t = taskQ.data!;
    return attempt(() => aiApi(apiClient).suggestPriority(t.title, t.description ?? undefined, t.dueDate ?? null), 'The AI suggestion failed.');
  };

  const assigneesQ = useQuery({ queryKey: ['assignees', taskId], queryFn: () => assigneesApi(apiClient).list(taskId) });
  // Which of them may delete this task: its creator, or the one person it's assigned to (and its
  // entire series, its creator). The server says; one that doesn't: the same rule, worked out here.
  const facts = { viewerId: myId ?? '', mayManage: runsProject, createdById: taskQ.data?.createdById ?? '' };
  const canDeleteTask = taskQ.data?.canDelete ?? mayDeleteTask({ ...facts, assigneeIds: (assigneesQ.data ?? []).map((a) => a.id) });
  const canDeleteSeries = taskQ.data?.canDeleteSeries ?? mayDeleteSeries({ ...facts, seriesCreatorId: facts.createdById });
  // Directory (non-admin accessible, with names + avatars) to attribute comment authors.
  const directoryQ = useQuery({ queryKey: ['directory'], queryFn: () => usersApi(apiClient).directory() });
  const directory = Array.isArray(directoryQ.data) ? directoryQ.data : [];
  const authorName = (userId: string) => {
    const u = directory.find((d) => d.id === userId);
    return u ? `${u.firstName} ${u.lastName}`.trim() || u.username : 'Unknown';
  };
  const avatarOf = (userId: string) => directory.find((d) => d.id === userId)?.avatarUrl ?? null;
  const invalidateAssignees = () => {
    queryClient.invalidateQueries({ queryKey: ['assignees', taskId] });
    refreshTaskViews(); // card avatars, My Tasks, calendar filters
  };
  const assignM = useMutation({
    mutationFn: (userId: string) => assigneesApi(apiClient).assign(taskId, userId),
    onSuccess: invalidateAssignees,
  });
  const unassignM = useMutation({
    mutationFn: (userId: string) => assigneesApi(apiClient).unassign(taskId, userId),
    onSuccess: invalidateAssignees,
  });

  // Linked tasks with their current status, from the project's tasks and columns.
  const columnById = new Map(columns.map((c) => [c.id, c]));
  const taskRefs = new Map<string, DrawerTaskRef>(
    (projectTasksQ.data ?? []).map((t) => {
      const col = columnById.get(t.columnId);
      return [t.id, { id: t.id, key: t.key, title: t.title, statusName: col?.name, statusCategory: col?.category, done: col ? col.category === 'DONE' : Boolean(t.completedAt) }];
    }),
  );
  // A linked task in another project (a blocker stays linked when either task moves) is read on its own.
  const elsewhere = dependenciesQ.data ? [...dependenciesQ.data.blockedBy, ...dependenciesQ.data.blocks].filter((id) => projectTasksQ.isSuccess && !taskRefs.has(id)) : [];
  const elsewhereQs = useQueries({
    queries: [...new Set(elsewhere)].map((id) => ({ queryKey: ['task', id], queryFn: () => tasksApi(apiClient).get(id), staleTime: 30_000 })),
  });
  for (const q of elsewhereQs) {
    const t = q.data;
    if (t && !taskRefs.has(t.id)) {
      taskRefs.set(t.id, { id: t.id, key: t.key, title: t.title, statusCategory: t.columnCategory ?? undefined, done: t.columnCategory === 'DONE' || Boolean(t.completedAt) });
    }
  }
  const toRef = (id: string): DrawerTaskRef => taskRefs.get(id) ?? { id, key: id, title: id };
  const dependencies = dependenciesQ.data
    ? { blockedBy: dependenciesQ.data.blockedBy.map(toRef), blocks: dependenciesQ.data.blocks.map(toRef) }
    : undefined;

  const closeButton = (
    <button onClick={onClose} className="self-start rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-ground">
      Close
    </button>
  );

  // Portalled to <body> so the overlay's `position: fixed` is viewport-relative — never confined to
  // a transformed ancestor (the page-transition wrapper), which would offset/clip the drawer.
  return createPortal(
    <div className="above-keyboard fixed inset-0 z-40 flex justify-end bg-scrim animate-fade-in" onClick={onClose}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="h-full w-full outline-none animate-slide-in-right sm:max-w-xl md:max-w-2xl lg:max-w-4xl xl:max-w-5xl"
        onClick={(e) => e.stopPropagation()}
      >
        {taskQ.data ? (
          <TaskDrawer
            // A task of its own each step: the last one's drafts and questions don't carry over.
            key={taskQ.data.id}
            task={taskQ.data}
            stepper={stepper}
            timeZone={timeZone}
            actionError={actionError}
            onDismissError={() => setActionError(null)}
            checklist={checklistQ.data?.items ?? []}
            checklistLists={checklistQ.data?.lists ?? []}
            onToggleChecklistItem={(id, done) => saveChecklist(() => cl.toggle(id, done), 'Couldn’t update the checklist.').then(() => undefined)}
            onAddChecklistItem={(text, at) => saveChecklist(() => cl.add(taskId, text, placeOf(at)), 'Couldn’t add the checklist item.').then((item) => item.id)}
            onRenameChecklistItem={(id, text) => saveChecklist(() => cl.rename(id, text), 'Couldn’t rename the checklist item.').then(() => undefined)}
            onRemoveChecklistItem={(id) => saveChecklist(() => cl.remove(id), 'Couldn’t delete the checklist item.')}
            checklistActions={{
              addItems: (at, texts) => saveChecklist(() => cl.addMany(taskId, texts, placeOf(at)), 'Couldn’t add the items.').then((r) => (Array.isArray(r?.items) ? r.items.map((i) => i.id) : undefined)),
              duplicate: (id) => saveChecklist(() => cl.duplicate(id), 'Couldn’t duplicate the item.').then(() => undefined),
              move: (id, how) => saveChecklist(() => cl.move(id, how), 'Couldn’t move the item.').then(() => undefined),
              assign: (id, userId) => saveChecklist(() => cl.assign(id, userId), 'Couldn’t change who it’s for.').then(() => undefined),
              setDue: (id, day) => saveChecklist(() => cl.setDue(id, day), 'Couldn’t save the due date.').then(() => undefined),
              addList: (title, afterId) => saveChecklist(() => cl.addList(taskId, title, afterId), 'Couldn’t add the checklist.').then((list) => list.id),
              renameList: (id, title) => saveChecklist(() => cl.renameList(id, title), 'Couldn’t rename the checklist.').then(() => undefined),
              duplicateList: (id) => saveChecklist(() => cl.duplicateList(id), 'Couldn’t duplicate the checklist.').then(() => undefined),
              removeList: (id) => saveChecklist(() => cl.removeList(id), 'Couldn’t delete the checklist.'),
              restore: (batchId) => saveChecklist(() => cl.restore(taskId, batchId), 'Couldn’t restore it.').then(() => undefined),
            }}
            checklistFocusItemId={focusItemId}
            checklistRestorable={restorable}
            onSuggestChecklist={suggestChecklist}
            onSuggestPriority={suggestPriority}
            commentsLoaded={commentsQ.isSuccess}
            me={myId ? { name: authorName(myId), avatarUrl: avatarOf(myId) } : undefined}
            comments={(Array.isArray(commentsQ.data) ? commentsQ.data : []).map((c) => ({
              id: c.id,
              body: c.body,
              // 1.23: a client's comment names its writer itself (clients aren't in the directory).
              authorName: c.fromClient ? c.clientAuthor?.name || 'Client' : authorName(c.userId),
              // A reply to their reply starts "@username" (clients can't be mentioned).
              authorUsername: c.fromClient ? null : (directory.find((d) => d.id === c.userId)?.username ?? null),
              mine: !c.fromClient && c.userId === myId,
              authorAvatar: c.fromClient ? null : avatarOf(c.userId),
              createdAt: c.createdAt,
              edited: Boolean(c.editedAt),
              parentId: c.parentId ?? null,
              fromClient: c.fromClient === true,
              organisation: c.fromClient ? (c.clientAuthor?.organisation ?? null) : null,
              clientVisible: c.clientVisible === true,
              fromKey: labels?.comments[c.id] ?? null,
              // The server allows the author to edit, and the author or an admin to delete.
              canEdit: c.userId === myId,
              canDelete: c.userId === myId || isAdmin,
            }))}
            onAddComment={(body) => attempt(() => addCommentM.mutateAsync({ body }), 'Couldn’t post the comment.').then((saved) => saved?.id)}
            onReplyComment={(parentId, body, clientVisible) =>
              attempt(() => addCommentM.mutateAsync({ body, reply: { parentId, clientVisible } }), 'Couldn’t send the reply.').then(() => undefined)
            }
            onEditComment={(id, body) => attempt(() => editCommentM.mutateAsync({ id, body }), 'Couldn’t save the comment.').then(() => undefined)}
            onDeleteComment={(id) => deleteCommentM.mutate(id)}
            mentionable={mentionable}
            assignees={(assigneesQ.data ?? []).map((a) => ({ id: a.id, name: fullName(a), avatarUrl: avatarOf(a.id) }))}
            assignableUsers={members.map((u) => ({ id: u.id, name: fullName(u), avatarUrl: avatarOf(u.id) }))}
            onAssignUser={(userId) => attempt(() => assignM.mutateAsync(userId), 'Couldn’t assign that person.').then(() => undefined)}
            onUnassignUser={(userId) => attempt(() => unassignM.mutateAsync(userId), 'Couldn’t remove that assignee.').then(() => undefined)}
            attachments={(attachmentsQ.data ?? []).map((a) => ({
              id: a.id,
              filename: a.filename,
              url: a.url,
              sizeBytes: a.sizeBytes,
              mimeType: a.mimeType,
              // The server lets the uploader, or an admin, delete a file.
              canDelete: a.uploadedById === myId || isAdmin,
              // 1.23.7: a client's file, and whether the project's clients see it.
              fromClient: a.fromClient === true,
              clientVisible: a.clientVisible === true,
            }))}
            // 1.23.7 "Show to client" on a file: the same people as the task's own switch (the server checks too).
            onSetAttachmentClientVisible={
              runsProject
                ? async (attachmentId, visible) => {
                    try {
                      const updated = await attachmentsApi(apiClient).setClientVisible(taskId, attachmentId, visible);
                      queryClient.setQueryData<ApiAttachment[]>(['attachments', taskId], (old) =>
                        Array.isArray(old) ? old.map((a) => (a.id === attachmentId ? { ...a, ...updated, clientVisible: updated?.clientVisible ?? visible } : a)) : old,
                      );
                    } catch (e) {
                      // A refusal says why in the server's words (who may; an archived project).
                      const said = e instanceof ApiError && e.status === 403 && !/^Request failed/.test(e.message) ? e.message : '';
                      throw new Error(said || failureText(e, 'Couldn’t change who sees the file.'));
                    }
                  }
                : undefined
            }
            onUploadFile={(file, onProgress) => attempt(() => uploadM.mutateAsync({ file, onProgress }), 'Couldn’t upload that file.')}
            onPreviewAttachment={(id) => attachmentsApi(apiClient).preview(id)}
            onDeleteAttachment={(id) => attempt(() => deleteM.mutateAsync(id), 'Couldn’t remove the attachment.').then(() => undefined)}
            dependencies={dependencies}
            availableTasks={[...taskRefs.values()]}
            onAddDependency={(id) => attempt(() => addDepM.mutateAsync(id), 'Couldn’t add the blocker.').then(() => undefined)}
            onRemoveDependency={(id) => attempt(() => removeDepM.mutateAsync(id), 'Couldn’t remove the blocker.').then(() => undefined)}
            onSetRecurrence={(rule) => attempt(() => recurrenceM.mutateAsync(rule), 'Couldn’t save the repeat rule.').then(() => undefined)}
            statusColumns={columns.map((c) => ({ id: c.id, name: c.name, category: c.category }))}
            onChangeStatus={(columnId) =>
              attempt(() => moveM.mutateAsync(columnId), 'Couldn’t change the status.').then((t) => {
                // A task that needs approval, finished by someone who can't approve, waits instead.
                const notice = approvalNotice(columnId, t);
                if (notice) setToast(notice);
              })
            }
            activity={(Array.isArray(activityQ.data) ? activityQ.data : []).map((a) => ({
              id: a.id,
              action: a.action,
              actorName: a.actor?.name ?? authorName(a.userId),
              createdAt: a.createdAt,
              meta: a.meta ?? null,
            }))}
            onSaveEdit={(patch, scope) => attempt(() => editM.mutateAsync({ patch, scope }), 'Couldn’t save your changes.').then(() => undefined)}
            // Only admins and this project's managers may delete tasks at all — the others get no button.
            // Of those, someone else's task (not theirs alone) shows it greyed out, saying why.
            onDelete={runsProject ? (scope) => deleteTaskM.mutate(scope) : undefined}
            deleteBlocked={runsProject && !canDeleteTask ? DELETE_NOT_ALLOWED : null}
            seriesDeleteBlocked={runsProject && !canDeleteSeries ? DELETE_SERIES_NOT_ALLOWED : null}
            watching={watchStatusQ.data ?? false}
            watcherCount={Array.isArray(watchersQ.data) ? watchersQ.data.length : 0}
            onToggleWatch={() => toggleWatchM.mutate()}
            onExport={async (format) => {
              const blob = await tasksApi(apiClient).exportFile(taskId, format);
              const t = taskQ.data!;
              downloadBlob(fileNameOf(blob) ?? `${t.key}-${fileSlug(t.title)}.${format}`, blob);
            }}
            onEdit={() => setEditing(true)}
            project={
              project
                ? {
                    id: project.id,
                    name: project.name,
                    color: project.color,
                    icon: project.icon,
                    imageUrl: project.imageUrl,
                    // 1.23.5: the Weight field shows for a project counting by weight.
                    completionMode: project.completionMode,
                    weightUrgent: project.weightUrgent,
                    weightHigh: project.weightHigh,
                    weightNormal: project.weightNormal,
                    weightLow: project.weightLow,
                  }
                : undefined
            }
            onMoveToProject={canMove ? () => setMoving(true) : undefined}
            moveUnavailable={canMove?.reason}
            // Save as template: whoever runs the project (the server checks too).
            onSaveAsTemplate={runsProject ? () => setSavingTemplate(true) : undefined}
            // Show to client: whoever runs the project (the server checks too).
            onSetClientVisible={
              runsProject
                ? async (visible) => {
                    const updated = await clientSharesApi(apiClient).setTaskVisible(taskId, visible);
                    // Hidden: its description is off too (the server says; an older one doesn't).
                    queryClient.setQueryData(['task', taskId], (old: unknown) =>
                      old && typeof old === 'object' ? { ...old, clientVisible: updated.clientVisible ?? visible, clientShowDescription: updated.clientShowDescription ?? (visible ? (old as { clientShowDescription?: boolean }).clientShowDescription : false) } : old,
                    );
                    refreshTaskViews();
                  }
                : undefined
            }
            // 1.23: "Also show its description" — only while it is shown (the server checks too).
            onSetClientDescription={
              runsProject
                ? (show) =>
                    attempt(async () => {
                      const updated = await clientSharesApi(apiClient).setTaskVisible(taskId, true, show);
                      queryClient.setQueryData(['task', taskId], (old: unknown) => (old && typeof old === 'object' ? { ...old, clientVisible: updated.clientVisible ?? true, clientShowDescription: updated.clientShowDescription ?? show } : old));
                      refreshTaskViews();
                    }, 'Couldn’t change it.')
                : undefined
            }
            approval={
              <TaskApproval
                task={taskQ.data!}
                onSetNeedsApproval={(on) => attempt(() => tickM.mutateAsync(on), 'Couldn’t change “Needs approval”.').then(() => undefined)}
                onApprove={() => attempt(() => approveM.mutateAsync(), 'Couldn’t approve it.').then(() => undefined)}
                onSendBack={(reason) => attempt(() => sendBackM.mutateAsync(reason), 'Couldn’t send it back.').then(() => undefined)}
              />
            }
            externalContacts={
              // Older servers don't send them: no section then.
              projectId && taskQ.data.externalContacts ? <TaskExternalContacts taskId={taskId} projectId={projectId} contacts={taskQ.data.externalContacts} /> : undefined
            }
            inspections={
              projectId ? (
                <TaskInspections
                  taskId={taskId}
                  projectId={projectId}
                  task={{ id: taskId, key: taskQ.data!.key, title: taskQ.data!.title }}
                  canStart={!project || !isProjectArchived(project)}
                  form={taskQ.data!.inspectionFormId ? (taskQ.data!.inspectionForm ?? null) : null}
                  place={taskQ.data!.inspectionPlace ?? null}
                />
              ) : undefined
            }
            onMerge={canMerge?.show ? () => setMerging(true) : undefined}
            mergeUnavailable={canMerge?.reason}
            mergeNotice={mergeNotice}
            checklistFromKeys={labels?.checklist}
            activityFromKeys={labels?.activity}
            mergedFrom={
              mergesQ.data && mergesQ.data.merges.length > 0 ? (
                <MergedFromPanel panel={mergesQ.data} timeZone={timeZone} today={todayKey(timeZone)} onUndo={(mergeId) => setUndoing(mergeId)} />
              ) : undefined
            }
            onClose={onClose}
          />
        ) : taskQ.isError ? (
          <div role="dialog" aria-modal="true" aria-label="Task not available" className="flex h-full w-full flex-col gap-3 border-l border-line bg-surface p-5">
            <p role="alert" className="text-sm text-ink">
              {taskQ.error instanceof ApiError && (taskQ.error.status === 404 || taskQ.error.status === 403)
                ? 'Task not found, or you don’t have access to it. It may have been deleted.'
                : 'Couldn’t load this task.'}
            </p>
            <div className="flex gap-2">
              {closeButton}
              {!(taskQ.error instanceof ApiError && (taskQ.error.status === 404 || taskQ.error.status === 403)) ? (
                <button onClick={() => void taskQ.refetch()} className="rounded-lg px-3 py-1.5 text-sm font-medium text-brand hover:bg-ground">
                  Retry
                </button>
              ) : null}
            </div>
          </div>
        ) : (
          <div role="dialog" aria-modal="true" aria-label="Loading task" aria-busy="true" className="flex h-full w-full flex-col gap-3 border-l border-line bg-surface p-5 text-ink-2">
            <p role="status">Loading…</p>
            {closeButton}
          </div>
        )}
      </div>
      {editing && taskQ.data ? (
        // Its own layer above the panel; clicks inside it must not reach the panel's backdrop.
        <div onClick={(e) => e.stopPropagation()}>
          <TaskFormDialog task={taskQ.data} onClose={() => setEditing(false)} onSaved={() => setActionError(null)} />
        </div>
      ) : null}
      {moving && taskQ.data ? (
        <div onClick={(e) => e.stopPropagation()}>
          <MoveTaskDialog
            tasks={[{ id: taskQ.data.id, key: taskQ.data.key, title: taskQ.data.title, projectId: taskQ.data.projectId }]}
            onClose={() => setMoving(false)}
            onMoved={(result) => {
              setMoving(false);
              setToast(movedText(result));
              // The same task, now in another project: show it as it is, and refresh every view.
              queryClient.setQueryData(['task', taskId], (old: unknown) => (old && typeof old === 'object' ? { ...old, ...result.task } : result.task));
              refreshTaskViews();
            }}
          />
        </div>
      ) : null}
      {merging && taskQ.data ? (
        <div onClick={(e) => e.stopPropagation()}>
          <MergeTasksDialog
            onTop
            tasks={[{ id: taskQ.data.id, key: taskQ.data.key, title: taskQ.data.title, projectId: taskQ.data.projectId }]}
            onClose={() => setMerging(false)}
            onMerged={(result) => {
              setMerging(false);
              setMerged(result);
              // This task is the main one, or now part of it (the panel then shows the main task).
              afterMerge();
            }}
          />
        </div>
      ) : null}
      {undoing ? (
        <div onClick={(e) => e.stopPropagation()}>
          <UndoMergeDialog
            mergeId={undoing}
            onClose={() => setUndoing(null)}
            onUndone={(result) => {
              setUndoing(null);
              setMerged(null);
              setToast(result.text);
              afterMerge();
            }}
          />
        </div>
      ) : null}
      {merged ? <MergedToast text={merged.text} onUndo={() => setUndoing(merged.mergeId)} onDismiss={() => setMerged(null)} /> : null}
      {savingTemplate && taskQ.data ? (
        <div onClick={(e) => e.stopPropagation()}>
          <SaveTaskTemplateDialog taskId={taskQ.data.id} taskTitle={taskQ.data.title} checklistCount={checklistQ.data?.items?.length} hasDescription={!!taskQ.data.description?.trim()} onClose={() => setSavingTemplate(false)} />
        </div>
      ) : null}
      {toast ? (
        // Above the panel, so it is seen while the task stays open.
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4" onClick={(e) => e.stopPropagation()}>
          <p role="status" className="pointer-events-auto flex items-center gap-3 rounded-full border border-line bg-surface px-4 py-2 text-sm font-medium text-ink shadow-lift">
            <span>{toast}</span>
            <button type="button" onClick={() => setToast(null)} aria-label="Dismiss" className="text-ink-2 hover:text-ink">
              ✕
            </button>
          </p>
        </div>
      ) : null}
    </div>,
    document.body,
  );
}
