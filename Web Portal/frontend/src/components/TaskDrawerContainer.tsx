import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
import { ApiError } from '../lib/api-client';
import { invalidateTaskQueries } from '../lib/task-cache';
import { useCompanyTimeZone } from '../lib/company-clock';
import { useDialog } from '../hooks/useDialog';
import { useAuthStore } from '../stores/auth-store';
import { TaskDrawer, type DrawerTaskRef } from './TaskDrawer';

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

export function TaskDrawerContainer({ taskId, onClose }: TaskDrawerContainerProps) {
  const queryClient = useQueryClient();
  const timeZone = useCompanyTimeZone();
  const isAdmin = useAuthStore((s) => s.isAdmin());
  const myId = useAuthStore((s) => s.user?.id);
  // Escape closes, focus moves into the panel and stays there, and returns to the trigger on close —
  // in every state (loading, not found, loaded), so the drawer can always be dismissed.
  const dialogRef = useDialog(onClose, { initialFocus: 'container' });
  const [actionError, setActionError] = useState<string | null>(null);
  const failed = (fallback: string) => (e: unknown) => setActionError(failureText(e, fallback));

  const taskQ = useQuery({ queryKey: ['task', taskId], queryFn: () => tasksApi(apiClient).get(taskId) });
  const checklistQ = useQuery({ queryKey: ['checklist', taskId], queryFn: () => checklistApi(apiClient).list(taskId) });
  const commentsQ = useQuery({ queryKey: ['comments', taskId], queryFn: () => commentsApi(apiClient).list(taskId) });
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
  // The task's project team: who can be assigned (any member may assign — not only admins) and
  // whether I manage the project (managers and admins may delete tasks).
  const membersQ = useQuery({
    queryKey: ['members', projectId],
    queryFn: () => membersApi(apiClient).list(projectId as string),
    enabled: !!projectId,
  });
  const members = Array.isArray(membersQ.data) ? membersQ.data : [];
  const canDelete = isAdmin || members.some((m) => m.id === myId && m.role === 'MANAGER');

  const activityQ = useQuery({ queryKey: ['task-activity', taskId], queryFn: () => activityApi(apiClient).forTask(taskId) });
  const watchStatusQ = useQuery({ queryKey: ['task-watch', taskId], queryFn: () => watchersApi(apiClient).status(taskId) });
  const watchersQ = useQuery({ queryKey: ['task-watchers', taskId], queryFn: () => watchersApi(apiClient).list(taskId) });

  /** After any change to this task, refresh every view that shows tasks (board, lists, calendar, dashboard…). */
  const refreshTaskViews = () => {
    setActionError(null);
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
    onError: failed('Couldn’t change the status.'),
  });

  const invalidateAttachments = () => {
    queryClient.invalidateQueries({ queryKey: ['attachments', taskId] });
    refreshTaskViews(); // card attachment counts
  };
  const uploadM = useMutation({
    mutationFn: (file: File) => attachmentsApi(apiClient).upload(taskId, file),
    onSuccess: invalidateAttachments,
    onError: failed('Couldn’t upload that file.'),
  });
  const deleteM = useMutation({
    mutationFn: (id: string) => attachmentsApi(apiClient).remove(id),
    onSuccess: invalidateAttachments,
    onError: failed('Couldn’t remove the attachment.'),
  });

  const invalidateDeps = () => queryClient.invalidateQueries({ queryKey: ['dependencies', taskId] });
  const addDepM = useMutation({
    mutationFn: (dependsOnTaskId: string) => dependenciesApi(apiClient).add(taskId, dependsOnTaskId),
    onSuccess: invalidateDeps,
    onError: failed('Couldn’t add the blocker.'),
  });
  const removeDepM = useMutation({
    mutationFn: (dependsOnTaskId: string) => dependenciesApi(apiClient).remove(taskId, dependsOnTaskId),
    onSuccess: invalidateDeps,
    onError: failed('Couldn’t remove the blocker.'),
  });

  const recurrenceM = useMutation({
    mutationFn: (rule: RecurrenceRule | null) => tasksApi(apiClient).update(taskId, { recurrenceRule: rule }),
    onSuccess: refreshTaskViews,
    onError: failed('Couldn’t save the repeat rule.'),
  });

  // Edits are awaited by the drawer: the form closes only once the save succeeded and shows the
  // server's reason inline when it didn't (the user's edits stay in the form).
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
  const toggleItemM = useMutation({
    mutationFn: ({ id, done }: { id: string; done: boolean }) => checklistApi(apiClient).toggle(id, done),
    onSuccess: invalidateChecklist,
    onError: failed('Couldn’t update the checklist.'),
  });
  const addItemM = useMutation({
    mutationFn: (text: string) => checklistApi(apiClient).add(taskId, text),
    onSuccess: invalidateChecklist,
    onError: failed('Couldn’t add the checklist item.'),
  });

  const addCommentM = useMutation({
    mutationFn: (body: string) => commentsApi(apiClient).add(taskId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['comments', taskId] });
      refreshTaskViews(); // comment counts
    },
    onError: failed('Couldn’t post the comment.'),
  });

  // AI: break the task into checklist steps, then add each one and refresh the checklist.
  const suggestChecklist = async () => {
    const t = taskQ.data;
    if (!t) return;
    const steps = await aiApi(apiClient).breakdown(t.title, t.description ?? undefined);
    for (const step of steps) await checklistApi(apiClient).add(taskId, step);
    await queryClient.invalidateQueries({ queryKey: ['checklist', taskId] });
  };
  // AI: recommend a priority for the task (the drawer applies it into its edit form).
  const suggestPriority = async () => {
    const t = taskQ.data!;
    return aiApi(apiClient).suggestPriority(t.title, t.description ?? undefined, t.dueDate ?? null);
  };

  const assigneesQ = useQuery({ queryKey: ['assignees', taskId], queryFn: () => assigneesApi(apiClient).list(taskId) });
  // Directory (non-admin accessible, with names + avatars) to attribute comment authors.
  const directoryQ = useQuery({ queryKey: ['directory'], queryFn: () => usersApi(apiClient).directory() });
  const directory = Array.isArray(directoryQ.data) ? directoryQ.data : [];
  const authorName = (userId: string) => {
    const u = directory.find((d) => d.id === userId);
    return u ? `${u.firstName} ${u.lastName}`.trim() || u.username : 'Unknown';
  };
  const authorAvatar = (userId: string) => directory.find((d) => d.id === userId)?.avatarUrl ?? null;
  const invalidateAssignees = () => {
    queryClient.invalidateQueries({ queryKey: ['assignees', taskId] });
    refreshTaskViews(); // card avatars, My Tasks, calendar filters
  };
  const assignM = useMutation({
    mutationFn: (userId: string) => assigneesApi(apiClient).assign(taskId, userId),
    onSuccess: invalidateAssignees,
    onError: failed('Couldn’t assign that person.'),
  });
  const unassignM = useMutation({
    mutationFn: (userId: string) => assigneesApi(apiClient).unassign(taskId, userId),
    onSuccess: invalidateAssignees,
    onError: failed('Couldn’t remove that assignee.'),
  });
  const fullName = (u: { firstName: string; lastName: string; username: string }) =>
    [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username;

  const taskRefs = new Map<string, DrawerTaskRef>(
    (projectTasksQ.data ?? []).map((t) => [t.id, { id: t.id, key: t.key, title: t.title }]),
  );
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
    <div className="fixed inset-0 z-40 flex justify-end bg-ink/40 animate-fade-in" onClick={onClose}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="h-full w-full max-w-md outline-none animate-slide-in-right sm:max-w-lg lg:max-w-3xl xl:max-w-4xl"
        onClick={(e) => e.stopPropagation()}
      >
        {taskQ.data ? (
          <TaskDrawer
            task={taskQ.data}
            timeZone={timeZone}
            actionError={actionError}
            onDismissError={() => setActionError(null)}
            checklist={checklistQ.data?.items ?? []}
            onToggleChecklistItem={(id, done) => toggleItemM.mutate({ id, done })}
            onAddChecklistItem={(text) => addItemM.mutate(text)}
            onSuggestChecklist={suggestChecklist}
            onSuggestPriority={suggestPriority}
            comments={(commentsQ.data ?? []).map((c) => ({
              id: c.id,
              body: c.body,
              authorName: authorName(c.userId),
              authorAvatar: authorAvatar(c.userId),
              createdAt: c.createdAt,
            }))}
            onAddComment={(body) => addCommentM.mutate(body)}
            assignees={(assigneesQ.data ?? []).map((a) => ({ id: a.id, name: fullName(a) }))}
            assignableUsers={members.map((u) => ({ id: u.id, name: fullName(u) }))}
            onAssignUser={(userId) => assignM.mutate(userId)}
            onUnassignUser={(userId) => unassignM.mutate(userId)}
            attachments={(attachmentsQ.data ?? []).map((a) => ({ id: a.id, filename: a.filename, url: a.url, sizeBytes: a.sizeBytes }))}
            onUploadFile={(file) => uploadM.mutate(file)}
            onDeleteAttachment={(id) => deleteM.mutate(id)}
            dependencies={dependencies}
            availableTasks={(projectTasksQ.data ?? []).map((t) => ({ id: t.id, key: t.key, title: t.title }))}
            onAddDependency={(id) => addDepM.mutate(id)}
            onRemoveDependency={(id) => removeDepM.mutate(id)}
            onSetRecurrence={(rule) => recurrenceM.mutate(rule)}
            statusColumns={(Array.isArray(columnsQ.data) ? columnsQ.data : []).map((c) => ({ id: c.id, name: c.name, category: c.category }))}
            onChangeStatus={(columnId) => moveM.mutate(columnId)}
            activity={(Array.isArray(activityQ.data) ? activityQ.data : [])
              .slice(0, 20)
              .map((a) => ({ id: a.id, action: a.action, actorName: a.actor?.name ?? authorName(a.userId), createdAt: a.createdAt }))}
            onSaveEdit={async (patch, scope) => {
              try {
                await editM.mutateAsync({ patch, scope });
              } catch (e) {
                throw new Error(failureText(e, 'Couldn’t save your changes.'));
              }
            }}
            savePending={editM.isPending}
            // Only admins and this project's managers may delete — don't offer a button that can't work.
            onDelete={canDelete ? (scope) => deleteTaskM.mutate(scope) : undefined}
            watching={watchStatusQ.data ?? false}
            watcherCount={Array.isArray(watchersQ.data) ? watchersQ.data.length : 0}
            onToggleWatch={() => toggleWatchM.mutate()}
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
    </div>,
    document.body,
  );
}
