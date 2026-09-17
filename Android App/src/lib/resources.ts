import type { ApiClient } from './api-client';
import type {
  ApiAssignee,
  ApiChatMessage,
  ApiChecklist,
  ApiChecklistItem,
  ApiColumn,
  ApiComment,
  ApiConversation,
  ApiConversationSummary,
  ApiDirectoryUser,
  ApiMember,
  ApiNotification,
  ApiProject,
  ApiProjectProgress,
  ApiTag,
  ApiTask,
  DevicePlatform,
  Envelope,
} from './types';

export interface TaskListParams {
  projectId?: string;
  columnId?: string;
  assigneeId?: string;
  /** Keyword (title/description/key). */
  q?: string;
  /** CSV of priorities, e.g. "HIGH,URGENT". */
  priority?: string;
  /** CSV of column categories (status), e.g. "IN_PROGRESS,REVIEW". */
  category?: string;
  /** CSV of tag ids. */
  tag?: string;
  dueBefore?: string;
  dueAfter?: string;
  overdue?: boolean;
  /** Per-date boards: restrict to tasks on this board day (YYYY-MM-DD). */
  boardDate?: string;
  sort?: 'dueDate' | 'priority' | 'createdAt' | 'updatedAt' | 'title' | 'position';
  order?: 'asc' | 'desc';
}

