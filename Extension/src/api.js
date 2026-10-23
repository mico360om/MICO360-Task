import { ApiError, UnexpectedReplyError } from './errors.js';
import { sanitizeMessages, sanitizeSummaries, CHAT_PAGE_SIZE } from './chat.js';
import { fileNameFromDisposition } from './reports.js';
import { timeoutSignal, DOWNLOAD_TIMEOUT_MS, UPLOAD_TIMEOUT_MS, AI_TIMEOUT_MS } from './auth.js';
import { applyPending } from './pending-overlay.js';
import { meetingsListParams, upNextListParams } from './meetings.js';

export { ApiError };

function qs(params) {
  const pairs = Object.entries(params).filter(([, v]) => v != null && v !== '');
  return pairs.length ? '?' + pairs.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&') : '';
}

/** GET /meetings's query (and its saved copy's key): `from`/`to` ISO instants, `mine`. */
const meetingsQuery = ({ from, to, mine } = {}) => qs({ from, to, mine: mine ? 'true' : undefined });

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
    /** The server's version (`{ version, deployedAt }`); the saved answer while offline. */
    version: () => get('version', '/version'),
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
      progress: (id) => get(`progress:${id}`, `/projects/${id}/progress`),
      /** The project's team: the people a task in it can be assigned to. */
      members: (id) => get(`members:${id}`, `/projects/${id}/members`),
    },
    attachments: {
      /**
       * Attach one file to a task (multipart, field `file`, as the web does). Online only: a file is
       * never kept for later. The server shrinks pictures and refuses files over its limit (413).
       */
      upload: (taskId, file) => {
        const form = new FormData();
        form.append('file', file, file.name);
        return raw(`/tasks/${taskId}/attachments`, { method: 'POST', body: form, signal: timeoutSignal(UPLOAD_TIMEOUT_MS) });
      },
    },
    ai: {
      /**
       * "Describe it": a sentence becomes suggested task details (`{ title, description, dueDate,
       * priority, recurrence, project }`). `today` is the company's calendar day, so "tomorrow" means
       * the same day it does on the web. Without AI set up the server answers 400 with its own message.
       */
      parseTask: (text, today) => raw('/ai/parse-task', {
        method: 'POST',
        body: JSON.stringify({ text, ...(today ? { today } : {}) }),
        signal: timeoutSignal(AI_TIMEOUT_MS),
      }),
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
      assignees: (id) => get(`assignees:${id}`, `/tasks/${id}/assignees`),
      checklist: (id) => get(`checklist:${id}`, `/tasks/${id}/checklist`),
      comments: (id) => get(`comments:${id}`, `/tasks/${id}/comments`),
      // The task drawer (Stage 3): its files, timeline, watching, and who an @mention can reach.
      attachments: (id) => get(`attachments:${id}`, `/tasks/${id}/attachments`),
      activity: (id) => get(`activity:${id}`, `/tasks/${id}/activity`),
      watch: (id) => get(`watch:${id}`, `/tasks/${id}/watch`),
      watchers: (id) => get(`watchers:${id}`, `/tasks/${id}/watchers`),
      mentionable: (id) => get(`mentionable:${id}`, `/tasks/${id}/mentionable`),
    },
    /** The workspace's shared list of tags (suggested while tagging a task). */
    tags: () => get('tags', '/tags'),
    /**
     * Search tasks, projects, people and meetings (`{ tasks, projects, users, meetings }`), as the
     * web's Ctrl+K. Always asked fresh: answers for every word typed aren't kept on the device.
     */
    search: (q) => raw(`/search${qs({ q })}`),
    /**
     * The calendar for the days `from`–`to` ('YYYY-MM-DD', at most 101): tasks due in them in the
     * projects you can see, and the days repeating ones will be copied to (`occurrences`, `series`).
     */
    calendar: (from, to) => get(`calendar:${from}:${to}`, `/calendar${qs({ from, to })}`),
    /** Your own date settings: `{ timeZone, weekStart }` (null = the company's zone, Sunday). */
    preferences: () => get('prefs', '/users/me/preferences'),
    meetings: {
      /** Meetings you can see; `from`/`to` (ISO instants): those starting in that span; `mine`: you organize. */
      list: (params = {}) => {
        const query = meetingsQuery(params);
        return get(`meetings:${query}`, `/meetings${query}`);
      },
      get: (id) => get(`meeting:${id}`, `/meetings/${encodeURIComponent(id)}`),
      /** Who is on it, with each one's answer (yours waiting to sync on top). */
      attendees: (id) => get(`meeting-attendees:${id}`, `/meetings/${encodeURIComponent(id)}/attendees`),
      agenda: (id) => get(`meeting-agenda:${id}`, `/meetings/${encodeURIComponent(id)}/agenda`),
      /**
       * An answer the server took: the saved copies say it too — the meeting's people, and today's
       * Meetings and Up next lists (offline they would show the answer before). Only copies already
       * saved are changed; never throws.
       */
      rememberAnswer: async ({ meetingId, attendeeId, response, timeZone }) => {
        if (!cache || typeof cache.update !== 'function') return;
        const people = (rows) => (Array.isArray(rows) ? rows.map((a) => (a && a.id === attendeeId ? { ...a, response } : a)) : undefined);
        const listed = (rows) => (Array.isArray(rows) ? rows.map((m) => (m && m.id === meetingId && m.myAttendeeId === attendeeId ? { ...m, myResponse: response } : m)) : undefined);
        try {
          await cache.update(`meeting-attendees:${meetingId}`, people);
          for (const params of [meetingsListParams(timeZone), upNextListParams(timeZone)]) await cache.update(`meetings:${meetingsQuery(params)}`, listed);
        } catch {
          /* the saved copies are best effort */
        }
      },
    },
    notifications: {
      list: () => get('notifications', '/notifications'),
      unreadCount: () => get('unread', '/notifications/unread-count'),
      /** Muted kinds, the reminder time and the morning emails (kept to show offline). */
      preferences: () => get('notification-prefs', '/notifications/preferences'),
      /** Saves what is sent (the whole muted list with the reminder time); the server keeps the rest. */
      setPreferences: (prefs) => raw('/notifications/preferences', { method: 'PUT', body: JSON.stringify(prefs ?? {}) }),
      /**
       * "Send me a test now": the two morning emails to the signed-in person at once (online only,
       * never queued): `{ pending, completed }`, each 'sent' or 'empty'. The server allows one a minute.
       */
      sendDailyTest: () => post('/notifications/daily-emails/test'),
    },
    directory: () => get('directory', '/users/directory'),
    chat: {
      conversations: () => get('conversations', '/conversations', sanitizeSummaries),
      openProjectChannel: (projectId) => raw(`/projects/${projectId}/chat`),
      /** The newest page of a conversation (kept for offline, with messages waiting to be sent on top). */
      messages: (conversationId) => get(`messages:${conversationId}`, `/conversations/${conversationId}/messages`, sanitizeMessages),
      /** The page just older than `before` (the oldest loaded message's time): read fresh, never kept. */
      older: async (conversationId, before) => sanitizeMessages(await raw(`/conversations/${conversationId}/messages${qs({ before, limit: CHAT_PAGE_SIZE })}`)),
      markRead: (conversationId) => post(`/conversations/${conversationId}/read`),
      /** This device has received the conversation's messages (the sender sees "Delivered"). */
      markDelivered: (conversationId) => post(`/conversations/${conversationId}/delivered`),
      /** Open (or start) the direct conversation with someone. */
      startDirect: (userId) => post('/conversations/direct', { userId }),
      /** Favorite, archived or muted — for the signed-in person only. */
      setPrefs: (conversationId, prefs) => raw(`/conversations/${conversationId}/prefs`, { method: 'PUT', body: JSON.stringify(prefs ?? {}) }),
      /**
       * Send a file as a message, with an optional caption. Online only (a file is never kept for
       * later). The clientId comes first, so a retry gets the first copy back instead of a second.
       */
      upload: (conversationId, file, { clientId, body } = {}) => {
        const form = new FormData();
        if (clientId) form.append('clientId', clientId);
        if (body) form.append('body', body);
        form.append('file', file, file.name);
        return raw(`/conversations/${conversationId}/attachments`, { method: 'POST', body: form, signal: timeoutSignal(UPLOAD_TIMEOUT_MS) });
      },
    },
  };
}
