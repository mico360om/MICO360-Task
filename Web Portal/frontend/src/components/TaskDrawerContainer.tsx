import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { checklistApi } from '../api/checklist';
import { commentsApi } from '../api/comments';
import { attachmentsApi } from '../api/attachments';
import { dependenciesApi } from '../api/dependencies';
import { assigneesApi } from '../api/assignees';
import { usersApi } from '../api/users';
import { columnsApi } from '../api/columns';
import { activityApi } from '../api/activity';
import { watchersApi } from '../api/watchers';
import { aiApi } from '../api/ai';
import { tasksApi, type Priority, type RecurrenceRule } from '../api/tasks';
import { TaskDrawer, type DrawerTaskRef } from './TaskDrawer';

export interface TaskDrawerContainerProps {
  taskId: string;
  onClose: () => void;
}

export function TaskDrawerContainer({ taskId, onClose }: TaskDrawerContainerProps) {
  const queryClient = useQueryClient();
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
  const activityQ = useQuery({ queryKey: ['task-activity', taskId], queryFn: () => activityApi(apiClient).forTask(taskId) });
  const watchStatusQ = useQuery({ queryKey: ['task-watch', taskId], queryFn: () => watchersApi(apiClient).status(taskId) });
  const watchersQ = useQuery({ queryKey: ['task-watchers', taskId], queryFn: () => watchersApi(apiClient).list(taskId) });
  const toggleWatchM = useMutation({
    mutationFn: async () => {
      if (watchStatusQ.data) await watchersApi(apiClient).unwatch(taskId);
      else await watchersApi(apiClient).watch(taskId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['task-watch', taskId] });
      queryClient.invalidateQueries({ queryKey: ['task-watchers', taskId] });
    },
  });

  const moveM = useMutation({
    mutationFn: (columnId: string) => tasksApi(apiClient).move(taskId, columnId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['task', taskId] });
      queryClient.invalidateQueries({ queryKey: ['task-activity', taskId] });
      queryClient.invalidateQueries({ queryKey: ['board'] });
      queryClient.invalidateQueries({ queryKey: ['my-tasks'] });
      queryClient.invalidateQueries({ queryKey: ['project-tasks'] });
    },
  });

  const invalidateAttachments = () => queryClient.invalidateQueries({ queryKey: ['attachments', taskId] });
  const uploadM = useMutation({
    mutationFn: (file: File) => attachmentsApi(apiClient).upload(taskId, file),
    onSuccess: invalidateAttachments,
  });
  const deleteM = useMutation({
    mutationFn: (id: string) => attachmentsApi(apiClient).remove(id),
    onSuccess: invalidateAttachments,
  });

  const invalidateDeps = () => queryClient.invalidateQueries({ queryKey: ['dependencies', taskId] });
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['task', taskId] }),
  });

  const editM = useMutation({
    mutationFn: (input: {
      patch: { title?: string; description?: string; priority?: Priority; dueDate?: string | null };
      scope?: 'series';
    }) => tasksApi(apiClient).update(taskId, { ...input.patch, ...(input.scope ? { scope: input.scope } : {}) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['task', taskId] });
      queryClient.invalidateQueries({ queryKey: ['board'] });
      queryClient.invalidateQueries({ queryKey: ['my-tasks'] });
      queryClient.invalidateQueries({ queryKey: ['project-tasks'] });
    },
  });

  const deleteTaskM = useMutation({
    mutationFn: (scope?: 'series') => tasksApi(apiClient).remove(taskId, scope),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['board'] });
      queryClient.invalidateQueries({ queryKey: ['my-tasks'] });
      queryClient.invalidateQueries({ queryKey: ['project-tasks'] });
      onClose();
    },
  });

  const invalidateChecklist = () => queryClient.invalidateQueries({ queryKey: ['checklist', taskId] });
  const toggleItemM = useMutation({
    mutationFn: ({ id, done }: { id: string; done: boolean }) => checklistApi(apiClient).toggle(id, done),
    onSuccess: invalidateChecklist,
  });
  const addItemM = useMutation({
    mutationFn: (text: string) => checklistApi(apiClient).add(taskId, text),
    onSuccess: invalidateChecklist,
  });

  const addCommentM = useMutation({
    mutationFn: (body: string) => commentsApi(apiClient).add(taskId, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['comments', taskId] }),
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
  const usersQ = useQuery({ queryKey: ['users'], queryFn: () => usersApi(apiClient).list() });
  // Directory (non-admin accessible, with names + avatars) to attribute comment authors.
  const directoryQ = useQuery({ queryKey: ['directory'], queryFn: () => usersApi(apiClient).directory() });
  const directory = Array.isArray(directoryQ.data) ? directoryQ.data : [];
  const authorName = (userId: string) => {
    const u = directory.find((d) => d.id === userId);
    return u ? `${u.firstName} ${u.lastName}`.trim() || u.username : 'Unknown';
  };
  const authorAvatar = (userId: string) => directory.find((d) => d.id === userId)?.avatarUrl ?? null;
  const invalidateAssignees = () => queryClient.invalidateQueries({ queryKey: ['assignees', taskId] });
  const assignM = useMutation({
    mutationFn: (userId: string) => assigneesApi(apiClient).assign(taskId, userId),
    onSuccess: invalidateAssignees,
  });
  const unassignM = useMutation({
    mutationFn: (userId: string) => assigneesApi(apiClient).unassign(taskId, userId),
    onSuccess: invalidateAssignees,
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

  // Portalled to <body> so the overlay's `position: fixed` is viewport-relative — never confined to
  // a transformed ancestor (the page-transition wrapper), which would offset/clip the drawer.
  return createPortal(
    <div className="fixed inset-0 z-40 flex justify-end bg-ink/40 animate-fade-in" onClick={onClose}>
      <div className="h-full w-full max-w-md animate-slide-in-right sm:max-w-lg lg:max-w-3xl xl:max-w-4xl" onClick={(e) => e.stopPropagation()}>
        {taskQ.data ? (
          <TaskDrawer
            task={taskQ.data}
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
            assignableUsers={(usersQ.data ?? []).map((u) => ({ id: u.id, name: fullName(u) }))}
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
            onSaveEdit={(patch, scope) => editM.mutate({ patch, scope })}
            savePending={editM.isPending}
            onDelete={(scope) => deleteTaskM.mutate(scope)}
            watching={watchStatusQ.data ?? false}
            watcherCount={Array.isArray(watchersQ.data) ? watchersQ.data.length : 0}
            onToggleWatch={() => toggleWatchM.mutate()}
            onClose={onClose}
          />
        ) : (
          <div className="flex h-full w-full flex-col border-l border-line bg-surface p-5 text-ink-2">Loading…</div>
        )}
      </div>
    </div>,
    document.body,
  );
}
