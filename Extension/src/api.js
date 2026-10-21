import { ApiError, UnexpectedReplyError } from './errors.js';
import { sanitizeMessages, sanitizeSummaries } from './chat.js';
import { fileNameFromDisposition } from './reports.js';
import { timeoutSignal, DOWNLOAD_TIMEOUT_MS } from './auth.js';
import { applyPending } from './pending-overlay.js';

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
 *
 * `pending()` (optional) resolves the signed-in person's changes still waiting to sync; every cached
 * read shows them on top of the server's answer (H3, pending-overlay.js) and says how many
 * (`pending`). The offline copy itself always keeps the server's answer.
 */
export function createApi({ auth, cache, pending }) {
  async function failure(res) {
    let err;
    try {
      err = (await res.json())?.error;
    } catch {
      /* non-JSON error body */
    }
    return new ApiError(res.status, err?.message, err?.code, err?.details);
  }

  const contentType = (res) => (res.headers && typeof res.headers.get === 'function' ? res.headers.get('content-type') : null);

  /**
   * The `data` of an API answer. A read that is kept offline must be the server's JSON with its
   * `data` (M6): a Wi-Fi sign-in page or a proxy answering 200 would otherwise be saved as `{}` over
   * the good copy, and screens would break on it. Such a reply rejects like being offline.
   */
  async function strictData(res) {
    const type = contentType(res);
    if (type && !/json/i.test(type)) throw new UnexpectedReplyError();
    let json;
    try {
      json = await res.json();
    } catch {
      throw new UnexpectedReplyError();
    }
    if (!json || typeof json !== 'object' || !('data' in json)) throw new UnexpectedReplyError();
    return json.data;
  }

  async function raw(path, opts, { strict = false } = {}) {
    const res = await auth.authedFetch(path, opts); // rejects on network error
    if (!res.ok) throw await failure(res);
    if (res.status === 204) return undefined;
    if (strict) return strictData(res);
    const type = contentType(res);
    if (type && !/json/i.test(type)) throw new UnexpectedReplyError();
    const json = await res.json().catch(() => ({}));
    return json && json.data !== undefined ? json.data : json;
  }

  async function waiting() {
    if (!pending) return [];
    try {
      return (await pending()) || [];
    } catch {
      return [];
    }
  }

  // Cached GET → { data, stale, cachedAt[, pending] }. `transform` runs before anything is cached.
  const get = async (key, path, transform) => {
    const read = await cache.read(key, async () => {
      const data = await raw(path, undefined, { strict: true });
      return transform ? transform(data) : data;
    });
    const items = await waiting();
    if (!items.length) return read;
    const { data, applied } = applyPending(key, read.data, items);
    return applied ? { ...read, data, pending: applied } : read;
  };
  const post = (path, body) => raw(path, { method: 'POST', body: JSON.stringify(body ?? {}) });
  const put = (path, body) => raw(path, { method: 'PUT', body: JSON.stringify(body ?? {}) });
  const del = (path) => raw(path, { method: 'DELETE' });

  /**
   * A file (an export) with the session: `{ blob, fileName }`, the name as the server sent it (or
   * null). It may take much longer than other calls, so it has its own, longer timeout (M4).
   */
  async function download(path) {
    const res = await auth.authedFetch(path, { method: 'GET', signal: timeoutSignal(DOWNLOAD_TIMEOUT_MS) });
    if (!res.ok) throw await failure(res);
    return { blob: await res.blob(), fileName: fileNameFromDisposition(res.headers.get('content-disposition')) };
  }

  // Reports are admin-only and always read fresh (never from the offline cache: stale numbers mislead).
  const filters = ({ projectId, userId } = {}) => qs({ projectId, userId });

  return {
    raw,
    download,
    config: () => raw('/config'),
    reports: {
      projects: (f) => raw(`/reports/projects${filters(f)}`),
      status: (f) => raw(`/reports/status${filters(f)}`),
      workload: (f) => raw(`/reports/workload${filters(f)}`),
      completion: (f) => raw(`/reports/completion${filters(f)}`),
      timeseries: ({ projectId, userId, from, to } = {}) => raw(`/reports/timeseries${qs({ projectId, userId, from, to })}`),
    },
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
