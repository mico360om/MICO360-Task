import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServices } from './providers';
import { isNetworkError } from '../lib/api-client';
import { newIdempotencyKey } from '../lib/idempotency';
import type { SyncQueue } from '../lib/sync-queue';
import type { ApiTask } from '../lib/types';
import type { NotificationPreferences } from '../lib/notification-prefs';
import type { ReportFilters } from '../lib/reports';

/** Variables of a creating write, carrying the idempotency key minted for this user action (XP-06). */
export type Keyed<T> = T & { idempotencyKey: string };

/** Attach a fresh idempotency key to one user action — the online try and any offline replay share it. */
export function keyed<T extends object>(vars: T): Keyed<T> {
  return { ...vars, idempotencyKey: newIdempotencyKey() };
}

/**
 * Persist a failed write for later sync ONLY when the request got no answer (offline / timeout,
 * A8). A server answer (`ApiError`, 4xx/5xx) is a real rejection — it must surface and must never
 * be replayed. Queued items record their owner so they are only ever replayed for that user
 * (XP-02), and reuse the action's idempotency key so a replay of a write the server already saved
 * is de-duplicated (XP-06).
 */
async function queueOnOffline(
  queue: SyncQueue,
  userId: string | null,
  err: unknown,
  kind: string,
  payload: unknown,
  idempotencyKey?: string,
): Promise<void> {
  if (!userId || !isNetworkError(err)) return;
  await queue.enqueue(kind, payload, { userId, idempotencyKey });
}

/** List queries read through the offline cache so a cold start (offline) still shows the last data. */
export function useProjects() {
  const { resources, cache } = useServices();
  return useQuery({
    queryKey: ['projects'],
    queryFn: async () => (await cache.read('projects', () => resources.projects.list())).data,
  });
}

export function useProjectColumns(projectId: string) {
  const { resources, cache } = useServices();
  return useQuery({
    queryKey: ['columns', projectId],
    queryFn: async () => (await cache.read(`columns.${projectId}`, () => resources.projects.columns(projectId))).data,
    enabled: !!projectId,
  });
}

export function useProjectTasks(projectId: string, boardDate?: string) {
  const { resources, cache } = useServices();
  const dk = boardDate ?? 'all';
  return useQuery({
    queryKey: ['tasks', 'project', projectId, dk],
    queryFn: async () =>
      (await cache.read(`tasks.${projectId}.${dk}`, () => resources.tasks.list({ projectId, boardDate }))).data,
  });
}

export function useMyTasks() {
  const { resources, cache } = useServices();
  return useQuery({
    queryKey: ['tasks', 'mine'],
    queryFn: async () => (await cache.read('tasks.mine', () => resources.tasks.mine())).data,
  });
}

export function useTask(taskId: string) {
  const { resources } = useServices();
  return useQuery({ queryKey: ['task', taskId], queryFn: () => resources.tasks.get(taskId) });
}

export function useTaskTags(taskId: string) {
  const { resources } = useServices();
  return useQuery({ queryKey: ['task', taskId, 'tags'], queryFn: () => resources.tasks.tags(taskId) });
}

export function useProjectMembers(projectId: string) {
  const { resources } = useServices();
  return useQuery({
    queryKey: ['project', projectId, 'members'],
    queryFn: () => resources.projects.members(projectId),
    enabled: !!projectId,
  });
}

export function useTaskAssignees(taskId: string) {
  const { resources } = useServices();
  return useQuery({ queryKey: ['task', taskId, 'assignees'], queryFn: () => resources.tasks.assignees(taskId) });
}

export function useAssignUsers(taskId: string) {
  const { resources, queue, currentUserId } = useServices();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userIds, idempotencyKey }: Keyed<{ userIds: string[] }>) =>
      resources.tasks.assign(taskId, userIds, { idempotencyKey }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['task', taskId, 'assignees'] });
    },
    onError: (err, v) => queueOnOffline(queue, currentUserId(), err, 'task.assign', { id: taskId, userIds: v.userIds }, v.idempotencyKey),
  });
}

export function useUnassignUser(taskId: string) {
  const { resources, queue, currentUserId } = useServices();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => resources.tasks.unassign(taskId, userId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['task', taskId, 'assignees'] });
    },
    onError: (err, userId) => queueOnOffline(queue, currentUserId(), err, 'task.unassign', { id: taskId, userId }),
  });
}

// ── Checklist (subtasks) ─────────────────────────────────────────────────────
export function useTaskChecklist(taskId: string) {
  const { resources } = useServices();
  return useQuery({ queryKey: ['task', taskId, 'checklist'], queryFn: () => resources.tasks.checklist(taskId) });
}

