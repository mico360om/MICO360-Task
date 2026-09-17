import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServices } from './providers';
import { ApiError } from '../lib/api-client';
import type { SyncQueue } from '../lib/sync-queue';
import type { ApiTask } from '../lib/types';

/**
 * Persist a failed mutation for later sync ONLY on a network failure (A8). An `ApiError` is a real
 * server rejection (4xx/5xx) — it must surface and must never be replayed; anything else means we
 * were offline, so the write is queued and replayed on reconnect (see performMutation + the sync
 * controller). Keeps every write hook's offline behavior identical.
 */
async function queueOnOffline(queue: SyncQueue, err: unknown, kind: string, payload: unknown): Promise<void> {
  if (!(err instanceof ApiError)) await queue.enqueue(kind, payload);
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
  const { resources, queue } = useServices();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userIds: string[]) => resources.tasks.assign(taskId, userIds),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['task', taskId, 'assignees'] });
    },
    onError: (err, userIds) => queueOnOffline(queue, err, 'task.assign', { id: taskId, userIds }),
  });
}

export function useUnassignUser(taskId: string) {
  const { resources, queue } = useServices();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => resources.tasks.unassign(taskId, userId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['task', taskId, 'assignees'] });
    },
    onError: (err, userId) => queueOnOffline(queue, err, 'task.unassign', { id: taskId, userId }),
  });
}

// ── Checklist (subtasks) ─────────────────────────────────────────────────────
export function useTaskChecklist(taskId: string) {
  const { resources } = useServices();
  return useQuery({ queryKey: ['task', taskId, 'checklist'], queryFn: () => resources.tasks.checklist(taskId) });
}

export function useChecklistMutations(taskId: string) {
  const { resources, queue } = useServices();
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['task', taskId, 'checklist'] });
  };
  const add = useMutation({
    mutationFn: (text: string) => resources.tasks.addChecklistItem(taskId, text),
    onSuccess: invalidate,
    onError: (err, text) => queueOnOffline(queue, err, 'checklist.add', { id: taskId, text }),
  });
  const update = useMutation({
    mutationFn: ({ itemId, patch }: { itemId: string; patch: { done?: boolean; text?: string } }) => resources.tasks.updateChecklistItem(itemId, patch),
    onSuccess: invalidate,
    onError: (err, { itemId, patch }) => queueOnOffline(queue, err, 'checklist.update', { itemId, patch }),
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
  const { resources, queue } = useServices();
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['task', taskId, 'comments'] });
  };
  const add = useMutation({
    mutationFn: (body: string) => resources.tasks.addComment(taskId, body),
    onSuccess: invalidate,
    onError: (err, body) => queueOnOffline(queue, err, 'comment.add', { id: taskId, body }),
  });
  const remove = useMutation({ mutationFn: (commentId: string) => resources.tasks.removeComment(commentId), onSuccess: invalidate });
  return { add, remove };
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

export function useMoveTask(projectId: string, boardDate?: string) {
  const { resources, queue } = useServices();
  const qc = useQueryClient();
  const key = ['tasks', 'project', projectId, boardDate ?? 'all'];
  return useMutation({
    mutationFn: ({ id, columnId, position }: { id: string; columnId: string; position?: number }) =>
      resources.tasks.move(id, columnId, position),
    // Optimistic move: the card jumps columns immediately, then we reconcile with the server.
    onMutate: async ({ id, columnId }) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<ApiTask[]>(key);
      qc.setQueryData<ApiTask[]>(key, (list) => list?.map((t) => (t.id === id ? { ...t, columnId } : t)));
      return { prev };
    },
    onError: async (err, vars, ctx) => {
      if (err instanceof ApiError) {
        // The server rejected the move — roll back to the pre-move board.
        if (ctx?.prev) qc.setQueryData(key, ctx.prev);
      } else {
        // Offline/network failure — keep the optimistic move and replay it on reconnect.
        await queue.enqueue('task.move', vars);
      }
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: key });
    },
  });
}

export function useUpdateTask(taskId: string) {
  const { resources, queue } = useServices();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<ApiTask> & { scope?: 'one' | 'series' }) => resources.tasks.update(taskId, patch),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['task', taskId] });
      void qc.invalidateQueries({ queryKey: ['tasks'] });
    },
    onError: (err, patch) => queueOnOffline(queue, err, 'task.update', { id: taskId, patch }),
  });
}

export function useMarkNotificationRead() {
  const { resources, queue } = useServices();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => resources.notifications.markRead(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['notifications'] });
    },
    onError: (err, id) => queueOnOffline(queue, err, 'notification.read', { id }),
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
  const { resources, queue } = useServices();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => resources.chat.send(conversationId, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['chat', 'messages', conversationId] });
      void qc.invalidateQueries({ queryKey: ['chat', 'conversations'] });
    },
    onError: (err, body) => queueOnOffline(queue, err, 'chat.send', { conversationId, body }),
  });
}
