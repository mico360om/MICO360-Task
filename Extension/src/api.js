import { ApiError } from './errors.js';
import { sanitizeMessages, sanitizeSummaries } from './chat.js';

export { ApiError };

function qs(params) {
  const pairs = Object.entries(params).filter(([, v]) => v != null && v !== '');
  return pairs.length ? '?' + pairs.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&') : '';
}

/**
 * Resources layer for the extension app. Reads go through the read-through `cache` (so screens work
 * offline); calls go out via `auth.authedFetch` (see auth.js) and throw `ApiError` on an HTTP error
 * or reject on a network failure. Screens send queue-able writes through `sendOrQueue` (queue.js).
 * Paths mirror /api/v1 (see the backend + the Android resources).
 */
export function createApi({ auth, cache }) {
  async function raw(path, opts) {
    const res = await auth.authedFetch(path, opts); // rejects on network error
    if (!res.ok) {
      let err;
      try {
        err = (await res.json())?.error;
      } catch {
        /* non-JSON error body */
      }
      throw new ApiError(res.status, err?.message, err?.code);
    }
    if (res.status === 204) return undefined;
    const json = await res.json().catch(() => ({}));
    return json && json.data !== undefined ? json.data : json;
  }

  // Cached GET → { data, stale, cachedAt }. `transform` runs before anything is cached.
  const get = (key, path, transform) =>
    cache.read(key, async () => {
      const data = await raw(path);
      return transform ? transform(data) : data;
    });
  const post = (path, body) => raw(path, { method: 'POST', body: JSON.stringify(body ?? {}) });
  const put = (path, body) => raw(path, { method: 'PUT', body: JSON.stringify(body ?? {}) });
  const del = (path) => raw(path, { method: 'DELETE' });

  return {
    raw,
    config: () => raw('/config'),
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
      remove: (id) => del(`/tasks/${id}`),
      assignees: (id) => get(`assignees:${id}`, `/tasks/${id}/assignees`),
      checklist: (id) => get(`checklist:${id}`, `/tasks/${id}/checklist`),
      removeChecklistItem: (itemId) => del(`/checklist/${itemId}`),
      comments: (id) => get(`comments:${id}`, `/tasks/${id}/comments`),
      tags: (id) => get(`tags:${id}`, `/tasks/${id}/tags`),
      setTags: (id, tags) => put(`/tasks/${id}/tags`, { tags }),
    },
    notifications: {
      list: () => get('notifications', '/notifications'),
      unreadCount: () => get('unread', '/notifications/unread-count'),
      markAllRead: () => post('/notifications/read-all'),
    },
    directory: () => get('directory', '/users/directory'),
    chat: {
      conversations: () => get('conversations', '/conversations', sanitizeSummaries),
      openProjectChannel: (projectId) => raw(`/projects/${projectId}/chat`),
      messages: (conversationId) => get(`messages:${conversationId}`, `/conversations/${conversationId}/messages`, sanitizeMessages),
      markRead: (conversationId) => post(`/conversations/${conversationId}/read`),
    },
  };
}
