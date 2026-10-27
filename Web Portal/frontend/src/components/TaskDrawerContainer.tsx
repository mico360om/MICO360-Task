import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { checklistApi } from '../api/checklist';
import { commentsApi } from '../api/comments';
import { attachmentsApi } from '../api/attachments';
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
import { TaskDrawer, type DrawerTaskRef } from './TaskDrawer';
import { TaskFormDialog } from './task-form/TaskFormDialog';
import { MoveTaskDialog, useMoveTargets } from './MoveTaskDialog';
import { SaveTaskTemplateDialog } from './templates/SaveAsTemplate';
import { projectsApi } from '../api/projects';
import { clientSharesApi } from '../api/client-shares';
import { TaskInspections } from './inspections/TaskInspections';
import { moveAvailability, movedText } from '../lib/task-move';

export interface TaskDrawerContainerProps {
  taskId: string;
  onClose: () => void;
}

/** A readable message for a failed drawer action (the server's own message when it sent one). */
function failureText(e: unknown, fallback: string): string {
  if (e instanceof ApiError) {
    if (e.status === 413) return 'That file is too large to upload.';
    if (e.status === 403) return 'You don’t have permission to do that.';
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

export function TaskDrawerContainer({ taskId, onClose }: TaskDrawerContainerProps) {
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
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);
  const failed = (fallback: string) => (e: unknown) => setActionError(failureText(e, fallback));

  const taskQ = useQuery({ queryKey: ['task', taskId], queryFn: () => tasksApi(apiClient).get(taskId) });
  const checklistQ = useQuery({ queryKey: ['checklist', taskId], queryFn: () => checklistApi(apiClient).list(taskId) });
  const commentsQ = useQuery({ queryKey: ['comments', taskId], queryFn: () => commentsApi(apiClient).list(taskId) });
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
  const projectsQ = useQuery({ queryKey: ['projects'], queryFn: () => projectsApi(apiClient).list() });
  const project = (Array.isArray(projectsQ.data) ? projectsQ.data : []).find((p) => p.id === projectId);
  // Whoever runs the project (its owner, named manager or a manager on its team — the server says)
  // and admins may delete its tasks; an older server that doesn't say: MANAGER members.
  const canDelete = isAdmin || (project?.canManage ?? members.some((m) => m.id === myId && m.role === 'MANAGER'));
  const moveTargets = useMoveTargets(Boolean(projectId));
  const canMove = projectId ? moveAvailability(projectId, moveTargets, project?.name) : null;

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
      patch: { title?: string; description?: string; priority?: Priority; dueDate?: string | null };
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

  const invalidateChecklist = () => {
    queryClient.invalidateQueries({ queryKey: ['checklist', taskId] });
    refreshTaskViews(); // progress + checklist counts on cards
  };
  const removeItemM = useMutation({
    mutationFn: (id: string) => checklistApi(apiClient).remove(id),
    onSuccess: invalidateChecklist,
    onError: failed('Couldn’t remove the checklist item.'),
  });
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
    mutationFn: (body: string) => commentsApi(apiClient).add(taskId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['comments', taskId] });
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
    <div className="above-keyboard fixed inset-0 z-40 flex justify-end bg-ink/40 animate-fade-in" onClick={onClose}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="h-full w-full outline-none animate-slide-in-right sm:max-w-xl md:max-w-2xl lg:max-w-4xl xl:max-w-5xl"
        onClick={(e) => e.stopPropagation()}
      >
        {taskQ.data ? (
          <TaskDrawer
            task={taskQ.data}
            timeZone={timeZone}
            actionError={actionError}
            onDismissError={() => setActionError(null)}
            checklist={checklistQ.data?.items ?? []}
            onToggleChecklistItem={(id, done) =>
              attempt(async () => {
                await checklistApi(apiClient).toggle(id, done);
                invalidateChecklist();
              }, 'Couldn’t update the checklist.')
            }
            onAddChecklistItem={(text) =>
              attempt(async () => {
                await checklistApi(apiClient).add(taskId, text);
                invalidateChecklist();
              }, 'Couldn’t add the checklist item.')
            }
            onRenameChecklistItem={(id, text) =>
              attempt(async () => {
                await checklistApi(apiClient).rename(id, text);
                invalidateChecklist();
              }, 'Couldn’t rename the checklist item.')
            }
            onReorderChecklist={(orderedIds) =>
              attempt(async () => {
                await checklistApi(apiClient).reorder(taskId, orderedIds);
                await queryClient.invalidateQueries({ queryKey: ['checklist', taskId] });
              }, 'Couldn’t reorder the checklist.')
            }
            onRemoveChecklistItem={(id) => removeItemM.mutate(id)}
            onSuggestChecklist={suggestChecklist}
            onSuggestPriority={suggestPriority}
            comments={(commentsQ.data ?? []).map((c) => ({
              id: c.id,
              body: c.body,
              authorName: authorName(c.userId),
              authorAvatar: avatarOf(c.userId),
              createdAt: c.createdAt,
              edited: Boolean(c.editedAt),
              // The server allows the author to edit, and the author or an admin to delete.
              canEdit: c.userId === myId,
              canDelete: c.userId === myId || isAdmin,
            }))}
            onAddComment={(body) => attempt(() => addCommentM.mutateAsync(body), 'Couldn’t post the comment.').then(() => undefined)}
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
            }))}
            onUploadFile={(file, onProgress) => attempt(() => uploadM.mutateAsync({ file, onProgress }), 'Couldn’t upload that file.')}
            onPreviewAttachment={(id) => attachmentsApi(apiClient).preview(id)}
            onDeleteAttachment={(id) => attempt(() => deleteM.mutateAsync(id), 'Couldn’t remove the attachment.').then(() => undefined)}
            dependencies={dependencies}
            availableTasks={[...taskRefs.values()]}
            onAddDependency={(id) => attempt(() => addDepM.mutateAsync(id), 'Couldn’t add the blocker.').then(() => undefined)}
            onRemoveDependency={(id) => attempt(() => removeDepM.mutateAsync(id), 'Couldn’t remove the blocker.').then(() => undefined)}
            onSetRecurrence={(rule) => attempt(() => recurrenceM.mutateAsync(rule), 'Couldn’t save the repeat rule.').then(() => undefined)}
            statusColumns={columns.map((c) => ({ id: c.id, name: c.name, category: c.category }))}
            onChangeStatus={(columnId) => attempt(() => moveM.mutateAsync(columnId), 'Couldn’t change the status.').then(() => undefined)}
            activity={(Array.isArray(activityQ.data) ? activityQ.data : []).map((a) => ({
              id: a.id,
              action: a.action,
              actorName: a.actor?.name ?? authorName(a.userId),
              createdAt: a.createdAt,
              meta: a.meta ?? null,
            }))}
            onSaveEdit={(patch, scope) => attempt(() => editM.mutateAsync({ patch, scope }), 'Couldn’t save your changes.').then(() => undefined)}
            // Only admins and this project's managers may delete — don't offer a button that can't work.
            onDelete={canDelete ? (scope) => deleteTaskM.mutate(scope) : undefined}
            watching={watchStatusQ.data ?? false}
            watcherCount={Array.isArray(watchersQ.data) ? watchersQ.data.length : 0}
            onToggleWatch={() => toggleWatchM.mutate()}
            onExport={async (format) => {
              const blob = await tasksApi(apiClient).exportFile(taskId, format);
              const t = taskQ.data!;
              downloadBlob(fileNameOf(blob) ?? `${t.key}-${fileSlug(t.title)}.${format}`, blob);
            }}
            onEdit={() => setEditing(true)}
            project={project ? { id: project.id, name: project.name, color: project.color, icon: project.icon, imageUrl: project.imageUrl } : undefined}
            onMoveToProject={canMove ? () => setMoving(true) : undefined}
            moveUnavailable={canMove?.reason}
            // Save as template: whoever runs the project (the server checks too).
            onSaveAsTemplate={canDelete ? () => setSavingTemplate(true) : undefined}
            // Show to client: whoever runs the project (the server checks too).
            onSetClientVisible={
              canDelete
                ? async (visible) => {
                    const updated = await clientSharesApi(apiClient).setTaskVisible(taskId, visible);
                    queryClient.setQueryData(['task', taskId], (old: unknown) => (old && typeof old === 'object' ? { ...old, clientVisible: updated.clientVisible ?? visible } : old));
                    refreshTaskViews();
                  }
                : undefined
            }
            inspections={
              projectId ? (
                <TaskInspections
                  taskId={taskId}
                  projectId={projectId}
                  task={{ id: taskId, key: taskQ.data!.key, title: taskQ.data!.title }}
                  canStart={project?.status !== 'ARCHIVED'}
                  form={taskQ.data!.inspectionFormId ? (taskQ.data!.inspectionForm ?? null) : null}
                  place={taskQ.data!.inspectionPlace ?? null}
                />
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