export function useChecklistMutations(taskId: string) {
  const { resources, queue, currentUserId } = useServices();
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['task', taskId, 'checklist'] });
  };
  const add = useMutation({
    mutationFn: ({ text, idempotencyKey }: Keyed<{ text: string }>) => resources.tasks.addChecklistItem(taskId, text, { idempotencyKey }),
    onSuccess: invalidate,
    onError: (err, v) => queueOnOffline(queue, currentUserId(), err, 'checklist.add', { id: taskId, text: v.text }, v.idempotencyKey),
  });
  const update = useMutation({
    mutationFn: ({ itemId, patch }: { itemId: string; patch: { done?: boolean; text?: string } }) => resources.tasks.updateChecklistItem(itemId, patch),
    onSuccess: invalidate,
    onError: (err, { itemId, patch }) => queueOnOffline(queue, currentUserId(), err, 'checklist.update', { itemId, patch }),
  });
  const remove = useMutation({ mutationFn: (itemId: string) => resources.tasks.removeChecklistItem(itemId), onSuccess: invalidate });
  return { add, update, remove };
}

// ── Comments ─────────────────────────────────────────────────────────────────
export function useTaskComments(taskId: string) {
  const { resources } = useServices();
  return useQuery({ queryKey: ['task', taskId, 'comments'], queryFn: () => resources.tasks.comments(taskId) });
}

export function useCommentMutations(taskId: string) {
  const { resources, queue, currentUserId } = useServices();
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['task', taskId, 'comments'] });
  };
  const add = useMutation({
    mutationFn: ({ body, idempotencyKey }: Keyed<{ body: string }>) => resources.tasks.addComment(taskId, body, undefined, { idempotencyKey }),
    onSuccess: invalidate,
    onError: (err, v) => queueOnOffline(queue, currentUserId(), err, 'comment.add', { id: taskId, body: v.body }, v.idempotencyKey),
  });
  const remove = useMutation({ mutationFn: (commentId: string) => resources.tasks.removeComment(commentId), onSuccess: invalidate });
  return { add, remove };
}

// ── Attachments ──────────────────────────────────────────────────────────────
export function useTaskAttachments(taskId: string) {
  const { resources } = useServices();
  return useQuery({ queryKey: ['task', taskId, 'attachments'], queryFn: () => resources.tasks.attachments(taskId) });
}

/** Upload one picked file / remove a file. Uploads need a connection (files aren't queued offline). */
export function useAttachmentMutations(taskId: string) {
  const { resources } = useServices();
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['task', taskId, 'attachments'] });
  };
  const upload = useMutation({
    mutationFn: (part: { uri: string; name: string; type: string }) => resources.tasks.uploadAttachment(taskId, part),
    onSuccess: invalidate,
  });
  const remove = useMutation({ mutationFn: (attachmentId: string) => resources.tasks.removeAttachment(attachmentId), onSuccess: invalidate });
  return { upload, remove };
}

// ── Notification preferences ─────────────────────────────────────────────────
export function useNotificationPreferences() {
  const { resources } = useServices();
  return useQuery({ queryKey: ['notifications', 'preferences'], queryFn: () => resources.notifications.preferences() });
}

/** Save preferences; the switch flips at once and snaps back if the server refuses. */
export function useSaveNotificationPreferences() {
  const { resources } = useServices();
  const qc = useQueryClient();
  const key = ['notifications', 'preferences'];
  return useMutation({
    mutationFn: (prefs: NotificationPreferences) => resources.notifications.setPreferences(prefs),
    onMutate: async (prefs) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<NotificationPreferences>(key);
      qc.setQueryData(key, prefs);
      return { previous };
    },
    onError: (_err, _prefs, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: key });
    },
  });
}

// ── Project details ──────────────────────────────────────────────────────────
export function useProject(projectId: string) {
  const { resources } = useServices();
  return useQuery({ queryKey: ['project', projectId, 'details'], queryFn: () => resources.projects.get(projectId), enabled: !!projectId });
}

// ── Project progress ─────────────────────────────────────────────────────────
export function useProjectProgress(projectId: string) {
  const { resources } = useServices();
  return useQuery({
    queryKey: ['project', projectId, 'progress'],
    queryFn: () => resources.projects.progress(projectId),
    enabled: !!projectId,
  });
}

export function useSetTaskTags(taskId: string) {
  const { resources } = useServices();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tags: string[]) => resources.tasks.setTags(taskId, tags),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['task', taskId, 'tags'] });
    },
  });
}

export function useNotifications() {
  const { resources, cache } = useServices();
  return useQuery({
    queryKey: ['notifications'],
    queryFn: async () => (await cache.read('notifications', () => resources.notifications.list())).data,
  });
}

export function useUnreadCount() {
  const { resources } = useServices();
  return useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: () => resources.notifications.unreadCount(),
  });
}

/**
 * Move a task to another column (MOB-04). The board caches one task list per board date
 * (`['tasks','project',projectId,<date>]`), so the optimistic move and the refresh address the
 * whole `['tasks','project',projectId]` prefix — plus the task's own detail, "My tasks" and the
 * project progress — instead of one key the board never reads.
 */
