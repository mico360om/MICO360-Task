/**
 * Changes waiting to sync, layered over what a read returns (H3). The offline cache keeps the
 * server's answers as they were; each read then shows this person's queued changes on top, so a card
 * moved offline stays where it was put, and a task, checklist item, comment or chat message added
 * offline is still there after going to another screen and back — as are tags, a reply, an edited or
 * deleted comment, a removed file, watching, and a deleted task. Pure (no chrome APIs).
 *
 * `applyPending(key, data, items)` takes a read-cache key (see api.js), the data read for it and the
 * signed-in person's queued items (oldest first). It never changes `data` itself: changed rows are
 * copies. Returns `{ data, applied }`, `applied` being how many queued changes touched this read.
 */
import { tagRecords, mergeTagChange } from './tags.js';

/** The temporary id of something created offline: stable for as long as its change is queued. */
export function tempId(item) {
  return `tmp-${item.id}`;
}

export function isTempId(id) {
  return typeof id === 'string' && id.startsWith('tmp-');
}

const atIso = (item) => new Date(typeof item.queuedAt === 'number' ? item.queuedAt : Date.now()).toISOString();

/** The fields of an edit shown on a task (the version and scope travel with the request only). */
function patchOf(item) {
  const p = (item.payload && item.payload.patch) || {};
  const { expectedVersion, scope, ...shown } = p;
  return shown;
}

/** A task row after a queued edit or move of it; null when the item doesn't touch it. */
function changedTask(task, item) {
  const p = item.payload || {};
  if (!task || task.id !== p.id) return null;
  if (item.kind === 'task.update') return { ...task, ...patchOf(item) };
  // Tags it already had keep their colour; a new one has none until the server makes it. A change
  // that knows the list it started from shows as its additions and removals over the task's tags.
  if (item.kind === 'task.tags') {
    const next = Array.isArray(p.tags) ? p.tags : [];
    const now = Array.isArray(task.tags) ? task.tags.map((t) => t && t.name).filter((n) => typeof n === 'string') : [];
    return { ...task, tags: tagRecords(Array.isArray(p.base) ? mergeTagChange(now, p.base, next) : next, task.tags) };
  }
  if (item.kind === 'task.move') {
    const next = { ...task, columnId: p.columnId, columnHidden: false };
    if (p.columnCategory) {
      next.columnCategory = p.columnCategory;
      // As the board shows a move: into Done completes the task, out of it reopens it.
      if (p.columnCategory === 'DONE') {
        next.completedAt = task.completedAt || atIso(item);
        next.progress = 100;
      } else {
        next.completedAt = null;
      }
    }
    return next;
  }
  return null;
}

/** A task created offline, as a board shows it until the server makes the real one. */
function createdTask(item) {
  const p = item.payload || {};
  return {
    id: tempId(item), key: '', title: p.title || '', description: p.description || null, priority: p.priority || 'NORMAL',
    projectId: p.projectId, columnId: p.columnId, columnCategory: null, dueDate: p.dueDate || null, progress: 0,
    completedAt: null, recurrenceRule: p.recurrenceRule || null, pending: true,
  };
}

/** `tasks:?projectId=p1&boardDate=…` → { projectId, boardDate }; null for any other list (tasks:mine, filters). */
function boardOf(key) {
  const query = key.slice('tasks:'.length);
  if (!query.startsWith('?')) return null;
  const params = {};
  for (const pair of query.slice(1).split('&')) {
    const [k, v = ''] = pair.split('=');
    if (k) params[decodeURIComponent(k)] = decodeURIComponent(v);
  }
  const names = Object.keys(params);
  if (!params.projectId || names.some((n) => n !== 'projectId' && n !== 'boardDate')) return null;
  return params;
}

function overTaskList(key, rows, items) {
  const board = boardOf(key);
  let list = rows;
  let applied = 0;
  for (const item of items) {
    if (item.kind === 'task.create') {
      const p = item.payload || {};
      if (board && p.projectId === board.projectId && (p.boardDate || null) === (board.boardDate || null)) {
        list = [...list, createdTask(item)];
        applied += 1;
      }
      continue;
    }
    if (item.kind === 'task.delete') {
      // Deleted on this device: gone from the lists — every copy, when the whole series goes.
      const p = item.payload || {};
      const series = p.scope === 'series' && p.seriesId ? p.seriesId : null;
      const kept = list.filter((t) => t.id !== p.id && !(series && (t.id === series || t.recurrenceParentId === series)));
      if (kept.length !== list.length) {
        list = kept;
        applied += 1;
      }
      continue;
    }
    let touched = false;
    const next = list.map((t) => {
      const c = changedTask(t, item);
      if (!c) return t;
      touched = true;
      return c;
    });
    if (touched) {
      list = next;
      applied += 1;
    }
  }
  return { data: list, applied };
}

