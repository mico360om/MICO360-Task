import { authedFetch } from './auth.js';

/** HTTP error from the API (4xx/5xx). Network failures reject as a plain Error (→ offline path). */
export class ApiError extends Error {
  constructor(status, message) {
    super(message || `HTTP ${status}`);
    this.name = 'ApiError';
    this.status = status;
  }
}

function qs(params) {
  const pairs = Object.entries(params).filter(([, v]) => v != null && v !== '');
  return pairs.length ? '?' + pairs.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&') : '';
}

/**
 * Resources layer for the extension app. Reads go through the read-through `cache` (so screens work
 * offline); mutations hit the network via `authedFetch` and throw `ApiError` on an HTTP error or
 * reject on a network failure — screens catch the latter and enqueue for sync. Paths mirror /api/v1
 * (see the backend + the Android resources).
 */
export function createApi({ apiBase, storage, cache, fetchImpl = fetch }) {
  async function raw(path, opts) {
    const res = await authedFetch(storage, apiBase, path, opts, fetchImpl); // rejects on network error
    if (!res.ok) {
      let msg;
      try {
        msg = (await res.json())?.error?.message;
      } catch {
        /* non-JSON error body */
      }
      throw new ApiError(res.status, msg);
    }
    if (res.status === 204) return undefined;
    const json = await res.json().catch(() => ({}));
    return json && json.data !== undefined ? json.data : json;
  }

  // Cached GET → { data, stale, cachedAt }.
  const get = (key, path) => cache.read(key, () => raw(path));
  const post = (path, body) => raw(path, { method: 'POST', body: JSON.stringify(body ?? {}) });
  const put = (path, body) => raw(path, { method: 'PUT', body: JSON.stringify(body ?? {}) });
  const patch = (path, body) => raw(path, { method: 'PATCH', body: JSON.stringify(body ?? {}) });
  const del = (path) => raw(path, { method: 'DELETE' });

  return {
    raw,
    projects: {
      list: () => get('projects', '/projects'),
      get: (id) => get(`project:${id}`, `/projects/${id}`),
      columns: (id) => get(`columns:${id}`, `/projects/${id}/columns`),
      members: (id) => get(`members:${id}`, `/projects/${id}/members`),
      progress: (id) => get(`progress:${id}`, `/projects/${id}/progress`),
    },
    tasks: {
      mine: () => get('tasks:mine', '/tasks/mine'),
      list: (params = {}) => {
        const query = qs({
          projectId: params.projectId,
          columnId: params.columnId,
          assigneeId: params.assigneeId,
          q: params.q,
          priority: params.priority,
          category: params.category,
          overdue: params.overdue ? 'true' : undefined,
          boardDate: params.boardDate,
          sort: params.sort,
          order: params.order,
        });
        return get(`tasks:${query}`, `/tasks${query}`);
      },
      get: (id) => get(`task:${id}`, `/tasks/${id}`),
      create: (body) => post('/tasks', body),
      update: (id, body) => put(`/tasks/${id}`, body),
      move: (id, columnId, position) => patch(`/tasks/${id}/move`, { columnId, position }),
      remove: (id) => del(`/tasks/${id}`),
      assignees: (id) => get(`assignees:${id}`, `/tasks/${id}/assignees`),
      assign: (id, userIds) => post(`/tasks/${id}/assignees`, { userIds }),
      unassign: (id, userId) => del(`/tasks/${id}/assignees/${userId}`),
      checklist: (id) => get(`checklist:${id}`, `/tasks/${id}/checklist`),
      addChecklistItem: (id, text) => post(`/tasks/${id}/checklist`, { text }),
      updateChecklistItem: (itemId, pch) => put(`/checklist/${itemId}`, pch),
      removeChecklistItem: (itemId) => del(`/checklist/${itemId}`),
      comments: (id) => get(`comments:${id}`, `/tasks/${id}/comments`),
      addComment: (id, body) => post(`/tasks/${id}/comments`, { body }),
      tags: (id) => get(`tags:${id}`, `/tasks/${id}/tags`),
      setTags: (id, tags) => put(`/tasks/${id}/tags`, { tags }),
    },
    notifications: {
      list: () => get('notifications', '/notifications'),
      unreadCount: () => get('unread', '/notifications/unread-count'),
      markRead: (id) => put(`/notifications/${id}/read`),
      markAllRead: () => post('/notifications/read-all'),
    },
    directory: () => get('directory', '/users/directory'),
    chat: {
      conversations: () => get('conversations', '/conversations'),
      openProjectChannel: (projectId) => raw(`/projects/${projectId}/chat`),
      messages: (conversationId) => get(`messages:${conversationId}`, `/conversations/${conversationId}/messages`),
      send: (conversationId, body) => post(`/conversations/${conversationId}/messages`, { body }),
      markRead: (conversationId) => post(`/conversations/${conversationId}/read`),
    },
  };
}