export function useMoveTask(projectId: string) {
  const { resources, queue, currentUserId } = useServices();
  const qc = useQueryClient();
  const boardPrefix = ['tasks', 'project', projectId];
  return useMutation({
    mutationFn: ({ id, columnId, position }: { id: string; columnId: string; position?: number }) =>
      resources.tasks.move(id, columnId, position),
    // Optimistic move: the card jumps columns immediately, then we reconcile with the server.
    onMutate: async ({ id, columnId }) => {
      await qc.cancelQueries({ queryKey: boardPrefix });
      await qc.cancelQueries({ queryKey: ['task', id], exact: true });
      const boards = qc.getQueriesData<ApiTask[]>({ queryKey: boardPrefix });
      const detail = qc.getQueryData<ApiTask>(['task', id]);
      qc.setQueriesData<ApiTask[]>({ queryKey: boardPrefix }, (list) => list?.map((t) => (t.id === id ? { ...t, columnId } : t)));
      if (detail) qc.setQueryData<ApiTask>(['task', id], { ...detail, columnId });
      return { boards, detail };
    },
    onError: async (err, vars, ctx) => {
      if (isNetworkError(err)) {
        // Offline — keep the optimistic move and replay it on reconnect.
        await queueOnOffline(queue, currentUserId(), err, 'task.move', vars);
        return;
      }
      // The server rejected the move — roll back to the pre-move state.
      for (const [key, data] of ctx?.boards ?? []) qc.setQueryData(key, data);
      if (ctx?.detail) qc.setQueryData(['task', vars.id], ctx.detail);
    },
    onSettled: (_data, _err, vars) => {
      void qc.invalidateQueries({ queryKey: boardPrefix });
      void qc.invalidateQueries({ queryKey: ['task', vars.id], exact: true });
      void qc.invalidateQueries({ queryKey: ['tasks', 'mine'] });
      void qc.invalidateQueries({ queryKey: ['project', projectId, 'progress'] });
    },
  });
}

export function useUpdateTask(taskId: string) {
  const { resources, queue, currentUserId } = useServices();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<ApiTask> & { scope?: 'one' | 'series' }) => resources.tasks.update(taskId, patch),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['task', taskId] });
      void qc.invalidateQueries({ queryKey: ['tasks'] });
      void qc.invalidateQueries({ queryKey: ['project'] });
    },
    onError: (err, patch) => queueOnOffline(queue, currentUserId(), err, 'task.update', { id: taskId, patch }),
  });
}

export function useMarkNotificationRead() {
  const { resources, queue, currentUserId } = useServices();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => resources.notifications.markRead(id),
    // Invalidates the list AND the unread badge (both live under ['notifications']).
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['notifications'] });
    },
    onError: (err, id) => queueOnOffline(queue, currentUserId(), err, 'notification.read', { id }),
  });
}

// ── Reports (administrators) ────────────────────────────────────────────────
/** Everything the Reports screen shows, for the filters; always read fresh (no offline copy). */
export function useReports(filters: ReportFilters) {
  const { resources } = useServices();
  const scope = { projectId: filters.projectId, userId: filters.userId };
  return useQuery({
    queryKey: ['reports', filters],
    queryFn: async () => {
      const r = resources.reports;
      const [projects, status, workload, completion, series] = await Promise.all([
        r.projects(scope),
        r.status(scope),
        r.workload(scope),
        r.completion(scope).catch(() => null),
        r.timeseries(filters).catch(() => null),
      ]);
      return { projects, status, workload, completion, series };
    },
    placeholderData: (prev) => prev,
  });
}

/** The unfiltered project and team lists that feed the Reports filters. */
export function useReportOptions() {
  const { resources } = useServices();
  return useQuery({
    queryKey: ['reports', 'options'],
    queryFn: async () => {
      const [projects, team] = await Promise.all([resources.reports.projects(), resources.reports.workload()]);
      return {
        projects: projects.map((p) => ({ value: p.projectId, label: p.projectName })),
        team: team.map((w) => ({ value: w.userId, label: w.name || w.username })),
      };
    },
  });
}

// ── Chat ─────────────────────────────────────────────────────────────────────
export function useDirectory() {
  const { resources } = useServices();
  return useQuery({ queryKey: ['chat', 'directory'], queryFn: () => resources.directory() });
}

export function useConversations() {
  const { resources } = useServices();
  return useQuery({ queryKey: ['chat', 'conversations'], queryFn: () => resources.chat.conversations() });
}

export function useConversationMessages(conversationId: string) {
  const { resources } = useServices();
  return useQuery({
    queryKey: ['chat', 'messages', conversationId],
    queryFn: () => resources.chat.messages(conversationId),
    enabled: !!conversationId,
  });
}

export function useSendMessage(conversationId: string) {
  const { resources, queue, currentUserId } = useServices();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ body, idempotencyKey }: Keyed<{ body: string }>) => resources.chat.send(conversationId, body, { idempotencyKey }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['chat', 'messages', conversationId] });
      void qc.invalidateQueries({ queryKey: ['chat', 'conversations'] });
    },
    onError: (err, v) => queueOnOffline(queue, currentUserId(), err, 'chat.send', { conversationId, body: v.body }, v.idempotencyKey),
  });
}