function overTask(taskId, task, items) {
  let data = task;
  let applied = 0;
  for (const item of items) {
    if (!item.payload || item.payload.id !== taskId) continue;
    // Opened again before its delete has synced: it says so (the drawer shows nothing to change).
    const c = item.kind === 'task.delete' ? { ...data, pendingDelete: true } : changedTask(data, item);
    if (c) {
      data = c;
      applied += 1;
    }
  }
  return { data, applied };
}

function overChecklist(taskId, list, items) {
  let rows = Array.isArray(list.items) ? list.items : [];
  let applied = 0;
  for (const item of items) {
    const p = item.payload || {};
    if (item.kind === 'checklist.add' && p.id === taskId) {
      rows = [...rows, { id: tempId(item), text: p.text || '', done: false, pending: true }];
      applied += 1;
    } else if (item.kind === 'checklist.update' && rows.some((r) => r.id === p.itemId)) {
      rows = rows.map((r) => (r.id === p.itemId ? { ...r, ...(p.patch || {}) } : r));
      applied += 1;
    }
  }
  if (!applied) return { data: list, applied };
  return { data: { ...list, items: rows, done: rows.filter((r) => r.done).length, total: rows.length }, applied };
}

function overComments(taskId, list, items) {
  let rows = list;
  let applied = 0;
  for (const item of items) {
    const p = item.payload || {};
    if (p.id !== taskId) continue;
    if (item.kind === 'comment.add') {
      rows = [...rows, { id: tempId(item), taskId, userId: item.userId, body: p.body || '', parentId: p.parentId || null, createdAt: atIso(item), pending: true }];
      applied += 1;
    } else if (item.kind === 'comment.update' && rows.some((c) => c.id === p.commentId)) {
      rows = rows.map((c) => (c.id === p.commentId ? { ...c, body: p.body || '', editedAt: atIso(item) } : c));
      applied += 1;
    } else if (item.kind === 'comment.delete' && rows.some((c) => c.id === p.commentId)) {
      rows = rows.filter((c) => c.id !== p.commentId);
      applied += 1;
    }
  }
  return { data: rows, applied };
}

function overAttachments(taskId, list, items) {
  let rows = list;
  let applied = 0;
  for (const item of items) {
    const p = item.payload || {};
    if (item.kind !== 'attachment.delete' || p.id !== taskId || !rows.some((a) => a.id === p.attachmentId)) continue;
    rows = rows.filter((a) => a.id !== p.attachmentId);
    applied += 1;
  }
  return { data: rows, applied };
}

const isWatchChange = (item, taskId) => (item.kind === 'task.watch' || item.kind === 'task.unwatch') && item.payload && item.payload.id === taskId;

/** `{ watching }` for the signed-in person: their last watch or unwatch waiting to sync wins. */
function overWatch(taskId, value, items) {
  const mine = items.filter((i) => isWatchChange(i, taskId));
  if (!mine.length) return { data: value, applied: 0 };
  return { data: { ...value, watching: mine[mine.length - 1].kind === 'task.watch' }, applied: mine.length };
}

/** Who watches the task: the signed-in person added or taken off by their change waiting to sync. */
function overWatchers(taskId, list, items) {
  let rows = list;
  let applied = 0;
  for (const item of items) {
    if (!isWatchChange(item, taskId)) continue;
    rows = rows.filter((u) => u.id !== item.userId);
    if (item.kind === 'task.watch') rows = [...rows, { id: item.userId }];
    applied += 1;
  }
  return { data: rows, applied };
}

function overAssignees(taskId, list, items) {
  let rows = list;
  let applied = 0;
  for (const item of items) {
    const p = item.payload || {};
    if (p.id !== taskId) continue;
    if (item.kind === 'task.assign') {
      const add = (p.userIds || []).filter((uid) => !rows.some((u) => u.id === uid));
      rows = [...rows, ...add.map((uid) => ({ id: uid }))];
      applied += 1;
    } else if (item.kind === 'task.unassign') {
      rows = rows.filter((u) => u.id !== p.userId);
      applied += 1;
    }
  }
  return { data: rows, applied };
}

function overNotifications(list, items) {
  let rows = list;
  let applied = 0;
  for (const item of items) {
    if (item.kind === 'notification.readAll') {
      rows = rows.map((n) => (n.readAt ? n : { ...n, readAt: atIso(item) }));
      applied += 1;
    } else if (item.kind === 'notification.read') {
      const id = item.payload && item.payload.id;
      rows = rows.map((n) => (n.id === id && !n.readAt ? { ...n, readAt: atIso(item) } : n));
      applied += 1;
    }
  }
  return { data: rows, applied };
}

