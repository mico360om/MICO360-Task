import type { ApiClient } from './api-client';
import { idempotencyHeaders } from './idempotency';
import type { ApiAttachment } from './attachments';
import type { NotificationPreferences } from './notification-prefs';
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
  ApiMentionable,
  ApiActivityEntry,
  ApiDependencyView,
  ApiWatcher,
  ApiPrioritySuggestion,
  ApiNotification,
  ApiMeeting,
  ApiProject,
  ApiProjectMeetingsOverview,
  ApiProjectProgress,
  ApiTag,
  ApiTask,
  DevicePlatform,
  Envelope,
} from './types';
import type { CompletionStats, ProjectPerformanceRow, ReportFilters, TimeSeries, UserWorkloadRow } from './reports';

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

/** Optional per-call write options. `idempotencyKey` is sent as the `Idempotency-Key` header. */
export interface WriteOptions {
  idempotencyKey?: string;
}

/**
 * Typed resource functions over the API client (A2). Each unwraps the `{ data }`
 * envelope so callers work with the payload directly. Paths mirror `/api/v1`.
 * POSTs that create something accept an idempotency key so a retried / replayed write is
 * de-duplicated by the server (XP-06).
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
        opts?: WriteOptions,
      ) => data(client.post<Envelope<ApiTask>>('/tasks', body, idempotencyHeaders(opts?.idempotencyKey))),
      update: (id: string, body: Partial<ApiTask> & { scope?: 'one' | 'series' }) =>
        data(client.put<Envelope<ApiTask>>(`/tasks/${id}`, body)),
      move: (id: string, columnId: string, position?: number) =>
        data(client.patch<Envelope<ApiTask>>(`/tasks/${id}/move`, { columnId, position })),
      /** Delete a task — with 'series', every copy of a repeating task. */
      remove: (id: string, scope?: 'series') => client.del<void>(scope ? `/tasks/${id}?scope=${scope}` : `/tasks/${id}`),
      // Tags: read a task's tags, replace the whole set (find-or-create by name), or detach one.
      tags: (id: string) => data(client.get<Envelope<ApiTag[]>>(`/tasks/${id}/tags`)),
      setTags: (id: string, tags: string[]) => data(client.put<Envelope<ApiTag[]>>(`/tasks/${id}/tags`, { tags })),
      removeTag: (id: string, tagId: string) => client.del<void>(`/tasks/${id}/tags/${tagId}`),
      // Assignees: list, add one or more (idempotent), or remove one.
      assignees: (id: string) => data(client.get<Envelope<ApiAssignee[]>>(`/tasks/${id}/assignees`)),
      assign: (id: string, userIds: string[], opts?: WriteOptions) =>
        data(client.post<Envelope<ApiAssignee[]>>(`/tasks/${id}/assignees`, { userIds }, idempotencyHeaders(opts?.idempotencyKey))),
      unassign: (id: string, userId: string) => client.del<void>(`/tasks/${id}/assignees/${userId}`),
      // Checklist (subtasks): list with progress, add, toggle/edit, reorder, remove.
      checklist: (id: string) => data(client.get<Envelope<ApiChecklist>>(`/tasks/${id}/checklist`)),
      addChecklistItem: (id: string, text: string, opts?: WriteOptions) =>
        data(client.post<Envelope<ApiChecklistItem>>(`/tasks/${id}/checklist`, { text }, idempotencyHeaders(opts?.idempotencyKey))),
      updateChecklistItem: (itemId: string, patch: { done?: boolean; text?: string }) =>
        data(client.put<Envelope<ApiChecklistItem>>(`/checklist/${itemId}`, patch)),
      reorderChecklist: (id: string, orderedIds: string[]) =>
        data(client.put<Envelope<ApiChecklistItem[]>>(`/tasks/${id}/checklist/reorder`, { orderedIds })),
      removeChecklistItem: (itemId: string) => client.del<void>(`/checklist/${itemId}`),
      // Comments: list, add (supports @mentions), edit (own), remove (own/admin).
      comments: (id: string) => data(client.get<Envelope<ApiComment[]>>(`/tasks/${id}/comments`)),
      // Who an @mention in this task's comments would notify — suggested while typing.
      mentionable: (id: string) => data(client.get<Envelope<ApiMentionable[]>>(`/tasks/${id}/mentionable`)),
      addComment: (id: string, body: string, parentId?: string, opts?: WriteOptions) =>
        data(
          client.post<Envelope<ApiComment>>(
            `/tasks/${id}/comments`,
            parentId ? { body, parentId } : { body },
            idempotencyHeaders(opts?.idempotencyKey),
          ),
        ),
      editComment: (commentId: string, body: string) => data(client.put<Envelope<ApiComment>>(`/comments/${commentId}`, { body })),
      removeComment: (commentId: string) => client.del<void>(`/comments/${commentId}`),
      // Attachments (files on a task): list, upload one picked file, remove.
      attachments: (id: string) => data(client.get<Envelope<ApiAttachment[]>>(`/tasks/${id}/attachments`)),
      /** Upload one picked file; `onProgress` hears how much has been sent (0–1). */
      uploadAttachment: (id: string, part: { uri: string; name: string; type: string }, onProgress?: (fraction: number) => void) => {
        const form = new FormData();
        // React Native sends a { uri, name, type } part as the file's bytes.
        form.append('file', part as unknown as Blob);
        return data(client.upload<Envelope<ApiAttachment>>(`/tasks/${id}/attachments`, form, onProgress ? { onProgress } : undefined));
      },
      removeAttachment: (attachmentId: string) => client.del<void>(`/attachments/${attachmentId}`),
      /** The task's activity history (newest first). */
      activity: (id: string) => data(client.get<Envelope<ApiActivityEntry[]>>(`/tasks/${id}/activity`)),
      /** Blockers: what the task waits on, and what waits on it. */
      dependencies: (id: string) => data(client.get<Envelope<ApiDependencyView>>(`/tasks/${id}/dependencies`)),
      addDependency: (id: string, dependsOnTaskId: string) => data(client.post<Envelope<unknown>>(`/tasks/${id}/dependencies`, { dependsOnTaskId })),
      removeDependency: (id: string, dependsOnTaskId: string) => client.del<void>(`/tasks/${id}/dependencies/${dependsOnTaskId}`),
      /** Following a task's updates. */
      watchStatus: (id: string) => data(client.get<Envelope<{ watching: boolean }>>(`/tasks/${id}/watch`)).then((r) => r.watching),
      watch: (id: string) => data(client.post<Envelope<{ watching: boolean }>>(`/tasks/${id}/watch`)),
      unwatch: (id: string) => client.del<void>(`/tasks/${id}/watch`),
      watchers: (id: string) => data(client.get<Envelope<ApiWatcher[]>>(`/tasks/${id}/watchers`)),
    },
    /** Meetings, read-only: the calendar's range and a project's dashboard. */
    meetings: {
      /** The meetings starting in [from, to) (ISO instants) that the user can see. */
      range: (from: string, to: string) => data(client.get<Envelope<ApiMeeting[]>>(`/meetings${queryString({ from, to })}`)),
      projectOverview: (projectId: string) =>
        data(client.get<Envelope<ApiProjectMeetingsOverview>>(`/projects/${projectId}/meetings-overview`)),
    },
    /** AI help — suggestions the user reviews before anything changes. */
    ai: {
      breakdown: (title: string, description?: string) =>
        data(client.post<Envelope<{ items: string[] }>>('/ai/breakdown', { title, description })).then((r) => r?.items ?? []),
      suggestPriority: (title: string, description?: string, dueDate?: string | null) =>
        data(client.post<Envelope<ApiPrioritySuggestion>>('/ai/suggest-priority', { title, description, dueDate })),
    },
    /** Shared tag catalog for suggestions/autocomplete. */
    tagCatalog: () => data(client.get<Envelope<ApiTag[]>>('/tags')),
    notifications: {
      list: () => data(client.get<Envelope<ApiNotification[]>>('/notifications')),
      unreadCount: () => data(client.get<Envelope<{ count: number }>>('/notifications/unread-count')),
      markRead: (id: string) => data(client.put<Envelope<ApiNotification>>(`/notifications/${id}/read`)),
      markAllRead: () => data(client.post<Envelope<{ updated: number }>>('/notifications/read-all')),
      // Which notifications you get and when "due soon" reminders arrive (shared with the web app).
      preferences: () => data(client.get<Envelope<NotificationPreferences>>('/notifications/preferences')),
      setPreferences: (prefs: NotificationPreferences) =>
        data(client.put<Envelope<NotificationPreferences>>('/notifications/preferences', prefs)),
    },
    deviceTokens: {
      register: (token: string, platform: DevicePlatform = 'ANDROID') =>
        client.post<void>('/device-tokens', { token, platform }),
      unregister: (token: string) => client.del<void>(`/device-tokens/${encodeURIComponent(token)}`),
    },
    /** Reports (administrators): the same figures as the web portal, scoped by project / team member. */
    reports: {
      projects: (f: ReportFilters = {}) => data(client.get<Envelope<ProjectPerformanceRow[]>>(`/reports/projects${queryString({ projectId: f.projectId, userId: f.userId })}`)),
      status: (f: ReportFilters = {}) => data(client.get<Envelope<Record<string, number>>>(`/reports/status${queryString({ projectId: f.projectId, userId: f.userId })}`)),
      workload: (f: ReportFilters = {}) => data(client.get<Envelope<UserWorkloadRow[]>>(`/reports/workload${queryString({ projectId: f.projectId, userId: f.userId })}`)),
      completion: (f: ReportFilters = {}) => data(client.get<Envelope<CompletionStats>>(`/reports/completion${queryString({ projectId: f.projectId, userId: f.userId })}`)),
      timeseries: (f: ReportFilters = {}) =>
        data(client.get<Envelope<TimeSeries>>(`/reports/timeseries${queryString({ projectId: f.projectId, userId: f.userId, from: f.from, to: f.to })}`)),
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
      send: (conversationId: string, body: string, opts?: WriteOptions) =>
        data(
          client.post<Envelope<ApiChatMessage>>(
            `/conversations/${conversationId}/messages`,
            { body },
            idempotencyHeaders(opts?.idempotencyKey),
          ),
        ),
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