function queryString(params: Record<string, string | undefined>): string {
  const pairs = Object.entries(params).filter(([, v]) => v != null && v !== '');
  if (pairs.length === 0) return '';
  return '?' + pairs.map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`).join('&');
}

/**
 * Typed resource functions over the API client (A2). Each unwraps the `{ data }`
 * envelope so callers work with the payload directly. Paths mirror `/api/v1`.
 */
export function resourcesApi(client: ApiClient) {
  const data = <T>(p: Promise<Envelope<T>>) => p.then((r) => r.data);

  return {
    projects: {
      list: () => data(client.get<Envelope<ApiProject[]>>('/projects')),
      get: (id: string) => data(client.get<Envelope<ApiProject>>(`/projects/${id}`)),
      columns: (id: string) => data(client.get<Envelope<ApiColumn[]>>(`/projects/${id}/columns`)),
      /** Project members — the pool of users a task in this project can be assigned to. */
      members: (id: string) => data(client.get<Envelope<ApiMember[]>>(`/projects/${id}/members`)),
      /** Per-project progress/dashboard figures. */
      progress: (id: string) => data(client.get<Envelope<ApiProjectProgress>>(`/projects/${id}/progress`)),
    },
    tasks: {
      list: (params: TaskListParams = {}) =>
        data(
          client.get<Envelope<ApiTask[]>>(
            `/tasks${queryString({
              projectId: params.projectId,
              columnId: params.columnId,
              assigneeId: params.assigneeId,
              q: params.q,
              priority: params.priority,
              category: params.category,
              tag: params.tag,
              dueBefore: params.dueBefore,
              dueAfter: params.dueAfter,
              overdue: params.overdue ? 'true' : undefined,
              boardDate: params.boardDate,
              sort: params.sort,
              order: params.order,
            })}`,
          ),
        ),
      mine: () => data(client.get<Envelope<ApiTask[]>>('/tasks/mine')),
      get: (id: string) => data(client.get<Envelope<ApiTask>>(`/tasks/${id}`)),
      create: (
        body: Omit<Partial<ApiTask>, 'tags' | 'assignees'> & {
          title: string;
          projectId: string;
          columnId: string;
          tags?: string[];
          assigneeIds?: string[];
        },
      ) => data(client.post<Envelope<ApiTask>>('/tasks', body)),
      update: (id: string, body: Partial<ApiTask> & { scope?: 'one' | 'series' }) =>
        data(client.put<Envelope<ApiTask>>(`/tasks/${id}`, body)),
      move: (id: string, columnId: string, position?: number) =>
        data(client.patch<Envelope<ApiTask>>(`/tasks/${id}/move`, { columnId, position })),
      remove: (id: string) => client.del<void>(`/tasks/${id}`),
      // Tags: read a task's tags, replace the whole set (find-or-create by name), or detach one.
      tags: (id: string) => data(client.get<Envelope<ApiTag[]>>(`/tasks/${id}/tags`)),
      setTags: (id: string, tags: string[]) => data(client.put<Envelope<ApiTag[]>>(`/tasks/${id}/tags`, { tags })),
      removeTag: (id: string, tagId: string) => client.del<void>(`/tasks/${id}/tags/${tagId}`),
      // Assignees: list, add one or more (idempotent), or remove one.
      assignees: (id: string) => data(client.get<Envelope<ApiAssignee[]>>(`/tasks/${id}/assignees`)),
      assign: (id: string, userIds: string[]) => data(client.post<Envelope<ApiAssignee[]>>(`/tasks/${id}/assignees`, { userIds })),
      unassign: (id: string, userId: string) => client.del<void>(`/tasks/${id}/assignees/${userId}`),
      // Checklist (subtasks): list with progress, add, toggle/edit, reorder, remove.
      checklist: (id: string) => data(client.get<Envelope<ApiChecklist>>(`/tasks/${id}/checklist`)),
      addChecklistItem: (id: string, text: string) => data(client.post<Envelope<ApiChecklistItem>>(`/tasks/${id}/checklist`, { text })),
      updateChecklistItem: (itemId: string, patch: { done?: boolean; text?: string }) =>
        data(client.put<Envelope<ApiChecklistItem>>(`/checklist/${itemId}`, patch)),
      reorderChecklist: (id: string, orderedIds: string[]) =>
        data(client.put<Envelope<ApiChecklistItem[]>>(`/tasks/${id}/checklist/reorder`, { orderedIds })),
      removeChecklistItem: (itemId: string) => client.del<void>(`/checklist/${itemId}`),
      // Comments: list, add (supports @mentions), edit (own), remove (own/admin).
      comments: (id: string) => data(client.get<Envelope<ApiComment[]>>(`/tasks/${id}/comments`)),
      addComment: (id: string, body: string, parentId?: string) =>
        data(client.post<Envelope<ApiComment>>(`/tasks/${id}/comments`, parentId ? { body, parentId } : { body })),
      editComment: (commentId: string, body: string) => data(client.put<Envelope<ApiComment>>(`/comments/${commentId}`, { body })),
      removeComment: (commentId: string) => client.del<void>(`/comments/${commentId}`),
    },
    /** Shared tag catalog for suggestions/autocomplete. */
    tagCatalog: () => data(client.get<Envelope<ApiTag[]>>('/tags')),
    notifications: {
      list: () => data(client.get<Envelope<ApiNotification[]>>('/notifications')),
      unreadCount: () => data(client.get<Envelope<{ count: number }>>('/notifications/unread-count')),
      markRead: (id: string) => data(client.put<Envelope<ApiNotification>>(`/notifications/${id}/read`)),
      markAllRead: () => data(client.post<Envelope<{ updated: number }>>('/notifications/read-all')),
    },
    deviceTokens: {
      register: (token: string, platform: DevicePlatform = 'ANDROID') =>
        client.post<void>('/device-tokens', { token, platform }),
      unregister: (token: string) => client.del<void>(`/device-tokens/${encodeURIComponent(token)}`),
    },
    /** Minimal people directory (id + name) for chat author names and the DM picker. */
    directory: () => data(client.get<Envelope<ApiDirectoryUser[]>>('/users/directory')),
    /** Chat: project channels + 1:1 direct messages. */
    chat: {
      conversations: () => data(client.get<Envelope<ApiConversationSummary[]>>('/conversations')),
      openProjectChannel: (projectId: string) =>
        data(client.get<Envelope<{ conversation: ApiConversation; messages: ApiChatMessage[] }>>(`/projects/${projectId}/chat`)),
      startDirect: (userId: string) => data(client.post<Envelope<ApiConversation>>('/conversations/direct', { userId })),
      messages: (conversationId: string, before?: string) =>
        data(client.get<Envelope<ApiChatMessage[]>>(`/conversations/${conversationId}/messages${before ? `?before=${encodeURIComponent(before)}` : ''}`)),
      send: (conversationId: string, body: string) =>
        data(client.post<Envelope<ApiChatMessage>>(`/conversations/${conversationId}/messages`, { body })),
      edit: (messageId: string, body: string) => data(client.patch<Envelope<ApiChatMessage>>(`/messages/${messageId}`, { body })),
      remove: (messageId: string) => client.del<void>(`/messages/${messageId}`),
      addReaction: (messageId: string, emoji: string) => client.post<void>(`/messages/${messageId}/reactions`, { emoji }),
      removeReaction: (messageId: string, emoji: string) =>
        client.del<void>(`/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`),
      markRead: (conversationId: string) => client.post<void>(`/conversations/${conversationId}/read`, {}),
    },
  };
}

export type ResourcesApi = ReturnType<typeof resourcesApi>;