function overUnread(value, items) {
  if (typeof value.count !== 'number') return { data: value, applied: 0 };
  const all = items.some((i) => i.kind === 'notification.readAll');
  const reads = items.filter((i) => i.kind === 'notification.read').length;
  if (!all && !reads) return { data: value, applied: 0 };
  return { data: { ...value, count: all ? 0 : Math.max(0, value.count - reads) }, applied: all ? 1 : reads };
}

/**
 * Messages waiting to be sent, after the conversation's own. Each carries its clientId (which the
 * server keeps with the message; one kept before it had its own was its Idempotency-Key), so one the
 * server already has — its first try did arrive — isn't shown twice (as on the web).
 */
function overMessages(conversationId, list, items) {
  let rows = list;
  let applied = 0;
  const arrived = new Set(list.map((m) => m && m.clientId).filter(Boolean));
  for (const item of items) {
    const p = item.payload || {};
    if (item.kind !== 'chat.send' || p.conversationId !== conversationId) continue;
    const clientId = p.clientId || item.idempotencyKey || null;
    if (clientId && arrived.has(clientId)) continue;
    rows = [...rows, {
      id: tempId(item), conversationId, userId: item.userId, body: p.body || '', createdAt: atIso(item),
      editedAt: null, deletedAt: null, attachments: [], reactions: [], pending: true, clientId,
    }];
    applied += 1;
  }
  return { data: rows, applied };
}

/** A meeting's people with your answer waiting to sync on your row (the latest one wins). */
function overMeetingPeople(meetingId, list, items) {
  let rows = list;
  let applied = 0;
  for (const item of items) {
    const p = item.payload || {};
    if (item.kind !== 'meeting.respond' || p.meetingId !== meetingId || !rows.some((a) => a && a.id === p.attendeeId)) continue;
    rows = rows.map((a) => (a && a.id === p.attendeeId
      ? { ...a, response: p.response, respondedAt: p.response === 'PENDING' ? null : atIso(item), pending: true }
      : a));
    applied += 1;
  }
  return { data: rows, applied };
}

/** A list of meetings with your answer waiting to sync on the rows that carry your own row (myAttendeeId). */
function overMeetingList(list, items) {
  let rows = list;
  let applied = 0;
  for (const item of items) {
    const p = item.payload || {};
    if (item.kind !== 'meeting.respond' || !rows.some((m) => m && m.id === p.meetingId && m.myAttendeeId === p.attendeeId)) continue;
    rows = rows.map((m) => (m && m.id === p.meetingId && m.myAttendeeId === p.attendeeId ? { ...m, myResponse: p.response, myPending: true } : m));
    applied += 1;
  }
  return { data: rows, applied };
}

export function applyPending(key, data, items) {
  const waiting = (items || []).filter((i) => i && i.status !== 'failed');
  const none = { data, applied: 0 };
  if (!waiting.length || data == null || typeof key !== 'string') return none;
  const after = (prefix) => key.slice(prefix.length);
  if (key.startsWith('tasks:')) return Array.isArray(data) ? overTaskList(key, data, waiting) : none;
  if (key.startsWith('task:')) return typeof data === 'object' && !Array.isArray(data) ? overTask(after('task:'), data, waiting) : none;
  if (key.startsWith('checklist:')) return typeof data === 'object' ? overChecklist(after('checklist:'), data, waiting) : none;
  if (key.startsWith('comments:')) return Array.isArray(data) ? overComments(after('comments:'), data, waiting) : none;
  if (key.startsWith('assignees:')) return Array.isArray(data) ? overAssignees(after('assignees:'), data, waiting) : none;
  if (key.startsWith('attachments:')) return Array.isArray(data) ? overAttachments(after('attachments:'), data, waiting) : none;
  if (key.startsWith('watch:')) return typeof data === 'object' && !Array.isArray(data) ? overWatch(after('watch:'), data, waiting) : none;
  if (key.startsWith('watchers:')) return Array.isArray(data) ? overWatchers(after('watchers:'), data, waiting) : none;
  if (key.startsWith('messages:')) return Array.isArray(data) ? overMessages(after('messages:'), data, waiting) : none;
  if (key.startsWith('meeting-attendees:')) return Array.isArray(data) ? overMeetingPeople(after('meeting-attendees:'), data, waiting) : none;
  if (key.startsWith('meetings:')) return Array.isArray(data) ? overMeetingList(data, waiting) : none;
  if (key === 'notifications') return Array.isArray(data) ? overNotifications(data, waiting) : none;
  if (key === 'unread') return typeof data === 'object' ? overUnread(data, waiting) : none;
  return none;
}
